// Fulfillment Ops — webhook-driven, no cron. Invoked from
// app/api/sp-api/webhook/route.ts on ORDER_CHANGE / ORDER_STATUS_CHANGE.
//
// Per item in the order envelope:
// 1. Upsert order (idempotent on (platform, platform_order_id)).
// 2. Resolve product by ASIN.
// 3. Pull wholesaler comparison via lib/edi (fixture-mode in Wave 3).
// 4. Apply policy filter (Wave 3 stub passthrough; Wave 4 enforces real rules).
// 5. Single-pass LLM call → ranked candidates with reasoning.
// 6. Insert briefing(briefing_type='order_to_fulfill', urgency=5).

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import { openrouter } from '@/lib/llm';
import { recordLLMUsage } from '@/lib/budget';
import {
  AGENT_MODEL,
  DEFAULT_PHARMACY_ID,
  callAgentLLM,
  dailyBudgetGate,
  loadSkillPrompt,
  stripJsonFence,
} from './_shared';
import {
  getWholesalerCatalogClient,
  type WholesalerSnapshot,
} from '@/lib/edi';
import type { NotificationEnvelope } from '@/lib/sp-api';
import { normalizeOrderStatus } from '@/lib/orders/status';
import { Sentry } from '@/lib/logger';

const CandidateSchema = z.object({
  wholesaler: z.enum(['abc', 'mckesson', 'cardinal', 'parmed', 'ezrirx']),
  unit_price: z.number().positive(),
  eta: z.string().nullable().optional(),
  recommended: z.boolean().default(false),
  reasoning: z.string().optional(),
});
const FulfillmentOutputSchema = z.object({
  candidates: z.array(CandidateSchema).min(0).max(10),
  rationale: z.string(),
});

type OrderItemSummary = { ASIN: string; SellerSKU?: string; Quantity: number };
type OrderChangeNotification = {
  SellerId: string;
  AmazonOrderId: string;
  OrderChangeType: string;
  OrderChangeTrigger?: { TimeOfOrderChange: string };
  Summary: {
    MarketplaceId: string;
    OrderStatus: string;
    DestinationPostalCode?: string;
    OrderItems?: OrderItemSummary[];
    OrderType?: string;
    LevelOfFulfillment?: string;
    Programs?: string[];
  };
};

export type FulfillmentOpsResult = {
  briefing_ids: string[];
  candidates_total: number;
  capped: boolean;
};

type RunArgs = {
  pharmacyId?: string;
  trigger: 'webhook' | 'manual-test';
  event: NotificationEnvelope;
};

function applyPolicyFilter(snapshots: WholesalerSnapshot[]): WholesalerSnapshot[] {
  // Wave 3 stub passthrough. Wholesaler-level rules are not yet defined in
  // policy_rules; Wave 4 will enforce target_type='wholesaler' rows.
  console.log(
    `[fulfillment-ops] policy filter (Wave 3 stub): ${snapshots.length} → ${snapshots.length} (passthrough); ` +
      `wholesalers seen: ${snapshots.map((s) => s.wholesaler).join(',')}`,
  );
  return snapshots;
}

