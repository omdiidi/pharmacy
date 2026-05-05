// Customer Success — webhook-driven, no cron.
// Two-stage pipeline:
//   Stage 1 (Triage, Haiku 4.5, low effort): classifies into
//     shipping | refund | general | medical_question | spam.
//   Stage 2 (Draft, Sonnet 4.6, medium effort): writes a voice-matched draft.
//     Skipped for medical_question (Kaleem replies personally) and spam (audit-only).
// Single briefing per inbound message. Spam emits no briefing.

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
  DraftOutputSchema,
  TriageOutputSchema,
  type DraftOutput,
} from './customer-success-output-schemas';
import { Sentry } from '@/lib/logger';

const HAIKU_MODEL = 'anthropic/claude-haiku-4.5';

type CustomerMessage = {
  customer_message_id: string;
  amazon_order_id?: string | null;
  customer_text: string;
  channel: 'amazon' | 'ebay';
};

type RunArgs = {
  trigger: 'webhook';
  event: {
    Payload: {
      CustomerMessageReceivedNotification?: {
        Message?: CustomerMessage;
      };
    };
  };
};

export type CustomerSuccessResult = {
  briefing_id: string | null;
  capped: boolean;
  classification?: string;
  draft?: boolean;
  error?: string;
};

export async function runCustomerSuccess(
  supabase: SupabaseClient<Database>,
  opts: { pharmacyId?: string } & RunArgs,
): Promise<CustomerSuccessResult> {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;

  const gate = await dailyBudgetGate(supabase, 'customer-success');
  if (gate.capped) return { briefing_id: null, capped: true };

  const msg = opts.event.Payload.CustomerMessageReceivedNotification?.Message;
  if (!msg) return { briefing_id: null, capped: false, error: 'no message in payload' };

  // Stage 1 — Triage.
  const triageSkill = await loadSkillPrompt('customer-triage');
  const triageCompletion = await callAgentLLM(openrouter, {
    model: HAIKU_MODEL,
    reasoningEffort: 'low',
    systemPrompt: triageSkill,
    userPayload: {
      message_id: msg.customer_message_id,
      customer_text: msg.customer_text,
      order_id: msg.amazon_order_id ?? null,
      pharmacy_id: pharmacyId,
    },
  });
  await recordLLMUsage(supabase, null, triageCompletion);
  let triage: ReturnType<typeof TriageOutputSchema.parse>;
  try {
    triage = TriageOutputSchema.parse(
      JSON.parse(stripJsonFence(triageCompletion.choices[0]?.message?.content ?? '{}')),
    );
  } catch (err) {
    Sentry.captureException(err, { tags: { agent: 'customer-success', stage: 'triage-parse' } });
    return { briefing_id: null, capped: false, error: 'triage_parse_error' };
  }

  // Spam → audit only, no briefing.
  if (triage.classification === 'spam') {
    await supabase.from('audit_log').insert({
      pharmacy_id: pharmacyId,
      actor: 'system:customer_success',
      action: 'classify_spam',
      target_entity_type: 'customer_messages',
      target_entity_id: null,
      params: {
        customer_message_id: msg.customer_message_id,
        customer_text: msg.customer_text,
      } as Json,
      result: { classification: 'spam' } as Json,
    });
    return { briefing_id: null, capped: false, classification: 'spam' };
  }

  // Stage 2 — Draft (skipped for medical_question).
  let draft: DraftOutput | null = null;
  let proposed_actions: Json;

  if (triage.classification === 'medical_question') {
    proposed_actions = [
      {
        kind: 'dismiss_briefing',
        label: 'Acknowledge — I will reply personally',
        variant: 'primary',
        params: {},
      },
    ] as Json;
  } else {
    const draftSkill = await loadSkillPrompt('customer-draft');
    const { data: prefMem } = await supabase
      .from('memory')
      .select('metadata')
      .eq('pharmacy_id', pharmacyId)
      .eq('kind', 'preferences')
      .eq('source', 'kaleem')
      .limit(1)
      .maybeSingle();
    const tonePrefs = (prefMem?.metadata as Record<string, unknown> | null) ?? {
      tone: 'warm-brief',
      sign_off: '— Kaleem',
    };

    const draftCompletion = await callAgentLLM(openrouter, {
      model: AGENT_MODEL,
      reasoningEffort: 'medium',
      systemPrompt: draftSkill,
      userPayload: {
        message_id: msg.customer_message_id,
        classification: triage.classification,
        customer_text: msg.customer_text,
        order_context: null,
        pharmacy_id: pharmacyId,
        tone_preferences: tonePrefs,
      },
    });
    await recordLLMUsage(supabase, null, draftCompletion);
    try {
      draft = DraftOutputSchema.parse(
        JSON.parse(stripJsonFence(draftCompletion.choices[0]?.message?.content ?? '{}')),
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { agent: 'customer-success', stage: 'draft-parse' } });
      return {
        briefing_id: null,
        capped: false,
        classification: triage.classification,
        error: 'draft_parse_error',
      };
    }

    proposed_actions = [
      {
        kind: 'send_reply',
        label: 'Send reply',
        variant: 'primary',
        params: {
          customer_message_id: msg.customer_message_id,
          amazon_order_id: msg.amazon_order_id ?? null,
          channel: msg.channel,
          proposed_text: draft.draft,
          classification: triage.classification,
          reasoning: draft.reasoning,
        },
      },
      { kind: 'dismiss_briefing', label: 'Skip', variant: 'secondary', params: {} },
    ] as Json;
  }

  const urgency =
    triage.classification === 'medical_question' ? 5 : triage.classification === 'refund' ? 4 : 3;
  const titlePrefix =
    triage.classification === 'medical_question'
      ? 'Medical question — reply personally'
      : `Customer ${triage.classification}`;

  const { data: briefing, error } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: pharmacyId,
      source_agent: 'customer_success',
      briefing_type: 'customer_message',
      title: titlePrefix,
      summary: msg.customer_text.slice(0, 200),
      rationale: draft?.reasoning ?? triage.reasoning,
      confidence: draft?.confidence ?? triage.confidence,
      urgency,
      proposed_actions,
      data_snapshot: {
        kind: 'customer_message',
        classification: triage.classification,
        customer_text: msg.customer_text,
        order_id: msg.amazon_order_id ?? null,
        channel: msg.channel,
        triage_reasoning: triage.reasoning,
        draft: draft?.draft ?? null,
      } as Json,
    })
    .select('id')
    .single();
  if (error || !briefing) {
    throw new Error(`customer-success briefing insert failed: ${error?.message}`);
  }

  await supabase.from('inbox_items').insert({
    pharmacy_id: pharmacyId,
    briefing_id: briefing.id,
    state: 'pending',
  });

  return {
    briefing_id: briefing.id,
    capped: false,
    classification: triage.classification,
    draft: !!draft,
  };
}
