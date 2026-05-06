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
import { envIsRealValue } from '@/lib/env-gate';
import { approveOne, type ApproveContext } from '@/lib/kernel/approve';
import { Sentry } from '@/lib/logger';
import {
  classifyStatus,
  type HealthMetricsSnapshot,
  type HealthStatus,
} from './account-health-status-classifier';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SYSTEM_CTX: Pick<ApproveContext, 'userId' | 'email' | 'actorKind' | 'actorLabel'> = {
  // Sentinel UUID — actor_kind='system' marks this row as non-human; actor_user_id is not enforced.
  userId: '00000000-0000-0000-0000-000000000000',
  email: 'system+account-health@pharm1.local',
  actorKind: 'system',
  actorLabel: 'account_health',
};

/**
 * Create a briefing+inbox_item pair for an auto-pause action and return
 * the inbox_item.id so the caller can immediately route it through
 * approveOne with actor_kind='system'. Sets briefings.auto_executed = true
 * so the Daily Digest can filter system-actioned items out of the human
 * review feed.
 */
async function emitAutoPauseBriefing(
  supabase: SupabaseClient<Database>,
  args: {
    pharmacyId: string;
    listingId: string;
    autoExecuted: boolean;
    reasoning: string;
    triggeredBy: string;
  },
): Promise<string> {
  const { data: briefing, error: briefErr } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: args.pharmacyId,
      source_agent: 'account_health',
      briefing_type: 'account_health',
      title: `Auto-pause listing ${args.listingId}`,
      summary: `Account health red — auto-pausing listing ${args.listingId}.`,
      rationale: args.reasoning,
      confidence: 0.9,
      urgency: 5,
      auto_executed: args.autoExecuted,
      proposed_actions: [
        {
          kind: 'pause_listing',
          label: 'Pause listing',
          variant: 'primary',
          params: {
            listing_id: args.listingId,
            triggered_by: args.triggeredBy,
            reasoning: args.reasoning,
          },
        },
      ] as Json,
      data_snapshot: {
        kind: 'auto_pause_briefing',
        listing_id: args.listingId,
        triggered_by: args.triggeredBy,
      } as Json,
    })
    .select('id')
    .single();
  if (briefErr || !briefing) {
    throw new Error(`emitAutoPauseBriefing: briefing insert failed: ${briefErr?.message}`);
  }

  const { data: item, error: itemErr } = await supabase
    .from('inbox_items')
    .insert({
      pharmacy_id: args.pharmacyId,
      briefing_id: briefing.id,
      state: 'pending',
    })
    .select('id')
    .single();
  if (itemErr || !item) {
    throw new Error(`emitAutoPauseBriefing: inbox_item insert failed: ${itemErr?.message}`);
  }
  return item.id;
}

const OutputSchema = z.object({
  status: z.enum(['green', 'yellow', 'red']),
  metrics: z.record(z.number()).optional(),
  contributing_listing_ids: z.array(z.string().min(1)).optional(),
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
  await recordLLMUsage(supabase, completion, { pharmacyId });

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

  // SMS-must-prove gate: before entering any red-status auto-pause path, check
  // whether the SMS alert channel is configured. If the alert path is unproven
  // (creds or numbers missing), refuse to auto-pause — silently flipping
  // listings without a working alert is the worst failure mode. The actual
  // Twilio send happens AFTER the briefing is inserted (so we can use
  // briefing.id as the sms_sends dedupe key — see P4.7).
  let smsPathUnproven = false;
  if (status === 'red') {
    const credsOk =
      envIsRealValue('TWILIO_ACCOUNT_SID') &&
      envIsRealValue('TWILIO_AUTH_TOKEN') &&
      envIsRealValue('KALEEM_SMS_NUMBER') &&
      envIsRealValue('TWILIO_FROM_NUMBER');
    if (!credsOk) {
      smsPathUnproven = true;
      smsSent = { sent: false, reason: 'twilio-creds-missing' };
    }
  }

  if (status === 'red' && smsPathUnproven) {
    urgency = 5;
    proposed_actions = [
      {
        kind: 'acknowledge_health_alert',
        label: 'Acknowledge alert',
        variant: 'primary',
        params: {
          sms_path_unproven: true,
          would_have_paused: contributingIds.slice(0, MAX_AUTO_PAUSE),
        },
      },
      { kind: 'dismiss_briefing', label: 'Dismiss', variant: 'secondary', params: {} },
    ] as Json;
  } else if (status === 'red' && contributingIds.length > MAX_AUTO_PAUSE) {
    urgency = 5;
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
    const validIds = contributingIds.filter((id) => UUID_RE.test(id));
    if (validIds.length < contributingIds.length) {
      Sentry.captureMessage('[account-health] non-UUID listing ids filtered', {
        level: 'warning',
      });
    }

    for (const lid of validIds) {
      let inboxItemId: string | null = null;
      try {
        inboxItemId = await emitAutoPauseBriefing(supabase, {
          pharmacyId,
          listingId: lid,
          autoExecuted: true,
          reasoning: parsed.reasoning ?? 'account_health red',
          triggeredBy: 'account_health_red_auto',
        });

        const r = await approveOne(supabase, inboxItemId, 0, {
          pharmacyId,
          ...SYSTEM_CTX,
        });
        if (!r.ok) {
          // Compensate: mark the briefing's inbox row dismissed so it surfaces
          // in digests as a system-failure (Kaleem reviews manually).
          await supabase
            .from('inbox_items')
            .update({ state: 'dismissed', dismissed_reason: 'system_executor_failed' })
            .eq('id', inboxItemId);
          Sentry.captureMessage(`auto-pause approveOne failed: ${r.error}`, {
            level: 'error',
            tags: { listing_id: lid, briefing_id: inboxItemId },
          });
          continue;
        }
        autoPaused.push(lid);
      } catch (err) {
        Sentry.captureException(err, {
          tags: { agent: 'account-health', stage: 'auto-pause', listing_id: lid },
        });
        // If briefing was created but approveOne threw, dismiss it.
        if (inboxItemId) {
          await supabase
            .from('inbox_items')
            .update({ state: 'dismissed', dismissed_reason: 'system_executor_failed' })
            .eq('id', inboxItemId);
        }
      }
    }
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
        sms_path_unproven: smsPathUnproven,
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

  // Now that we have briefing.id, send the SMS alert (deduped by briefing_id).
  // Skip when status is not red OR creds are unproven (already short-circuited).
  if (status === 'red' && !smsPathUnproven) {
    smsSent = await sendSms(
      `PHARMADASH ALERT: Account health RED for pharmacy ${pharmacyId}. Manual review required.`,
      briefing.id,
      supabase,
    );
    // Update data_snapshot.sms post-hoc so the briefing reflects the actual outcome.
    await supabase
      .from('briefings')
      .update({
        data_snapshot: {
          kind: 'account_health_snapshot',
          status,
          metrics: snap,
          trigger,
          auto_paused_listings: autoPaused,
          sms: smsSent,
          sms_path_unproven: smsPathUnproven,
          unmapped_corrective_actions: (parsed.proposed_corrective_actions ?? []).filter(
            (a) => a.kind !== 'pause_listing',
          ),
        } as Json,
      })
      .eq('id', briefing.id);
  }

  return {
    briefing_id: briefing.id,
    status,
    auto_paused_count: autoPaused.length,
    sms_sent: smsSent?.sent ?? false,
    capped: false,
  };
}
