// Listing Agent — single-pass LLM call per candidate.
// Pure logic; the cron entry at scripts/listing-agent.ts is a thin wrapper.

import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import { z } from 'zod';

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

export const LISTING_AGENT_MODEL = AGENT_MODEL;

const ListingAgentOutputSchema = z.object({
  title: z.string().nullable().optional(),
  bullets: z.array(z.string()).optional(),
  suggested_price_usd: z.number().optional(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  skip_reason: z.string().nullable().optional(),
});

type CandidateProduct = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  asin: string | null;
  upc: string | null;
  ndc: string | null;
  form: string | null;
  pack_size: string | null;
};

type RunResult = {
  proposed: number;
  skipped: number;
  capped: boolean;
};

export async function runListingAgent(
  supabase: SupabaseClient<Database>,
  opts: { maxCandidates?: number; pharmacyId?: string } = {},
): Promise<RunResult> {
  const maxCandidates = opts.maxCandidates ?? 5;
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;

  const gate = await dailyBudgetGate(supabase, 'listing-agent');
  if (gate.capped) return { proposed: 0, skipped: 0, capped: true };

  const { data: candidates, error: candErr } = await supabase
    .from('products')
    .select(
      `
      id, name, brand, category, asin, upc, ndc, form, pack_size,
      listings:listings!left(id, status),
      pending_listings:pending_listings!left(id, status)
    `,
    )
    .eq('pharmacy_id', pharmacyId)
    .eq('watchlist_status', 'watching')
    .limit(maxCandidates * 4);
  if (candErr) {
    throw new Error(`[listing-agent] candidate query failed: ${candErr.message}`);
  }

  type CandidateRow = CandidateProduct & {
    listings: { id: string; status: string }[] | null;
    pending_listings: { id: string; status: string }[] | null;
  };

  const eligible = ((candidates ?? []) as unknown as CandidateRow[])
    .filter(
      (p) =>
        !(p.listings ?? []).some((l) => l.status === 'active') &&
        !(p.pending_listings ?? []).some((pl) => pl.status === 'pending'),
    )
    .slice(0, maxCandidates);

  if (eligible.length === 0) {
    console.log(`[listing-agent] no eligible candidates for pharmacy ${pharmacyId}`);
    return { proposed: 0, skipped: 0, capped: false };
  }

  const skill = await loadSkillPrompt('listing-agent');

  // Pull the Kaleem preferences memory row once.
  const { data: prefMemory } = await supabase
    .from('memory')
    .select('metadata')
    .eq('pharmacy_id', pharmacyId)
    .eq('kind', 'preferences')
    .eq('source', 'kaleem')
    .limit(1)
    .maybeSingle();
  const preferences =
    (prefMemory?.metadata as Record<string, unknown> | null) ?? {
      min_margin_floor_pct: 25,
      max_scarcity_premium_pct: 300,
      risk_tolerance: 'conservative',
    };

  let proposed = 0;
  let skipped = 0;

  for (const product of eligible) {
    // Pull brand_authorization (pharmacy-specific override OR global default).
    let brandAuth: { status: string; notes: string | null } | null = null;
    if (product.brand) {
      const { data: ba } = await supabase
        .from('brand_authorization')
        .select('status, notes, pharmacy_id')
        .eq('brand', product.brand)
        .or(`pharmacy_id.eq.${pharmacyId},pharmacy_id.is.null`)
        .order('pharmacy_id', { ascending: false, nullsFirst: false })
        .limit(1);
      if (ba && ba[0]) brandAuth = { status: ba[0].status, notes: ba[0].notes };
    }

    const userPayload = {
      product: {
        id: product.id,
        name: product.name,
        brand: product.brand,
        category: product.category,
        asin: product.asin,
        upc: product.upc,
        ndc: product.ndc,
        form: product.form,
        pack_size: product.pack_size,
      },
      brand_authorization: brandAuth,
      preferences,
    };

    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await callAgentLLM(openrouter, {
        model: LISTING_AGENT_MODEL,
        reasoningEffort: 'medium',
        systemPrompt: skill,
        userPayload,
      });
    } catch (err) {
      console.warn(
        `[listing-agent] LLM call failed for product ${product.id}:`,
        err instanceof Error ? err.message : err,
      );
      skipped++;
      continue;
    }

    await recordLLMUsage(supabase, null, completion);

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const stripped = stripJsonFence(raw);
    let parsed: z.infer<typeof ListingAgentOutputSchema>;
    try {
      parsed = ListingAgentOutputSchema.parse(JSON.parse(stripped));
    } catch (err) {
      console.warn(
        `[listing-agent] could not parse model output for ${product.id}:`,
        err instanceof Error ? err.message : err,
      );
      skipped++;
      continue;
    }

    if (parsed.skip_reason) {
      console.log(`[listing-agent] skip ${product.id}: ${parsed.skip_reason}`);
      skipped++;
      continue;
    }

    if (
      !parsed.title ||
      !parsed.bullets ||
      parsed.bullets.length === 0 ||
      typeof parsed.suggested_price_usd !== 'number'
    ) {
      console.warn(`[listing-agent] incomplete proposal for ${product.id}; skipping`);
      skipped++;
      continue;
    }

    const proposedActions: Json = [
      {
        label: 'List on Amazon',
        variant: 'primary',
        kind: 'list_on_amazon',
        params: {
          product_id: product.id,
          proposed_title: parsed.title,
          proposed_bullets: parsed.bullets,
          proposed_price: parsed.suggested_price_usd,
          reasoning: parsed.reasoning,
        },
      },
      {
        label: 'Skip',
        variant: 'secondary',
        kind: 'dismiss_briefing',
        params: {},
      },
    ];

    const summary = `Propose listing ${product.name} at $${parsed.suggested_price_usd.toFixed(2)}.`;

    const { data: briefing, error: briefingErr } = await supabase
      .from('briefings')
      .insert({
        pharmacy_id: pharmacyId,
        source_agent: 'listing_agent',
        briefing_type: 'new_opportunity',
        title: `List ${product.name}`,
        summary,
        rationale: parsed.reasoning,
        confidence: parsed.confidence ?? 0.6,
        urgency: 3,
        related_entity_type: 'products',
        related_entity_id: product.id,
        proposed_actions: proposedActions,
      })
      .select('id')
      .single();
    if (briefingErr || !briefing) {
      console.warn(
        `[listing-agent] briefing insert failed for ${product.id}:`,
        briefingErr?.message,
      );
      skipped++;
      continue;
    }

    const { error: inboxErr } = await supabase.from('inbox_items').insert({
      pharmacy_id: pharmacyId,
      briefing_id: briefing.id,
      state: 'pending',
    });
    if (inboxErr) {
      console.warn(
        `[listing-agent] inbox_items insert failed for briefing ${briefing.id}:`,
        inboxErr.message,
      );
      skipped++;
      continue;
    }

    proposed++;
  }

  return { proposed, skipped, capped: false };
}
