// Twilio SMS — credential-gated. When TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
// TWILIO_FROM_NUMBER / KALEEM_SMS_NUMBER are missing, sendSms() logs to console
// and returns { sent: false, reason }. Account Health's red branch is the only
// caller in Wave 2.

import twilio from 'twilio';

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  if (!client) client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client;
}

export async function sendSms(
  body: string,
): Promise<{ sent: boolean; sid?: string; reason?: string }> {
  const c = getClient();
  if (!c) {
    console.log(`[sms-stub] would send: ${body}`);
    return { sent: false, reason: 'twilio-creds-missing' };
  }
  if (!process.env.KALEEM_SMS_NUMBER || !process.env.TWILIO_FROM_NUMBER) {
    console.log(`[sms-stub] would send (missing TO/FROM): ${body}`);
    return { sent: false, reason: 'phone-numbers-missing' };
  }
  try {
    const msg = await c.messages.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to: process.env.KALEEM_SMS_NUMBER,
      body,
    });
    return { sent: true, sid: msg.sid };
  } catch (err) {
    console.warn('[sms] Twilio send failed:', err instanceof Error ? err.message : err);
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
