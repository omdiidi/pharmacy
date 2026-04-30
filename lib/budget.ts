import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { priceClaudeUsage } from '@/lib/anthropic-pricing';

export async function recordClaudeUsage(userId: string, message: Anthropic.Message): Promise<void> {
  const supabase = createClient();
  const usage = message.usage;
  const cost = priceClaudeUsage(message.model, {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
  });

  const { error } = await supabase.from('claude_usage').insert({
    user_id: userId,
    request_id: message.id,
    model: message.model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
    estimated_cost_usd: cost,
  });

  if (error) {
    // Don't crash the chat stream just because the usage row failed.
    console.warn('[budget] failed to record claude_usage row:', error.message);
  }
}

export async function getTodayClaudeSpendUsd(userId: string): Promise<number> {
  const supabase = createClient();
  const startOfTodayUtc = new Date();
  startOfTodayUtc.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('claude_usage')
    .select('estimated_cost_usd')
    .eq('user_id', userId)
    .gte('created_at', startOfTodayUtc.toISOString());

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
