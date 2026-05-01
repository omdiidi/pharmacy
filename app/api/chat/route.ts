import type OpenAI from 'openai';
import { openrouter, CHATBOT_MODEL, CHATBOT_REASONING_EFFORT } from '@/lib/llm';
import { toolDefinitions, executeTool } from '@/lib/tools';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { requireAuthenticatedUser } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { recordLLMUsage, getTodaySpendUsd } from '@/lib/budget';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TOOL_ITERATIONS = 8;
const MAX_DAILY_SPEND_USD = Number(process.env.MAX_DAILY_CLAUDE_SPEND_USD ?? 50);

type ChatMessageInput = { role: 'user' | 'assistant' | 'system'; content: string };

type ToolCallAccum = {
  id: string;
  name: string;
  args: string;
};

export async function POST(req: Request) {
  const session = await requireAuthenticatedUser(req);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const rl = await checkRateLimit(session.userId, { window: 60_000, max: 60 });
  if (!rl.ok) {
    return new Response('Rate limited', {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSeconds) },
    });
  }

  const supabase = createClient();
  const todaySpend = await getTodaySpendUsd(supabase, session.userId);
  if (todaySpend >= MAX_DAILY_SPEND_USD) {
    return new Response('daily budget exceeded', { status: 429 });
  }

  const { messages: clientMessages } = (await req.json()) as { messages: ChatMessageInput[] };
  const system = await buildSystemPrompt(session);

  const conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...clientMessages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const safeEnqueue = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          // client disconnected
        }
      };

      try {
        let iterations = 0;

        while (iterations < MAX_TOOL_ITERATIONS) {
          iterations++;

          const llmStream = await openrouter.chat.completions.create(
            {
              model: CHATBOT_MODEL,
              messages: conversation,
              tools: toolDefinitions,
              tool_choice: 'auto',
              stream: true,
              stream_options: { include_usage: true },
              // OpenRouter extension — enables reasoning on Sonnet 4.6
              reasoning: { effort: CHATBOT_REASONING_EFFORT },
            } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
            { signal: req.signal },
          );

          let textBuffer = '';
          const toolCalls: Map<number, ToolCallAccum> = new Map();
          let finishReason: string | null = null;
          let modelEcho = CHATBOT_MODEL;
          let lastChunkId = '';
          let lastUsage: OpenAI.Completions.CompletionUsage | null = null;

          for await (const chunk of llmStream) {
            lastChunkId = chunk.id || lastChunkId;
            modelEcho = chunk.model || modelEcho;
            if (chunk.usage) lastUsage = chunk.usage;
            const choice = chunk.choices[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (delta?.content) {
              textBuffer += delta.content;
              safeEnqueue({ type: 'text_delta', value: delta.content });
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                let accum = toolCalls.get(idx);
                if (!accum) {
                  accum = { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' };
                  toolCalls.set(idx, accum);
                  if (accum.name) {
                    safeEnqueue({ type: 'tool_use_start', name: accum.name, id: accum.id });
                  }
                } else {
                  if (tc.id && !accum.id) accum.id = tc.id;
                  if (tc.function?.name && !accum.name) {
                    accum.name = tc.function.name;
                    safeEnqueue({ type: 'tool_use_start', name: accum.name, id: accum.id });
                  }
                }
                if (tc.function?.arguments) accum.args += tc.function.arguments;
              }
            }

            if (choice.finish_reason) finishReason = choice.finish_reason;
          }

          // Record usage for budget tracking
          if (lastUsage) {
            try {
              await recordLLMUsage(supabase, session.userId, {
                id: lastChunkId,
                model: modelEcho,
                usage: lastUsage,
              } as OpenAI.Chat.Completions.ChatCompletion);
            } catch (err) {
              console.warn('[chat] recordLLMUsage failed:', err);
            }
          }

          if (finishReason !== 'tool_calls' || toolCalls.size === 0) break;

          // Append the assistant message with tool_calls
          const assistantToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
          for (const tc of toolCalls.values()) {
            assistantToolCalls.push({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.args || '{}' },
            });
          }
          conversation.push({
            role: 'assistant',
            content: textBuffer || null,
            tool_calls: assistantToolCalls,
          });

          // Execute each tool, append results
          for (const tc of toolCalls.values()) {
            let parsedInput: unknown;
            try {
              parsedInput = JSON.parse(tc.args || '{}');
            } catch {
              parsedInput = {};
            }
            const result = await executeTool(tc.name, parsedInput, {
              pharmacyId: session.pharmacyId,
            });
            conversation.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: result,
            });
          }
        }

        if (iterations >= MAX_TOOL_ITERATIONS) {
          safeEnqueue({ type: 'error', value: 'max tool iterations reached' });
        }

        controller.close();
      } catch (err) {
        safeEnqueue({ type: 'error', value: err instanceof Error ? err.message : String(err) });
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
