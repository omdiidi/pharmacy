// Reflector agent — weekly distillation.
// Reads last 7 days of audit_log (Kaleem-driven actions only — every approve/
// reject targets inbox_items; we exclude compensating undo:* rows) plus the
// week's briefings and their inbox_items.state. Writes memory rows
// (procedural / semantic / preferences) plus a summary briefing.

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import { openrouter } from '@/lib/llm';
import { recordLLMUsage } from '@/lib/budget';
import { writeMemory } from '@/lib/memory/write';
import {
  AGENT_MODEL,
  DEFAULT_PHARMACY_ID,
  callAgentLLM,
  dailyBudgetGate,
  loadSkillPrompt,
  stripJsonFence,
} from './_shared';

const PatternSchema = z.object({
  summary: z.string(),
  kind: z.enum(['procedural', 'semantic', 'preferences']),
  importance: z.number().min(0).max(1),
  metadata: z.record(z.unknown()).optional(),
  related_entity_type: z.string().nullable().optional(),
  related_entity_id: z.string().uuid().nullable().optional(),
});

const OutputSchema = z.object({
  week_of: z.string(),
  patterns: z.array(PatternSchema),
  preferences_update: z.record(z.unknown()).nullable(),
  reasoning: z.string(),
});

export type ReflectorResult = {
  briefing_id: string | null;
  capped: boolean;
  memory_count?: number;
  pattern_count?: number;
};

export async function runReflector(
  supabase: SupabaseClient<Database>,
  opts: { pharmacyId?: string; weekOf?: Date } = {},
): Promise<ReflectorResult> {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;
  const now = opts.weekOf ?? new Date();
  const weekEnd = new Date(now);
  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  weekStart.setUTCHours(0, 0, 0, 0);

  const gate = await dailyBudgetGate(supabase, 'reflector');
  if (gate.capped) return { briefing_id: null, capped: true };

  const { data: audit } = await supabase
    .from('audit_log')
    .select(
      'id, actor, action, target_entity_type, target_entity_id, params, result, undo_window_expires_at, undone_at, created_at',
    )
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', weekStart.toISOString())
    .lte('created_at', weekEnd.toISOString())
    .order('created_at', { ascending: true });

  const { data: briefings } = await supabase
    .from('briefings')
    .select(
      'id, source_agent, briefing_type, title, summary, confidence, urgency, created_at, related_entity_type, related_entity_id',
    )
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', weekStart.toISOString())
    .lte('created_at', weekEnd.toISOString());

  const inboxIds = (briefings ?? []).map((b) => b.id);
  type InboxRow = {
    id: string;
    briefing_id: string;
    state: string;
    acted_at: string | null;
    action_taken: string | null;
    dismissed_reason: string | null;
  };
  const inbox: InboxRow[] =
    inboxIds.length > 0
      ? ((
          await supabase
            .from('inbox_items')
            .select('id, briefing_id, state, acted_at, action_taken, dismissed_reason')
            .in('briefing_id', inboxIds)
        ).data as InboxRow[] | null) ?? []
      : [];
  const stateByBriefing = new Map<string, string>(
    inbox.map((r) => [r.briefing_id, r.state]),
  );

  const filteredAudit = (audit ?? []).filter(
    (a) =>
      a.target_entity_type === 'inbox_items' &&
      !(a.action ?? '').startsWith('undo:'),
  );

  const userPayload = {
    pharmacy_id: pharmacyId,
    week_of: weekStart.toISOString(),
    trigger: 'scheduled',
    audit_log: filteredAudit,
    briefings: (briefings ?? []).map((b) => ({
      ...b,
      inbox_state: stateByBriefing.get(b.id) ?? 'unknown',
    })),
    note:
      filteredAudit.length === 0 && (briefings?.length ?? 0) === 0
        ? 'First reflection — no patterns yet. Emit empty patterns and a placeholder summary.'
        : 'Standard weekly reflection.',
  };

  const skill = await loadSkillPrompt('reflector');
  const completion = await callAgentLLM(openrouter, {
    model: AGENT_MODEL,
    reasoningEffort: 'high', // skill says Opus thinking_budget high
    systemPrompt: skill,
    userPayload,
    jsonOutputSchema: `{
  "week_of": "ISO timestamp",
  "patterns": [
    {
      "summary": "string",
      "kind": "procedural" | "semantic" | "preferences",
      "importance": number (0-1),
      "metadata": { ... } (optional),
      "related_entity_type": "string" | null (optional),
      "related_entity_id": "uuid" | null (optional)
    }
  ],
  "preferences_update": { ... } | null,
  "reasoning": "string"
}`,
  });
  await recordLLMUsage(supabase, null, completion);

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = OutputSchema.parse(JSON.parse(stripJsonFence(raw)));

  const memoryIds: string[] = [];
  for (const pattern of parsed.patterns) {
    const result = await writeMemory(supabase, {
      pharmacyId,
      kind: pattern.kind,
      source: 'reflector',
      content: pattern.summary,
      metadata: pattern.metadata ?? {},
      importance: pattern.importance,
      relatedEntityType: pattern.related_entity_type ?? null,
      relatedEntityId: pattern.related_entity_id ?? null,
    });
    memoryIds.push(result.id);
  }

  if (parsed.preferences_update) {
    await writeMemory(supabase, {
      pharmacyId,
      kind: 'preferences',
      source: 'reflector',
      content: `Preferences update for ${parsed.week_of}: ${JSON.stringify(parsed.preferences_update)}`,
      metadata: parsed.preferences_update,
      importance: 0.7,
    });
  }

  const dataSnapshot: Json = {
    kind: 'weekly_reflection',
    ...parsed,
    memory_ids: memoryIds,
  } as unknown as Json;

  const { data: briefing, error } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: pharmacyId,
      source_agent: 'reflector',
      briefing_type: 'strategic',
      title: `Weekly reflection for ${parsed.week_of}`,
      summary: `${parsed.patterns.length} patterns extracted. ${parsed.preferences_update ? 'Preferences updated.' : 'No preferences change.'}`,
      rationale: parsed.reasoning,
      confidence: 0.7,
      urgency: 2,
      proposed_actions: [] as unknown as Json,
      data_snapshot: dataSnapshot,
    })
    .select('id')
    .single();
  if (error || !briefing) {
    throw new Error(`reflector briefing insert failed: ${error?.message}`);
  }

  const { error: inboxErr } = await supabase.from('inbox_items').insert({
    pharmacy_id: pharmacyId,
    briefing_id: briefing.id,
    state: 'pending',
  });
  if (inboxErr) {
    throw new Error(`reflector inbox_items insert failed: ${inboxErr.message}`);
  }

  return {
    briefing_id: briefing.id,
    capped: false,
    memory_count: memoryIds.length,
    pattern_count: parsed.patterns.length,
  };
}
