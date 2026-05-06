// Repricer — twice-daily cron + on-event from ANY_OFFER_CHANGED webhook.
// Per-listing LLM call against FOEP (Featured Offer Expected Price) + supplier
// stock + Kaleem's preferences. Decision enum: match_bb | hold | raise | drop | pause.
// Propose-only forever — every executor write is a pending_pricing_changes row.

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
import { getPricingClient, type FoepBatchRequestEntry, type FoepBatchResponse } from '@/lib/sp-api';
import { mapDecisionToBriefing, type RepricerOutput } from './repricer-output-adapter';

const Decision = z.enum(['match_bb', 'hold', 'raise', 'drop', 'pause']);
const OutputSchema = z.object({
  listing_id: z.string().uuid(),
  decision: Decision,
  current_price: z.number().nullable(),
  proposed_price: z.number().nullable(),
  margin_pct: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  // Sonnet sometimes returns objects per signal; accept either string-or-object.
  signals_used: z.array(z.union([z.string(), z.record(z.unknown())])).optional(),
});

type RunOpts = {
  pharmacyId?: string;
  trigger?: 'scheduled' | 'event';
  event?: unknown;
  maxListings?: number;
};

export type RepricerResult = {
  proposed: number;
  capped: boolean;
  evaluated?: number;
  skipped?: string;
};

type ListingRow = {
  id: string;
  product_id: string | null;
  platform: string;
  platform_listing_id: string | null;
  status: string;
  current_price: number | null;
  current_source_supplier: string | null;
  current_source_cost: number | null;
  products: {
    id: string;
    name: string;
    asin: string | null;
    upc: string | null;
    ndc: string | null;
    brand: string | null;
    watchlist_status: string;
    pharmacy_id: string;
  };
};

function extractAsinFromEvent(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const env = event as { Payload?: Record<string, unknown> };
  const aoc = env.Payload?.AnyOfferChangedNotification as
    | { OfferChangeTrigger?: { ASIN?: string } }
    | undefined;
  const mfn = env.Payload?.ListingsItemMfnQuantityChangeNotification as
    | { ASIN?: string }
    | undefined;
  return aoc?.OfferChangeTrigger?.ASIN ?? mfn?.ASIN ?? null;
}

