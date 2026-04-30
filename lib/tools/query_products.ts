import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';

// Reject characters that break PostgREST `or=` parsing OR inject ilike wildcards we don't intend
const SAFE_QUERY = /^[A-Za-z0-9 \-_.+/]+$/;

const InputSchema = z.object({
  query: z.string().min(1).max(100).regex(SAFE_QUERY, 'Query contains disallowed characters'),
  limit: z.number().int().min(1).max(100).default(20),
});

export const query_products_def: Anthropic.Tool = {
  name: 'query_products',
  description:
    'Search the pharmacy catalog. Use this when Kaleem asks about specific products by name, NDC, UPC, ASIN, brand, or category.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term — name, brand, category, NDC, UPC, or ASIN' },
      limit: { type: 'number', description: 'Max rows to return', default: 20 },
    },
    required: ['query'],
  },
};

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

export async function query_products(rawInput: unknown, ctx: { pharmacyId: string }): Promise<string> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) return JSON.stringify({ error: parsed.error.message });
  const { query, limit } = parsed.data;

  const supabase = createClient();
  const cols =
    'id, name, brand, category, asin, ndc, upc, default_supplier, last_listed_price, last_listed_at, watchlist_status';
  const like = `%${escapeLike(query)}%`;

  const [byAsin, byNdc, byUpc, byName, byBrand, byCategory] = await Promise.all([
    supabase.from('products').select(cols).eq('pharmacy_id', ctx.pharmacyId).eq('asin', query).limit(limit),
    supabase.from('products').select(cols).eq('pharmacy_id', ctx.pharmacyId).eq('ndc', query).limit(limit),
    supabase.from('products').select(cols).eq('pharmacy_id', ctx.pharmacyId).eq('upc', query).limit(limit),
    supabase.from('products').select(cols).eq('pharmacy_id', ctx.pharmacyId).ilike('name', like).limit(limit),
    supabase.from('products').select(cols).eq('pharmacy_id', ctx.pharmacyId).ilike('brand', like).limit(limit),
    supabase.from('products').select(cols).eq('pharmacy_id', ctx.pharmacyId).ilike('category', like).limit(limit),
  ]);

  for (const r of [byAsin, byNdc, byUpc, byName, byBrand, byCategory]) {
    if (r.error) return JSON.stringify({ error: r.error.message });
  }

  const byId = new Map<string, any>();
  for (const r of [byAsin.data, byNdc.data, byUpc.data, byName.data, byBrand.data, byCategory.data]) {
    for (const row of r ?? []) byId.set((row as { id: string }).id, row);
  }
  const rows = Array.from(byId.values()).slice(0, limit);
  return JSON.stringify({ rows, count: rows.length });
}
