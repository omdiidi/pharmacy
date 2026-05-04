// Account Health — daily 6am UTC + on ACCOUNT_STATUS_CHANGED webhook.
// Reads GET_V1_SELLER_PERFORMANCE_REPORT (real-or-fixture), persists into
// health_metrics, classifies green/yellow/red, calls the LLM for narrative,
// branches:
//   green  → reject-only briefing ("Acknowledge").
//   yellow → propose corrective actions (mapped to pause_listing if present).
//   red    → auto-pause contributing listings (capped at 5) + Twilio SMS +
//            briefing with acknowledge_health_alert primary action.

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
import { getReportsClient } from '@/lib/sp-api';
import { sendSms } from '@/lib/sms/twilio';
import { pauseListing } from '@/lib/executors/pause-listing';
import {
  classifyStatus,
  type HealthMetricsSnapshot,
  type HealthStatus,
} from './account-health-status-classifier';

const OutputSchema = z.object({
  status: z.enum(['green', 'yellow', 'red']),
  metrics: z.record(z.number()).optional(),
  contributing_listing_ids: z.array(z.string().uuid()).optional(),
  proposed_corrective_actions: z
    .array(
      z.object({
        kind: z.string(),
        label: z.string(),
        params: z.record(z.unknown()).optional().default({}),
      }),
    )
    .optional(),
  // Some skill outputs use `narrative` or `summary` instead of `reasoning`.
  reasoning: z.string().optional().default(''),
});

const MAX_AUTO_PAUSE = 5;

export type AccountHealthResult = {
  briefing_id: string | null;
  status?: HealthStatus;
  auto_paused_count: number;
  sms_sent: boolean;
  capped: boolean;
};

type SmsResult = { sent: boolean; sid?: string; reason?: string };

