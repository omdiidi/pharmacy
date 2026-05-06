import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { priceLLMUsage } from '@/lib/llm-pricing';
import { Sentry } from '@/lib/logger';

// Phase 3 hardening: track consecutive insert failures and escalate to
// Sentry as level=error every 5 failures, rate-limited to once per 5 min.
// We deliberately do NOT throw — that would feedback-loop with the webhook
// 5xx path (failed insert → throw → 5xx → SP-API replay → new run → more
// failed inserts).
let consecutiveFailures = 0;
let lastEscalation = 0;

// Phase 4b: signature changed to options-object form so callers can stamp
// pharmacy_id (per-tenant cost attribution) without breaking the legacy
// (supabase, userId, completion) call sites that didn't have a pharmacy
// scope. Both userId and pharmacyId are optional — userId === null means
// "system spend" (cron-run agent). Migration 20260501000001 dropped the
// NOT NULL on claude_usage.user_id to support that.
export async function recordLLMUsage(
  supabase: SupabaseClient<Database>,
  completion: OpenAI.Chat.Completions.ChatCompletion,
  opts: { userId?: string | null; pharmacyId?: string | null } = {},
): Promise<void> {
  const usage = completion.usage;
  if (!usage) return;
  const cost = priceLLMUsage(completion.model, usage);

  const { error } = await supabase.from('claude_usage').insert({
    user_id: opts.userId ?? null,
    pharmacy_id: opts.pharmacyId ?? null,
    request_id: completion.id,
    model: completion.model,
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    estimated_cost_usd: cost,
  });

  if (error) {
    consecutiveFailures += 1;
    console.warn('[budget] failed to record llm_usage row:', error.message);
    if (consecutiveFailures % 5 === 0 && Date.now() - lastEscalation > 5 * 60_000) {
      Sentry.captureMessage(
        `[budget] ${consecutiveFailures} consecutive claude_usage insert failures`,
        { level: 'error', tags: { stage: 'recordLLMUsage' } },
      );
      lastEscalation = Date.now();
    }
  } else {
    consecutiveFailures = 0;
  }
}

export async function getTodaySpendUsd(
  supabase: SupabaseClient<Database>,
  userId: string | null,
): Promise<number> {
  const startOfTodayUtc = new Date();
  startOfTodayUtc.setUTCHours(0, 0, 0, 0);

  let query = supabase
    .from('claude_usage')
    .select('estimated_cost_usd')
    .gte('created_at', startOfTodayUtc.toISOString());

  if (userId === null) {
    query = query.is('user_id', null);
  } else {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    console.warn('[budget] failed to read today spend, treating as 0:', error.message);
    return 0;
  }

  const rows = (data ?? []) as Array<{ estimated_cost_usd: number | string | null }>;
  let sum = 0;
  for (const row of rows) {
    const v = row.estimated_cost_usd;
    if (v === null || v === undefined) continue;
    sum += typeof v === 'string' ? Number(v) : v;
  }
  return sum;
}