export async function runFulfillmentOps(
  supabase: SupabaseClient<Database>,
  args: RunArgs,
): Promise<FulfillmentOpsResult> {
  const pharmacyId = args.pharmacyId ?? DEFAULT_PHARMACY_ID;

  const gate = await dailyBudgetGate(supabase, 'fulfillment-ops');
  if (gate.capped) return { briefing_ids: [], candidates_total: 0, capped: true };

  const payload = args.event.Payload as
    | { OrderChangeNotification?: OrderChangeNotification }
    | undefined;
  const change = payload?.OrderChangeNotification;
  if (!change) {
    console.warn('[fulfillment-ops] envelope has no OrderChangeNotification; skipping');
    return { briefing_ids: [], candidates_total: 0, capped: false };
  }

  // 1. Upsert order. Normalize SP-API CamelCase OrderStatus onto the canonical
  // lowercase set enforced by orders_status_check (migration 20260505000004).
  const purchaseDate =
    change.OrderChangeTrigger?.TimeOfOrderChange ?? new Date().toISOString();
  let normalizedStatus: string;
  try {
    normalizedStatus = normalizeOrderStatus(change.Summary.OrderStatus);
  } catch (err) {
    Sentry.captureMessage(
      `[fulfillment-ops] unknown OrderStatus '${change.Summary.OrderStatus}' for ${change.AmazonOrderId}; skipping`,
      { level: 'warning', tags: { agent: 'fulfillment-ops', stage: 'status-normalize' } },
    );
    console.warn(
      `[fulfillment-ops] unknown OrderStatus '${change.Summary.OrderStatus}'; skipping:`,
      err instanceof Error ? err.message : err,
    );
    return { briefing_ids: [], candidates_total: 0, capped: false };
  }
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .upsert(
      {
        pharmacy_id: pharmacyId,
        platform: 'amazon',
        platform_order_id: change.AmazonOrderId,
        status: normalizedStatus,
        sold_at: purchaseDate,
      },
      { onConflict: 'platform,platform_order_id' },
    )
    .select('id')
    .single();
  if (orderErr || !order) {
    throw new Error(
      `[fulfillment-ops] order upsert failed: ${orderErr?.message ?? 'no row'}`,
    );
  }

  // Per-item fan-out cap.
  let items = change.Summary.OrderItems ?? [];
  if (items.length > 10) {
    console.warn(
      `[fulfillment-ops] order ${change.AmazonOrderId} has ${items.length} items; processing first 10`,
    );
    items = items.slice(0, 10);
  }

  const skill = await loadSkillPrompt('fulfillment-ops');
  const briefingIds: string[] = [];
  let candidatesTotal = 0;

  for (const item of items) {
    const { data: product } = await supabase
      .from('products')
      .select('id, ndc, name, brand, asin')
      .eq('pharmacy_id', pharmacyId)
      .eq('asin', item.ASIN)
      .maybeSingle();
    if (!product?.ndc) {
      console.warn(
        `[fulfillment-ops] no product/ndc for ASIN ${item.ASIN}; skipping`,
      );
      continue;
    }

    const snapshots = await getWholesalerCatalogClient().getSnapshotsForNdcs([
      product.ndc,
    ]);
    const filtered = applyPolicyFilter(snapshots);
    if (filtered.length === 0) {
      console.warn(
        `[fulfillment-ops] no wholesaler snapshots for NDC ${product.ndc}; skipping`,
      );
      continue;
    }

    const userPayload = {
      order_id: order.id,
      amazon_order_id: change.AmazonOrderId,
      product,
      quantity: item.Quantity,
      wholesaler_snapshots: filtered,
    };

    let parsed: z.infer<typeof FulfillmentOutputSchema>;
    try {
      const completion = await callAgentLLM(openrouter, {
        model: AGENT_MODEL,
        reasoningEffort: 'medium',
        systemPrompt: skill,
        userPayload,
      });
      await recordLLMUsage(supabase, completion, { pharmacyId });
      const raw = completion.choices[0]?.message?.content ?? '{}';
      parsed = FulfillmentOutputSchema.parse(JSON.parse(stripJsonFence(raw)));
    } catch (err) {
      console.warn(
        '[fulfillment-ops] LLM/parse failed; falling back to ranked snapshots:',
        err instanceof Error ? err.message : err,
      );
      // Fallback: rank by unit_price asc; cheapest is recommended.
      const ranked = [...filtered].sort((a, b) => a.unit_price - b.unit_price);
      parsed = {
        candidates: ranked.map((r, i) => ({
          wholesaler: r.wholesaler,
          unit_price: r.unit_price,
          eta: null,
          recommended: i === 0,
          reasoning: i === 0 ? 'fallback: cheapest available' : undefined,
        })),
        rationale: 'LLM ranking unavailable; cheapest-price fallback',
      };
    }

    type ProposedAction = {
      kind: string;
      variant: 'primary' | 'secondary';
      label: string;
      params: Record<string, unknown>;
    };
    const proposedActions: ProposedAction[] = parsed.candidates.map((c) => ({
      kind: 'generate_purchase_order',
      variant: c.recommended ? 'primary' : 'secondary',
      label: `PO from ${c.wholesaler} @ $${c.unit_price.toFixed(2)}`,
      params: {
        order_id: order.id,
        product_id: product.id,
        wholesaler: c.wholesaler,
        proposed_unit_price: c.unit_price,
        proposed_quantity: item.Quantity,
        proposed_eta: c.eta ?? null,
        reasoning: c.reasoning ?? parsed.rationale,
      },
    }));
    proposedActions.push({
      kind: 'dismiss_briefing',
      variant: 'secondary',
      label: 'Skip — handle manually',
      params: {},
    });

    const { data: briefing, error: briefingErr } = await supabase
      .from('briefings')
      .insert({
        pharmacy_id: pharmacyId,
        source_agent: 'fulfillment_ops',
        briefing_type: 'order_to_fulfill',
        title: `Fulfill ${product.name} for ${change.AmazonOrderId}`,
        summary: parsed.rationale.slice(0, 240),
        rationale: parsed.rationale,
        confidence: parsed.candidates.some((c) => c.recommended) ? 0.85 : 0.5,
        urgency: 5,
        related_entity_type: 'orders',
        related_entity_id: order.id,
        proposed_actions: proposedActions as unknown as Json,
        data_snapshot: {
          kind: 'wholesaler_comparison',
          amazon_order_id: change.AmazonOrderId,
          asin: item.ASIN,
          ndc: product.ndc,
          quantity: item.Quantity,
          wholesaler_snapshots: filtered,
          trigger: args.trigger,
        } as Json,
      })
      .select('id')
      .single();
    if (briefingErr || !briefing) {
      console.warn(
        '[fulfillment-ops] briefing insert failed:',
        briefingErr?.message,
      );
      continue;
    }
    briefingIds.push(briefing.id);
    candidatesTotal += parsed.candidates.length;
    await supabase.from('inbox_items').insert({
      pharmacy_id: pharmacyId,
      briefing_id: briefing.id,
      state: 'pending',
    });
  }

  return { briefing_ids: briefingIds, candidates_total: candidatesTotal, capped: false };
}