export async function runRepricer(
  supabase: SupabaseClient<Database>,
  opts: RunOpts = {},
): Promise<RepricerResult> {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;
  const trigger = opts.trigger ?? 'scheduled';
  const limit = opts.maxListings ?? 30;

  const gate = await dailyBudgetGate(supabase, 'repricer');
  if (gate.capped) return { proposed: 0, capped: true };

  // 1. Pull active listings on watching products.
  let q = supabase
    .from('listings')
    .select(
      `id, product_id, platform, platform_listing_id, status, current_price, current_source_supplier, current_source_cost,
       products!inner(id, name, asin, upc, ndc, brand, watchlist_status, pharmacy_id)`,
    )
    .eq('status', 'active')
    .eq('platform', 'amazon')
    .eq('products.watchlist_status', 'watching')
    .eq('products.pharmacy_id', pharmacyId);

  if (trigger === 'event') {
    const asin = extractAsinFromEvent(opts.event);
    if (asin === null) {
      // Phase 3 hardening: don't fan out to a full watchlist scan when the
      // webhook envelope shape is unparseable. The webhook layer 5xxs and
      // SP-API replays — we'd otherwise reprice every active listing per
      // malformed event.
      console.warn('[repricer] event mode but no ASIN extracted; skipping run');
      return { proposed: 0, capped: false, evaluated: 0, skipped: 'unparseable_event' };
    }
    q = q.eq('products.asin', asin);
  }

  const { data: listings, error: lErr } = await q.limit(limit);
  if (lErr) throw new Error(`[repricer] listings query failed: ${lErr.message}`);
  const rows = (listings ?? []) as unknown as ListingRow[];
  if (rows.length === 0) {
    console.log('[repricer] no listings to evaluate');
    return { proposed: 0, evaluated: 0, capped: false };
  }

  // 2. Pull FOEP for the SKU set. Pricing client handles 20-SKU chunking + 30s sleep.
  const marketplaceId = process.env.SP_API_MARKETPLACE_ID ?? 'ATVPDKIKX0DER';
  const pricingClient = getPricingClient();
  const foepReq: { requests: FoepBatchRequestEntry[] } = {
    requests: rows.map((r) => ({
      method: 'POST',
      uri: '/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice',
      marketplaceId,
      sku: r.platform_listing_id ?? `synthetic-${r.id}`,
    })),
  };
  let foepResp: FoepBatchResponse;
  try {
    foepResp = await pricingClient.getFeaturedOfferExpectedPriceBatch(foepReq);
  } catch (err) {
    console.warn('[repricer] FOEP batch failed:', err instanceof Error ? err.message : err);
    foepResp = { responses: [] };
  }

  // 3. Pull preferences memory.
  const { data: prefMem } = await supabase
    .from('memory')
    .select('metadata')
    .eq('pharmacy_id', pharmacyId)
    .eq('kind', 'preferences')
    .eq('source', 'kaleem')
    .limit(1)
    .maybeSingle();
  const preferences = (prefMem?.metadata as Record<string, unknown> | null) ?? {
    min_margin_floor_pct: 25,
    max_scarcity_premium_pct: 300,
    risk_tolerance: 'conservative',
  };

  const skill = await loadSkillPrompt('repricer');
  let proposed = 0;

  for (let i = 0; i < rows.length; i++) {
    const listing = rows[i];
    const foepEntry = foepResp.responses[i]?.body;

    const { data: stockSnaps } = await supabase
      .from('wholesaler_stock_snapshots')
      .select('supplier, stock_qty, price, captured_at')
      .eq('product_id', listing.products.id)
      .order('captured_at', { ascending: false })
      .limit(10);

    const userPayload = {
      listing: {
        id: listing.id,
        platform: listing.platform,
        sku: listing.platform_listing_id,
        current_price: listing.current_price,
        current_source_supplier: listing.current_source_supplier,
        current_source_cost: listing.current_source_cost,
      },
      product: listing.products,
      foep: foepEntry ?? null,
      stock_snapshots: stockSnaps ?? [],
      preferences,
      trigger,
    };

    let completion;
    try {
      completion = await callAgentLLM(openrouter, {
        model: AGENT_MODEL,
        reasoningEffort: 'medium',
        systemPrompt: skill,
        userPayload,
      });
    } catch (err) {
      console.warn(
        `[repricer] LLM call failed for listing ${listing.id}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }
    await recordLLMUsage(supabase, completion, { pharmacyId });

    let parsed: z.infer<typeof OutputSchema>;
    try {
      const raw = JSON.parse(stripJsonFence(completion.choices[0]?.message?.content ?? '{}'));
      // Coerce common synonyms the skill prompt sometimes emits (briefing_type
      // values rather than the decision enum).
      if (raw && typeof raw === 'object' && typeof raw.decision === 'string') {
        const synonyms: Record<string, string> = {
          reprice_up: 'raise',
          reprice_down: 'drop',
          reprice_match: 'match_bb',
          match: 'match_bb',
          suspend: 'pause',
        };
        if (synonyms[raw.decision]) raw.decision = synonyms[raw.decision];
      }
      parsed = OutputSchema.parse(raw);
    } catch (err) {
      console.warn(
        `[repricer] could not parse output for listing ${listing.id}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    // Force the LLM-emitted listing_id to match what we asked about (defensive
    // guard: agent skill prompt could echo a wrong UUID).
    const adapterInput: RepricerOutput = {
      listing_id: listing.id,
      decision: parsed.decision,
      current_price: parsed.current_price,
      proposed_price: parsed.proposed_price,
      rationale: parsed.rationale,
      confidence: parsed.confidence,
    };
    const adapted = mapDecisionToBriefing(adapterInput);

    const { data: briefing, error: bErr } = await supabase
      .from('briefings')
      .insert({
        pharmacy_id: pharmacyId,
        source_agent: 'repricer',
        briefing_type: adapted.briefing_type,
        title: adapted.summary,
        summary: adapted.summary,
        rationale: parsed.rationale,
        confidence: parsed.confidence,
        urgency: adapted.urgency,
        related_entity_type: 'listings',
        related_entity_id: listing.id,
        proposed_actions: adapted.proposed_actions,
        data_snapshot: {
          kind: 'reprice_decision',
          decision: parsed.decision,
          current_price: parsed.current_price,
          proposed_price: parsed.proposed_price,
          margin_pct: parsed.margin_pct,
          foep: foepEntry ?? null,
          stock_snapshots: stockSnaps ?? [],
          trigger,
          signals_used: parsed.signals_used ?? [],
        } as Json,
      })
      .select('id')
      .single();
    if (bErr || !briefing) {
      console.warn(
        `[repricer] briefing insert failed for listing ${listing.id}:`,
        bErr?.message,
      );
      continue;
    }

    const { error: inboxErr } = await supabase.from('inbox_items').insert({
      pharmacy_id: pharmacyId,
      briefing_id: briefing.id,
      state: 'pending',
    });
    if (inboxErr) {
      console.warn(
        `[repricer] inbox_items insert failed for briefing ${briefing.id}:`,
        inboxErr.message,
      );
      continue;
    }

    proposed++;
  }

  return { proposed, evaluated: rows.length, capped: false };
}
