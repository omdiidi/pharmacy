// Portfolio Manager agent — weekly strategic review.
// Reads last-30d audit_log, briefings, products, plus top 50 memory rows by
// importance. Asks the model for ≤3 strategic moves. The output adapter maps
// each move's proposed_action to one of the kernel executors; unmappable moves
// surface as informational entries in data_snapshot.unmapped_moves[].

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
  PortfolioManagerOutputSchema,
  ProposedActionSchema,
} from './portfolio-manager-output-adapter';

export type PortfolioManagerResult = {
  briefing_id: string | null;
  capped: boolean;
  action_count?: number;
  unmapped_count?: number;
};

export async function runPortfolioManager(
  supabase: SupabaseClient<Database>,
  opts: { pharmacyId?: string; weekOf?: Date } = {},
): Promise<PortfolioManagerResult> {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;
  const now = opts.weekOf ?? new Date();
  const thirtyAgo = new Date(now);
  thirtyAgo.setUTCDate(thirtyAgo.getUTCDate() - 30);

  const gate = await dailyBudgetGate(supabase, 'portfolio-manager');
  if (gate.capped) return { briefing_id: null, capped: true };

  const { data: audit } = await supabase
    .from('audit_log')
    .select('action, target_entity_type, target_entity_id, params, created_at')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', thirtyAgo.toISOString());

  const { data: briefings } = await supabase
    .from('briefings')
    .select(
      'id, source_agent, briefing_type, title, urgency, confidence, related_entity_type, related_entity_id, created_at',
    )
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', thirtyAgo.toISOString());

  const { data: products } = await supabase
    .from('products')
    .select('id, name, brand, category, watchlist_status')
    .eq('pharmacy_id', pharmacyId);

  const { data: memory } = await supabase
    .from('memory')
    .select(
      'kind, source, content, importance, related_entity_type, related_entity_id, metadata, created_at',
    )
    .eq('pharmacy_id', pharmacyId)
    .order('importance', { ascending: false })
    .limit(50);

  const userPayload = {
    pharmacy_id: pharmacyId,
    week_of: now.toISOString(),
    trigger: 'scheduled',
    products: products ?? [],
    audit_log_30d: audit ?? [],
    briefings_30d: briefings ?? [],
    memory_top_50: memory ?? [],
    available_executor_kinds: ['add_to_watchlist', 'pause_brand', 'flag_anomaly'],
    note:
      'Emit at most 3 strategic_moves. For each move, set proposed_action to ' +
      'one of the available_executor_kinds with valid params — or null if the ' +
      'move is informational only or targets an agent not yet shipped.',
  };

  const skill = await loadSkillPrompt('portfolio-manager');
  const completion = await callAgentLLM(openrouter, {
    model: AGENT_MODEL,
    reasoningEffort: 'medium',
    systemPrompt: skill,
    userPayload,
    jsonOutputSchema: `{
  "week_of": "ISO timestamp",
  "top_sellers": [{ "product_id": "uuid", "ttm_net": number }] (optional),
  "dead_inventory": [{ "product_id": "uuid", "days_since_sale": number }] (optional),
  "strategic_moves": [
    {
      "move": "string (one-line move description)",
      "rationale": "string",
      "target_agent": "string (e.g. listing_agent, repricer, account_health)",
      "success_metric": "string",
      "proposed_action": null OR one of:
        { "kind": "add_to_watchlist", "params": { "product_ids": ["uuid", ...], "reason": "string" } }
        { "kind": "pause_brand", "params": { "brand": "string", "reason": "string", "until": "YYYY-MM-DD" } }
        { "kind": "flag_anomaly", "params": { "anomaly_type": "string", "related_entity_type": "string", "related_ids": ["uuid", ...], "severity": "info"|"warn"|"critical", "reason": "string" } }
    }
  ] (max 3 items),
  "reasoning": "string"
}`,
  });
  await recordLLMUsage(supabase, null, completion);

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = PortfolioManagerOutputSchema.parse(JSON.parse(stripJsonFence(raw)));

  const proposed_actions: Array<{
    label: string;
    variant: string;
    kind: string;
    params: unknown;
  }> = [];
  const unmapped: Array<{ move: string; rationale: string; target_agent: string }> = [];
  for (let i = 0; i < parsed.strategic_moves.length; i++) {
    const m = parsed.strategic_moves[i];
    if (!m.proposed_action) {
      unmapped.push({
        move: m.move,
        rationale: m.rationale,
        target_agent: m.target_agent,
      });
      continue;
    }
    const validated = ProposedActionSchema.safeParse(m.proposed_action);
    if (!validated.success) {
      unmapped.push({
        move: m.move,
        rationale: m.rationale,
        target_agent: m.target_agent,
      });
      continue;
    }
    proposed_actions.push({
      label: m.move.slice(0, 80),
      variant: i === 0 ? 'primary' : 'secondary',
      kind: validated.data.kind,
      params: validated.data.params,
    });
  }

  const dataSnapshot: Json = {
    kind: 'weekly_strategy',
    ...parsed,
    unmapped_moves: unmapped,
  } as unknown as Json;

  const { data: briefing, error } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: pharmacyId,
      source_agent: 'portfolio_manager',
      briefing_type: 'strategic',
      title: `Weekly strategy for ${parsed.week_of}`,
      summary:
        `${parsed.strategic_moves.length} moves proposed ` +
        `(${proposed_actions.length} actionable). ${unmapped.length} informational.`,
      rationale: parsed.reasoning,
      confidence: 0.7,
      urgency: 4,
      proposed_actions: proposed_actions as unknown as Json,
      data_snapshot: dataSnapshot,
    })
    .select('id')
    .single();
  if (error || !briefing) {
    throw new Error(`portfolio-manager briefing insert failed: ${error?.message}`);
  }

  const { error: inboxErr } = await supabase.from('inbox_items').insert({
    pharmacy_id: pharmacyId,
    briefing_id: briefing.id,
    state: 'pending',
  });
  if (inboxErr) {
    throw new Error(`portfolio-manager inbox_items insert failed: ${inboxErr.message}`);
  }

  return {
    briefing_id: briefing.id,
    capped: false,
    action_count: proposed_actions.length,
    unmapped_count: unmapped.length,
  };
}
