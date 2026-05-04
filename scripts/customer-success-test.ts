// One-shot dry-run for the Customer Success agent. Loads the synthesized
// CUSTOMER_MESSAGE_RECEIVED fixture envelope and invokes runCustomerSuccess
// directly. Useful for local validation before the SP-API webhook lands.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createAdminClient } from '@/lib/supabase/admin';
import { runCustomerSuccess } from '@/lib/agents/customer-success';
import type { NotificationEnvelope } from '@/lib/sp-api';

async function main() {
  const fixturePath = path.resolve(
    process.cwd(),
    'vendor/sp-api-fixtures/notification-customer-message-received.json',
  );
  const env = JSON.parse(readFileSync(fixturePath, 'utf8')) as NotificationEnvelope;

  const supabase = createAdminClient();
  const r = await runCustomerSuccess(supabase, {
    trigger: 'webhook',
    event: {
      Payload: env.Payload as {
        CustomerMessageReceivedNotification?: {
          Message?: {
            customer_message_id: string;
            amazon_order_id?: string | null;
            customer_text: string;
            channel: 'amazon' | 'ebay';
          };
        };
      },
    },
  });
  console.log(
    `[customer-success-test] done — briefing_id=${r.briefing_id} classification=${r.classification ?? '—'} draft=${r.draft ?? false} capped=${r.capped}`,
  );
}

main().catch((err) => {
  console.error('[customer-success-test] fatal:', err);
  process.exit(1);
});
