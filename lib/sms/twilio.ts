// Twilio SMS — credential-gated. Caller-side dedupe via the sms_sends table
// (Twilio v6 SDK doesn't expose an idempotencyKey on messages.create, so we
// guard at the briefing-id boundary — see P4.7).
//
// Returns { sent: false, reason } when creds missing or numbers malformed.
// Account Health's red branch is the only caller in Wave 2.

import twilio from 'twilio';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { envIsRealValue } from '@/lib/env-gate';

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!envIsRealValue('TWILIO_ACCOUNT_SID') || !envIsRealValue('TWILIO_AUTH_TOKEN')) return null;
  if (!client) client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  return client;
}

const E164_RE = /^\+[1-9]\d{1,14}$/;

export async function sendSms(
  body: string,
  briefingId: string,
  supabase: SupabaseClient<Database>,
): Promise<{ sent: boolean; sid?: string; reason?: string }> {
  const c = getClient();
  if (!c) {
    console.log(`[sms-stub] would send (creds missing): ${body}`);
    return { sent: false, reason: 'twilio-creds-missing' };
  }
  if (!envIsRealValue('KALEEM_SMS_NUMBER') || !envIsRealValue('TWILIO_FROM_NUMBER')) {
    console.log(`[sms-stub] would send (missing TO/FROM): ${body}`);
    return { sent: false, reason: 'phone-numbers-missing' };
  }
  const from = process.env.TWILIO_FROM_NUMBER!;
  const to = process.env.KALEEM_SMS_NUMBER!;
  if (!E164_RE.test(from) || !E164_RE.test(to)) {
    console.warn(`[sms] phone number not E.164: from=${from} to=${to}`);
    return { sent: false, reason: 'phone-not-e164' };
  }

  // Caller-side idempotency via sms_sends(briefing_id PK).
  const { data: existing } = await supabase
    .from('sms_sends')
    .select('sid')
    .eq('briefing_id', briefingId)
    .maybeSingle();
  if (existing) {
    return { sent: true, sid: existing.sid, reason: 'already-sent' };
  }

  try {
    const msg = await c.messages.create({ from, to, body });
    await supabase.from('sms_sends').insert({ briefing_id: briefingId, sid: msg.sid });
    return { sent: true, sid: msg.sid };
  } catch (err) {
    console.warn('[sms] Twilio send failed:', err instanceof Error ? err.message : err);
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
