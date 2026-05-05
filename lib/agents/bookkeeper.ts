// Bookkeeper agent — daily P&L reconciliation.
// Phase 1 placeholder branch: orders.platform_fees is treated as authoritative
// (no SP-API Settlement Reports until Phase 2 Wave 2). Empty-orders day emits
// zero P&L with data_source='estimated'.

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import { openrouter } from '@/lib/llm';
import { recordLLMUsage } from '@/lib/budget';
import { Sentry } from '@/lib/logger';
import {
  AGENT_MODEL,
  DEFAULT_PHARMACY_ID,
  callAgentLLM,
  dailyBudgetGate,
  loadSkillPrompt,
  stripJsonFence,
} from './_shared';

const OutputSchema = z.object({
  date: z.string(),
  revenue: z.number(),
  cogs: z.number(),
  fees: z.number(),
  net: z.number(),
  anomalies: z.array(z.object({ kind: z.string(), detail: z.record(z.unknown()) })),
  data_source: z.enum(['estimated', 'settled']),
  reasoning: z.string(),
});

export type BookkeeperResult = {
  briefing_id: string | null;
  capped: boolean;
  anomaly_count?: number;
  net?: number;
  revenue?: number;
  cogs?: number;
  fees?: number;
};

export async function runBookkeeper(
  supabase: SupabaseClient<Database>,
  opts: { pharmacyId?: string; date?: Date } = {},
): Promise<BookkeeperResult> {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;
  const target =
    opts.date ??
    (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      return d;
    })();
  const start = new Date(target);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(target);
  end.setUTCHours(23, 59, 59, 999);

  const gate = await dailyBudgetGate(supabase, 'bookkeeper');
  if (gate.capped) return { briefing_id: null, capped: true };

  const { data: orders } = await supabase
    .from('orders')
    .select(
      'id, sold_price, supplier_cost, shipping_cost, platform_fees, net_profit, status, platform, sold_at',
    )
    .eq('pharmacy_id', pharmacyId)
    .gte('sold_at', start.toISOString())
    .lte('sold_at', end.toISOString());

  const { data: usage } = await supabase
    .from('claude_usage')
    .select('estimated_cost_usd, model, created_at')
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());

  const { data: health } = await supabase
    .from('health_metrics')
    .select('platform, metric, value, captured_at')
    .eq('pharmacy_id', pharmacyId)
    .gte('captured_at', start.toISOString())
    .lte('captured_at', end.toISOString());

  // Last 7 days of pending_listings for the trailing carrying-cost lens.
  const seven = new Date(start);
  seven.setUTCDate(seven.getUTCDate() - 7);
  const { data: pendingListings } = await supabase
    .from('pending_listings')
    .select('id, status, created_at, proposed_price')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', seven.toISOString());

  const userPayload = {
    pharmacy_id: pharmacyId,
    date_range: { start: start.toISOString(), end: end.toISOString() },
    trigger: 'scheduled',
    orders: orders ?? [],
    claude_usage: usage ?? [],
    health_metrics: health ?? [],
    pending_listings: pendingListings ?? [],
    note:
      (orders?.length ?? 0) === 0
        ? 'No orders in window — emit zero P&L with data_source=estimated.'
        : 'Standard P&L reconciliation.',
  };

  const skill = await loadSkillPrompt('bookkeeper');
  const completion = await callAgentLLM(openrouter, {
    model: AGENT_MODEL,
    reasoningEffort: 'medium',
    systemPrompt: skill,
    userPayload,
    jsonOutputSchema: `{
  "date": "YYYY-MM-DD",
  "revenue": number,
  "cogs": number,
  "fees": number,
  "net": number,
  "anomalies": [{ "kind": "string", "detail": { ... } }],
  "data_source": "estimated" | "settled",
  "reasoning": "string"
}`,
  });
  await recordLLMUsage(supabase, null, completion);

  const raw = completion.choices[0]?.message?.content ?? '{}';
  let parsed: z.infer<typeof OutputSchema>;
  try {
    parsed = OutputSchema.parse(JSON.parse(stripJsonFence(raw)));
  } catch (err) {
    Sentry.captureException(err, { tags: { agent: 'bookkeeper', stage: 'parse' } });
    return { briefing_id: null, capped: false };
  }

  const summary =
    `${parsed.date}: net $${parsed.net.toFixed(2)} ` +
    `(revenue $${parsed.revenue.toFixed(2)}, cogs $${parsed.cogs.toFixed(2)}, ` +
    `fees $${parsed.fees.toFixed(2)}). ${parsed.anomalies.length} anomalies. ` +
    `data_source=${parsed.data_source}.`;

  const dataSnapshot: Json = {
    kind: 'daily_pnl',
    ...parsed,
  } as unknown as Json;

  const { data: briefing, error: bErr } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: pharmacyId,
      source_agent: 'bookkeeper',
      briefing_type: 'strategic',
      title: `Daily P&L for ${parsed.date}`,
      summary,
      rationale: parsed.reasoning,
      confidence: 0.8,
      urgency: parsed.anomalies.length > 0 ? 3 : 2,
      proposed_actions: [] as unknown as Json,
      data_snapshot: dataSnapshot,
    })
    .select('id')
    .single();
  if (bErr || !briefing) {
    throw new Error(`bookkeeper briefing insert failed: ${bErr?.message}`);
  }

  const { error: inboxErr } = await supabase.from('inbox_items').insert({
    pharmacy_id: pharmacyId,
    briefing_id: briefing.id,
    state: 'pending',
  });
  if (inboxErr) {
    throw new Error(`bookkeeper inbox_items insert failed: ${inboxErr.message}`);
  }

  return {
    briefing_id: briefing.id,
    capped: false,
    anomaly_count: parsed.anomalies.length,
    net: parsed.net,
    revenue: parsed.revenue,
    cogs: parsed.cogs,
    fees: parsed.fees,
  };
}
