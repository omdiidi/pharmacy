// Shared helpers for cron-driven agents.
// Extracted from listing-agent.ts so subsequent Wave 1 agents (bookkeeper,
// reflector, portfolio-manager) reuse the same fence-strip + skill-load +
// budget-gate + LLM-call shape.

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { getTodaySpendUsd } from '@/lib/budget';

export const DEFAULT_PHARMACY_ID = '00000000-0000-0000-0000-000000000001';
export const AGENT_MODEL = 'anthropic/claude-sonnet-4.6';

// Sonnet 4.6 over OpenRouter occasionally wraps JSON in ```json fences even
// when response_format: json_object is set. Strip them defensively.
export function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export async function loadSkillPrompt(name: string): Promise<string> {
  // process.cwd() resolves to the project root for both tsx cron entries and
  // Next.js API routes. __dirname under Next's webpack bundle resolves to
  // .next/server/app/... and would 404.
  const skillPath = path.resolve(process.cwd(), 'minicrew-config/skills', `${name}.md`);
  return await readFile(skillPath, 'utf8');
}

export async function dailyBudgetGate(
  supabase: SupabaseClient<Database>,
  agentName: string,
): Promise<{ capped: boolean; today: number; cap: number }> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(`[${agentName}] OPENROUTER_API_KEY not set`);
  }
  const rawCap = process.env.MAX_DAILY_CLAUDE_SPEND_USD;
  // Empty-string env var must fall back to default 50 — Number('') === 0 would
  // silently disable the cap. Robustified during the listing-agent refactor.
  const parsedCap = rawCap && rawCap.trim() !== '' ? Number(rawCap) : NaN;
  const cap = Number.isFinite(parsedCap) && parsedCap > 0 ? parsedCap : 50;
  const today = await getTodaySpendUsd(supabase, null);
  if (today >= cap) {
    console.log(`[${agentName}] daily cap reached: $${today} >= $${cap}; exiting`);
    return { capped: true, today, cap };
  }
  return { capped: false, today, cap };
}

export type CallAgentLLMArgs = {
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  systemPrompt: string;
  userPayload: unknown;
  // JSON-only suffix appended to system prompt. The Wave 1 skill files
  // (bookkeeper, reflector, portfolio-manager) were authored for tool-use
  // mode and don't enforce JSON-only output. We coerce at runtime without
  // rewriting the skill files.
  jsonOutputSchema?: string;
};

const JSON_ONLY_SUFFIX =
  '\n\n---\nIMPORTANT: You are not running tools, not writing to any database, and not producing prose. ' +
  'Respond with ONE JSON object — nothing else. No markdown fences, no commentary, no preamble. ' +
  'The runtime parses your output with JSON.parse and a Zod schema. Any non-JSON output causes the run to fail.';

export async function callAgentLLM(
  openrouter: OpenAI,
  args: CallAgentLLMArgs,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const systemPrompt =
    args.systemPrompt +
    JSON_ONLY_SUFFIX +
    (args.jsonOutputSchema ? `\n\nExpected JSON shape:\n${args.jsonOutputSchema}` : '');

  // Phase 3 hardening: 60s ceiling on the OpenRouter call so a stuck
  // upstream cannot pin a cron worker indefinitely. The cron-lock TTL is
  // a backstop, but an in-flight network request can hold the lock until
  // OS-level keepalive timeout (~2h on Linux defaults).
  const TIMEOUT_MS = 60_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await openrouter.chat.completions.create(
      {
        model: args.model ?? AGENT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(args.userPayload) },
        ],
        response_format: { type: 'json_object' },
        // Cap so OpenRouter doesn't reserve credit against the model's max.
        // Agent JSON outputs fit comfortably in 8K — Bookkeeper digests etc.
        max_tokens: 8192,
        // OpenRouter extension — same cast pattern as listing-agent.ts.
        reasoning: { effort: args.reasoningEffort ?? 'medium' },
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      { signal: ac.signal },
    );
  } finally {
    clearTimeout(timer);
  }
}
