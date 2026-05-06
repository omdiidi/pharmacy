// Research Analyst — single-pass LLM call, daily 06:15 UTC cron.
// Pulls FDA shortage + recall + Keepa deals + our watching products,
// scores 5–10 candidates, emits new_opportunity / rx_shortage_adjacency /
// fda_recall_triggered briefings. Per locked decision 3, no 8-fanout.

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
import { getActiveOtcShortages, getRecentDrugRecalls } from '@/lib/fda';
import { getKeepaClient } from '@/lib/keepa';
import {
  pickToBriefingType,
  pickToProposedActions,
  type ResearchPick,
} from './research-analyst-output-adapter';

const PickSchema = z.object({
  product_id: z.string().uuid().nullable(),
  candidate_name: z.string(),
  ndc: z.string().nullable(),
  asin: z.string().nullable(),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  urgency: z.number().min(1).max(5).transform((v) => Math.round(v)),
  rationale: z.string(),
  signals: z.array(z.string()),
});

const OutputSchema = z.object({
  picks: z.array(PickSchema).min(0).max(10),
});

export type ResearchAnalystResult = {
  proposed: number;
  briefing_ids: string[];
  capped: boolean;
};

export async function runResearchAnalyst(
  supabase: SupabaseClient<Database>,
  opts: { pharmacyId?: string } = {},
): Promise<ResearchAnalystResult> {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;

  const gate = await dailyBudgetGate(supabase, 'research-analyst');
  if (gate.capped) return { proposed: 0, briefing_ids: [], capped: true };

  // 1. External signals (cred-gated; degrades to empty/fixture).
  const sinceIso = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [shortages, recalls, deals] = await Promise.all([
    getActiveOtcShortages(50).catch((err) => {
      console.warn('[research-analyst] FDA shortage failed:', err);
      return [];
    }),
    getRecentDrugRecalls({ since: sinceIso, limit: 50 }).catch((err) => {
      console.warn('[research-analyst] FDA recall failed:', err);
      return [];
    }),
    getKeepaClient()
      .getRecentDeals({ dateRange: 1, limit: 50 })
      .catch((err) => {
        console.warn('[research-analyst] Keepa deals failed:', err);
        return [];
      }),
  ]);

  // 2. Internal context.
  const { data: watchingProducts } = await supabase
    .from('products')
    .select('id, name, ndc, brand, watchlist_status, asin')
    .eq('pharmacy_id', pharmacyId)
    .in('watchlist_status', ['watching', 'evaluating'])
    .limit(100);

  const { data: prefMem } = await supabase
    .from('memory')
    .select('content, metadata')
    .eq('pharmacy_id', pharmacyId)
    .eq('kind', 'preferences')
    .eq('source', 'kaleem')
    .limit(1)
    .maybeSingle();

  // 3. Single-pass LLM call. The Phase 1 skill mentions LLM web search and
  // 8-fanout; we override at runtime per locked decision 22.
  const skill = await loadSkillPrompt('research-analyst');
  const skillNoWebSearch =
    skill +
    '\n\n---\n## Wave 3 runtime override\n' +
    '- This call runs single-pass. Do NOT call WebSearch.\n' +
    '- Score from the provided signals + watching list only.\n' +
    '- Emit JSON only with shape `{ picks: [{ product_id, candidate_name, ndc, asin, score, confidence, urgency, rationale, signals }, ...] }`.\n' +
    '- `product_id` MUST be a uuid from `watching_products[].id` or null. Never fabricate.\n' +
    '- `signals` items use prefixes: `fda_shortage:<name>`, `fda_recall:<name>`, `keepa_drop:<asin>:<pct>`, `internal:<note>`.';

  const userPayload = {
    shortages: shortages.slice(0, 25),
    recalls: recalls.slice(0, 25),
    keepa_deals: deals.slice(0, 50),
    watching_products: watchingProducts ?? [],
    preferences: prefMem?.metadata ?? {},
  };

  const completion = await callAgentLLM(openrouter, {
    model: AGENT_MODEL,
    reasoningEffort: 'medium',
    systemPrompt: skillNoWebSearch,
    userPayload,
  });
  await recordLLMUsage(supabase, completion, { pharmacyId });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  let parsed: z.infer<typeof OutputSchema>;
  try {
    parsed = OutputSchema.parse(JSON.parse(stripJsonFence(raw)));
  } catch (err) {
    console.warn(
      '[research-analyst] could not parse model output:',
      err instanceof Error ? err.message : err,
    );
    return { proposed: 0, briefing_ids: [], capped: false };
  }

  // 3a. Post-parse validation — drop hallucinated product_ids to null.
  const watchingIds = new Set((watchingProducts ?? []).map((p) => p.id));
  for (const pick of parsed.picks) {
    if (pick.product_id && !watchingIds.has(pick.product_id)) {
      console.warn(
        `[research-analyst] LLM emitted unknown product_id ${pick.product_id}; setting null`,
      );
      pick.product_id = null;
    }
  }

  // 4. Per-pick: insert briefing + inbox row.
  const briefingIds: string[] = [];
  for (const pickRaw of parsed.picks) {
    const pick = pickRaw as ResearchPick;
    const briefingType = pickToBriefingType(pick);
    const proposedActions = pickToProposedActions(pick);

    const { data: briefing, error: briefingErr } = await supabase
      .from('briefings')
      .insert({
        pharmacy_id: pharmacyId,
        source_agent: 'research_analyst',
        briefing_type: briefingType,
        title: `${pick.candidate_name}: score ${pick.score}/100`,
        summary: pick.rationale.slice(0, 240),
        rationale: pick.rationale,
        confidence: pick.confidence,
        urgency: pick.urgency,
        related_entity_type: pick.product_id ? 'products' : null,
        related_entity_id: pick.product_id,
        proposed_actions: proposedActions as unknown as Json,
        data_snapshot: {
          kind: 'research_pick',
          pick,
          signals_used: pick.signals,
        } as Json,
      })
      .select('id')
      .single();
    if (briefingErr || !briefing) {
      console.warn(
        '[research-analyst] briefing insert failed:',
        briefingErr?.message,
      );
      continue;
    }
    briefingIds.push(briefing.id);
    await supabase.from('inbox_items').insert({
      pharmacy_id: pharmacyId,
      briefing_id: briefing.id,
      state: 'pending',
    });
  }

  return { proposed: briefingIds.length, briefing_ids: briefingIds, capped: false };
}
