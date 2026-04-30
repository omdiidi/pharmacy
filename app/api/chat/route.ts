import type Anthropic from '@anthropic-ai/sdk';
import { anthropic } from '@/lib/anthropic';
import { toolDefinitions, executeTool } from '@/lib/tools';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { requireAuthenticatedUser } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { recordClaudeUsage, getTodayClaudeSpendUsd } from '@/lib/budget';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TOOL_ITERATIONS = 8;
const MAX_REQUEST_INPUT_TOKENS = 150_000;
const MAX_DAILY_CLAUDE_SPEND_USD = Number(process.env.MAX_DAILY_CLAUDE_SPEND_USD ?? 50);
const MODEL = 'claude-opus-4-7';

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

  // Daily budget guard — must run before the first Claude call.
  const todaySpend = await getTodayClaudeSpendUsd(session.userId);
  if (todaySpend >= MAX_DAILY_CLAUDE_SPEND_USD) {
    return new Response('daily budget exceeded', { status: 429 });
  }

  const { messages } = (await req.json()) as { messages: Anthropic.MessageParam[] };
  const systemBlocks = await buildSystemPrompt(session);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const safeEnqueue = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          // client disconnected; loop will break on next iteration
        }
      };

      try {
        let conversation: Anthropic.MessageParam[] = messages;
        let iterations = 0;
        let approxInputTokens = 0;

        const initialCount = await anthropic.messages.countTokens({
          model: MODEL,
          system: systemBlocks,
          tools: toolDefinitions,
          messages: conversation,
        });
        approxInputTokens = initialCount.input_tokens;
        if (approxInputTokens > MAX_REQUEST_INPUT_TOKENS) {
          safeEnqueue({ type: 'error', value: 'conversation too long' });
          controller.close();
          return;
        }

        while (iterations < MAX_TOOL_ITERATIONS) {
          iterations++;

          const claudeStream = anthropic.messages.stream(
            {
              model: MODEL,
              max_tokens: 4096,
              system: systemBlocks,
              tools: toolDefinitions,
              messages: conversation,
            },
            { signal: req.signal },
          );

          for await (const event of claudeStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              safeEnqueue({ type: 'text_delta', value: event.delta.text });
            } else if (
              event.type === 'content_block_start' &&
              event.content_block.type === 'tool_use'
            ) {
              safeEnqueue({
                type: 'tool_use_start',
                name: event.content_block.name,
                id: event.content_block.id,
              });
            }
          }

          const finalMessage = await claudeStream.finalMessage();

          // Recording usage must not crash the stream if the row insert fails.
          try {
            await recordClaudeUsage(session.userId, finalMessage);
          } catch (err) {
            console.warn('[chat] recordClaudeUsage failed:', err);
          }

          if (finalMessage.stop_reason !== 'tool_use') break;

          const toolUseBlocks = finalMessage.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          );

          const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
            toolUseBlocks.map(async (b) => ({
              type: 'tool_result' as const,
              tool_use_id: b.id,
              content: await executeTool(b.name, b.input, { pharmacyId: session.pharmacyId }),
            })),
          );

          conversation = [
            ...conversation,
            { role: 'assistant', content: finalMessage.content },
            { role: 'user', content: toolResults },
          ];

          const appendedBytes = JSON.stringify(toolResults).length;
          if (appendedBytes > 10_000) {
            const recount = await anthropic.messages.countTokens({
              model: MODEL,
              system: systemBlocks,
              tools: toolDefinitions,
              messages: conversation,
            });
            approxInputTokens = recount.input_tokens;
            if (approxInputTokens > MAX_REQUEST_INPUT_TOKENS) {
              safeEnqueue({ type: 'error', value: 'conversation grew past token budget' });
              break;
            }
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
