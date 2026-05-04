// Messaging client. Real mode is post-Wave-3; Wave 2 uses fixtures. Surface
// kept narrow — Customer Success doesn't actually call these in Wave 2 (the
// agent reads the synthetic webhook payload and produces a draft; the
// `send_reply` executor records intent into pending_customer_messages and
// logs the SP-API call we *would* make).

export interface MessagingClient {
  createConfirmDeliveryDetails(amazonOrderId: string, body: { text: string }): Promise<{ ok: true }>;
}

export const getRealMessagingClient = (): MessagingClient => ({
  async createConfirmDeliveryDetails(amazonOrderId, _body) {
    // Real mode lands post-Wave-3. Stub today.
    console.log(`[STUB-real-messaging] createConfirmDeliveryDetails(${amazonOrderId})`);
    return { ok: true };
  },
});

export const getFixtureMessagingClient = (): MessagingClient => ({
  async createConfirmDeliveryDetails() {
    return { ok: true };
  },
});
