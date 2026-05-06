// Messaging client. Real mode is post-Wave-3; Wave 2 uses fixtures. Surface
// kept narrow — Customer Success doesn't actually call these in Wave 2 (the
// agent reads the synthetic webhook payload and produces a draft; the
// `send_reply` executor records intent into pending_customer_messages and
// logs the SP-API call we *would* make).
//
// Phase 4a: real-mode createConfirmDeliveryDetails throws NotImplementedError
// instead of fake-returning {ok:true}. The cred-gate in lib/sp-api/index.ts
// keeps this client behind SP_API_MESSAGING_REAL_CLIENT_READY=true; the throw
// fires only if someone deliberately flips the flag before wiring the real
// client — exactly the misconfiguration we want to fail loud on.

import { NotImplementedError } from '@/lib/errors';

export interface MessagingClient {
  createConfirmDeliveryDetails(amazonOrderId: string, body: { text: string }): Promise<{ ok: true }>;
}

export const getRealMessagingClient = (): MessagingClient => ({
  async createConfirmDeliveryDetails() {
    throw new NotImplementedError('sp-api-messaging');
  },
});

export const getFixtureMessagingClient = (): MessagingClient => ({
  async createConfirmDeliveryDetails() {
    return { ok: true };
  },
});
