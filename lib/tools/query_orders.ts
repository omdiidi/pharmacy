import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import type OpenAI from 'openai';

const InputSchema = z.object({
  status: z.enum(['new', 'ordered_from_supplier', 'shipped', 'delivered', 'returned', 'refunded']).optional(),
  platform: z.enum(['amazon', 'ebay', 'own_store']).optional(),
  since_days: z.number().int().min(0).max(365).default(30),
  limit: z.number().int().min(1).max(100).default(50),
});

export const query_orders_def: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'query_orders',
    description:
      "Search the pharmacy's order history. Use this when Kaleem asks about recent orders, sales, refunds, or fulfillment status.",
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['new', 'ordered_from_supplier', 'shipped', 'delivered', 'returned', 'refunded'],
        },
        platform: { type: 'string', enum: ['amazon', 'ebay', 'own_store'] },
        since_days: { type: 'number', description: 'Lookback window in days', default: 30 },
        limit: { type: 'number', default: 50 },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export async function query_orders(rawInput: unknown, ctx: { pharmacyId: string }): Promise<string> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) return JSON.stringify({ error: parsed.error.message });
  const { status, platform, since_days, limit } = parsed.data;

  const supabase = createClient();
  const since = new Date(Date.now() - since_days * 24 * 60 * 60 * 1000).toISOString();

  let q = supabase
    .from('orders')
    .select(
      'id, platform, platform_order_id, status, sold_price, sold_at, supplier_source, supplier_cost, shipping_cost, platform_fees, net_profit, tracking_number, fulfilled_at, created_at',
    )
    .eq('pharmacy_id', ctx.pharmacyId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) q = q.eq('status', status);
  if (platform) q = q.eq('platform', platform);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  const rows = data ?? [];
  return JSON.stringify({ rows, count: rows.length });
}
