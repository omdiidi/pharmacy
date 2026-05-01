import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { priceLLMUsage } from '@/lib/llm-pricing';

// userId === null means "system spend" (e.g. cron-run agent). Migration
// 20260501000001 dropped the NOT NULL on claude_usage.user_id to support this.
export async function recordLLMUsage(
  supabase: SupabaseClient<Database>,
  userId: string | null,
  completion: OpenAI.Chat.Completions.ChatCompletion,
): Promise<void> {
  const usage = completion.usage;
  if (!usage) return;
  const cost = priceLLMUsage(completion.model, usage);

  const { error } = await supabase.from('claude_usage').insert({
    user_id: userId,
    request_id: completion.id,
    model: completion.model,
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    estimated_cost_usd: cost,
  });

  if (error) {
    console.warn('[budget] failed to record llm_usage row:', error.message);
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
