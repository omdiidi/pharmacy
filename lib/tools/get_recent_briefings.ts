import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import type OpenAI from 'openai';
import type { ToolContext } from './index';

const BRIEFING_TYPES = [
  'hot_arbitrage',
  'new_opportunity',
  'restock',
  'seasonal',
  'reprice_up',
  'reprice_down',
  'suspend',
  'watchlist',
  'order_to_fulfill',
  'customer_message',
  'account_health',
  'strategic',
  'rx_shortage_adjacency',
  'fda_recall_triggered',
  'tic_certification_gap',
] as const;

const InputSchema = z.object({
  types: z.array(z.enum(BRIEFING_TYPES)).optional(),
  urgency_min: z.number().int().min(1).max(5).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const get_recent_briefings_def: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_recent_briefings',
    description:
      "Pull recent briefings (intel posts) from the agents. Use to recap what's happened recently or retrieve a specific briefing's full reasoning.",
    parameters: {
      type: 'object',
      properties: {
        types: { type: 'array', items: { type: 'string', enum: BRIEFING_TYPES as unknown as string[] } },
        urgency_min: { type: 'number', minimum: 1, maximum: 5 },
        limit: { type: 'number', default: 20 },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export async function get_recent_briefings(
  rawInput: unknown,
  ctx: ToolContext,
): Promise<string> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) return JSON.stringify({ error: parsed.error.message });
  const { types, urgency_min, limit } = parsed.data;

  const supabase = createClient();
  let q = supabase
    .from('briefings')
    .select(
      'id, briefing_type, title, summary, rationale, urgency, confidence, source_agent, created_at',
    )
    .eq('pharmacy_id', ctx.pharmacyId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (types && types.length > 0) q = q.in('briefing_type', types);
  if (typeof urgency_min === 'number') q = q.gte('urgency', urgency_min);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  const rows = data ?? [];
  return JSON.stringify({ rows, count: rows.length });
}
