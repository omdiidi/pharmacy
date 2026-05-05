// Chief of Staff Daily Digest. Daily 07:00 UTC cron. Reads briefings +
// inbox_items from last 24h, writes ONE digest briefing summarizing per-agent
// counts and key takeaways. Report-only (proposed_actions = []).

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

const DigestOutputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  takeaways: z.array(z.string()).min(1).max(10),
});

export type DigestResult = {
  briefing_id: string | null;
  capped: boolean;
  skipped: boolean;
};

type BriefingRow = {
  id: string;
  source_agent: string | null;
  briefing_type: string | null;
  title: string | null;
  summary: string | null;
  urgency: number | null;
  confidence: number | null;
  created_at: string | null;
  auto_executed: boolean | null;
};

export async function runChiefOfStaffDigest(
  supabase: SupabaseClient<Database>,
  opts: { pharmacyId?: string } = {},
): Promise<DigestResult> {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;

  const gate = await dailyBudgetGate(supabase, 'chief-of-staff-digest');
  if (gate.capped) return { briefing_id: null, capped: true, skipped: false };

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: briefings } = await supabase
    .from('briefings')
    .select(
      'id, source_agent, briefing_type, title, summary, urgency, confidence, created_at, auto_executed',
    )
    .eq('pharmacy_id', pharmacyId)
    .neq('source_agent', 'chief_of_staff_digest')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);

  if (!briefings || briefings.length === 0) {
    console.log('[digest] no activity in last 24h; skipping');
    return { briefing_id: null, capped: false, skipped: true };
  }

  // Phase 3 hardening: filter out auto_executed briefings (system-actioned —
  // not human-decision-relevant) and surface only urgent/account-health-red
  // briefings as digest tops.
  const recent = briefings as BriefingRow[];
  // NOTE: plan said `briefing_type === 'account_health_red'` but the enum
  // actually uses `account_health` (Wave 2 + Phase 1 schema). We honor the
  // spirit by matching the actual enum value plus the urgency threshold.
  const top = recent
    .filter((b) => !b.auto_executed)
    .filter(
      (b) => (b.urgency ?? 1) >= 4 || b.briefing_type === 'account_health',
    );

  const byAgent: Record<string, { count: number; top: BriefingRow[] }> = {};
  for (const b of recent) {
    const agent = b.source_agent ?? 'unknown';
    if (!byAgent[agent]) byAgent[agent] = { count: 0, top: [] };
    byAgent[agent].count++;
  }
  for (const b of top) {
    const agent = b.source_agent ?? 'unknown';
    if (!byAgent[agent]) byAgent[agent] = { count: 0, top: [] };
    byAgent[agent].top.push(b);
  }

  const skill = await loadSkillPrompt('chief-of-staff-digest');
  const completion = await callAgentLLM(openrouter, {
    model: AGENT_MODEL,
    reasoningEffort: 'low',
    systemPrompt: skill,
    userPayload: {
      window_hours: 24,
      briefings: (briefings as BriefingRow[]).slice(0, 50),
      by_agent: byAgent,
    },
  });
  await recordLLMUsage(supabase, null, completion);

  const raw = completion.choices[0]?.message?.content ?? '{}';
  let parsed: z.infer<typeof DigestOutputSchema>;
  try {
    parsed = DigestOutputSchema.parse(JSON.parse(stripJsonFence(raw)));
  } catch (err) {
    console.warn(
      '[digest] could not parse model output:',
      err instanceof Error ? err.message : err,
    );
    return { briefing_id: null, capped: false, skipped: false };
  }

  const { data: digestBriefing, error: insertErr } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: pharmacyId,
      source_agent: 'chief_of_staff_digest',
      briefing_type: 'digest',
      title: parsed.title,
      summary: parsed.summary,
      rationale: parsed.takeaways.join('\n'),
      confidence: 1,
      urgency: 2,
      proposed_actions: [] as unknown as Json,
      data_snapshot: {
        kind: 'daily_digest',
        window_hours: 24,
        by_agent: byAgent,
        takeaways: parsed.takeaways,
      } as Json,
    })
    .select('id')
    .single();
  if (insertErr || !digestBriefing) {
    console.warn('[digest] briefing insert failed:', insertErr?.message);
    return { briefing_id: null, capped: false, skipped: false };
  }
  await supabase.from('inbox_items').insert({
    pharmacy_id: pharmacyId,
    briefing_id: digestBriefing.id,
    state: 'pending',
  });
  return { briefing_id: digestBriefing.id, capped: false, skipped: false };
}