export async function runAccountHealth(
  supabase: SupabaseClient<Database>,
  opts: { pharmacyId?: string; trigger?: 'scheduled' | 'event'; event?: unknown } = {},
): Promise<AccountHealthResult> {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;
  const trigger = opts.trigger ?? 'scheduled';

  const gate = await dailyBudgetGate(supabase, 'account-health');
  if (gate.capped) {
    return { briefing_id: null, auto_paused_count: 0, sms_sent: false, capped: true };
  }

  const reports = getReportsClient();
  const snap: HealthMetricsSnapshot = await reports.fetchLatestSellerPerformance(pharmacyId);

  // Persist metrics for trendline.
  for (const [metric, value] of Object.entries({
    odr: snap.odr,
    late_ship: snap.late_ship_rate,
    cancellation: snap.cancellation_rate,
    vtr: snap.vtr,
    buybox_pct: snap.buybox_pct,
  })) {
    await supabase.from('health_metrics').insert({
      pharmacy_id: pharmacyId,
      platform: 'amazon',
      metric,
      value,
    });
  }

  const status = classifyStatus(snap);

  const thirtyAgo = new Date();
  thirtyAgo.setUTCDate(thirtyAgo.getUTCDate() - 30);
  const { data: trendline } = await supabase
    .from('health_metrics')
    .select('metric, value, captured_at')
    .eq('pharmacy_id', pharmacyId)
    .gte('captured_at', thirtyAgo.toISOString())
    .order('captured_at', { ascending: true });

  const skill = await loadSkillPrompt('account-health');
  const userPayload = {
    pharmacy_id: pharmacyId,
    status,
    metrics: snap,
    trendline_30d: trendline ?? [],
    trigger,
    event: opts.event ?? null,
    note:
      status === 'green'
        ? 'Emit a no-op briefing only if trendline shows degradation.'
        : status === 'yellow'
          ? 'Propose corrective actions (kind: pause_listing) for at-risk listings.'
          : 'Red — auto-pause path will fire after this LLM call.',
  };

  const completion = await callAgentLLM(openrouter, {
    model: AGENT_MODEL,
    reasoningEffort: 'medium',
    systemPrompt: skill,
    userPayload,
  });
  await recordLLMUsage(supabase, null, completion);

  let parsed: z.infer<typeof OutputSchema>;
  try {
    parsed = OutputSchema.parse(
      JSON.parse(stripJsonFence(completion.choices[0]?.message?.content ?? '{}')),
    );
  } catch (err) {
    throw new Error(
      `[account-health] could not parse LLM output: ${err instanceof Error ? err.message : err}`,
    );
  }

  let proposed_actions: Json = [];
  let urgency = 2;
  const autoPaused: string[] = [];
  let smsSent: SmsResult | null = null;

  const contributingIds = parsed.contributing_listing_ids ?? [];

  if (status === 'red' && contributingIds.length > MAX_AUTO_PAUSE) {
    urgency = 5;
    smsSent = await sendSms(
      `PHARMADASH ALERT: Red status, ${contributingIds.length} listings affected — too many for auto-pause. Open inbox.`,
    );
    proposed_actions = [
      {
        kind: 'acknowledge_health_alert',
        label: 'Acknowledge alert',
        variant: 'primary',
        params: { skipped_auto_pause: true, contributing_count: contributingIds.length },
      },
      { kind: 'dismiss_briefing', label: 'Dismiss', variant: 'secondary', params: {} },
    ] as Json;
  } else if (status === 'red') {
    urgency = 5;
    for (const lid of contributingIds) {
      try {
        const result = await pauseListing.forward(
          {
            listing_id: lid,
            triggered_by: 'account_health_red_auto',
            reasoning: parsed.reasoning,
          },
          { pharmacyId, userId: 'system:account_health' },
        );
        const undoExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await supabase.from('audit_log').insert({
          pharmacy_id: pharmacyId,
          actor: 'system:account_health',
          action: 'pause_listing',
          target_entity_type: 'listings',
          target_entity_id: lid,
          params: {
            listing_id: lid,
            triggered_by: 'account_health_red_auto',
            reasoning: parsed.reasoning,
          } as Json,
          result: result as Json,
          undo_window_expires_at: undoExpiry,
        });
        autoPaused.push(lid);
      } catch (err) {
        console.warn(
          `[account-health] auto-pause failed for ${lid}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    smsSent = await sendSms(
      `PHARMADASH ALERT: Account health RED. ${autoPaused.length} listings auto-paused. Open inbox to acknowledge.`,
    );
    proposed_actions = [
      {
        kind: 'acknowledge_health_alert',
        label: 'Acknowledge alert',
        variant: 'primary',
        params: { auto_paused_ids: autoPaused },
      },
      { kind: 'dismiss_briefing', label: 'Dismiss', variant: 'secondary', params: {} },
    ] as Json;
  } else if (status === 'yellow') {
    urgency = 3;
    type ActionEntry = { kind: string; label: string; variant: string; params: Record<string, unknown> };
    const mapped: ActionEntry[] = [];
    let primaryAssigned = false;
    for (const a of parsed.proposed_corrective_actions ?? []) {
      if (a.kind === 'pause_listing') {
        mapped.push({
          kind: 'pause_listing',
          label: a.label,
          variant: primaryAssigned ? 'secondary' : 'primary',
          params: { ...a.params, triggered_by: 'kaleem_click', reasoning: parsed.reasoning },
        });
        primaryAssigned = true;
      }
      // Other kinds are informational only in Wave 2; surface them in data_snapshot.
    }
    proposed_actions =
      mapped.length > 0
        ? (mapped as Json)
        : ([{ kind: 'dismiss_briefing', label: 'Acknowledge', variant: 'secondary', params: {} }] as Json);
  } else {
    // green — reject-only ("Acknowledge")
    urgency = 2;
    proposed_actions = [] as Json;
  }

  const summary = `${status.toUpperCase()} — ODR ${snap.odr.toFixed(3)}, Late ship ${(snap.late_ship_rate * 100).toFixed(1)}%, Cancel ${(snap.cancellation_rate * 100).toFixed(1)}%, VTR ${(snap.vtr * 100).toFixed(0)}%, BuyBox ${(snap.buybox_pct * 100).toFixed(0)}%.`;

  const { data: briefing, error } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: pharmacyId,
      source_agent: 'account_health',
      briefing_type: 'account_health',
      title: `Account health: ${status.toUpperCase()}`,
      summary,
      rationale: parsed.reasoning,
      confidence: 0.9,
      urgency,
      proposed_actions,
      data_snapshot: {
        kind: 'account_health_snapshot',
        status,
        metrics: snap,
        trigger,
        auto_paused_listings: autoPaused,
        sms: smsSent,
        unmapped_corrective_actions: (parsed.proposed_corrective_actions ?? []).filter(
          (a) => a.kind !== 'pause_listing',
        ),
      } as Json,
    })
    .select('id')
    .single();
  if (error || !briefing) {
    throw new Error(`account-health briefing insert failed: ${error?.message}`);
  }

  await supabase.from('inbox_items').insert({
    pharmacy_id: pharmacyId,
    briefing_id: briefing.id,
    state: 'pending',
  });

  return {
    briefing_id: briefing.id,
    status,
    auto_paused_count: autoPaused.length,
    sms_sent: smsSent?.sent ?? false,
    capped: false,
  };
}
