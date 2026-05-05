// One-shot Fulfillment Ops dry-run. Loads the fixture ORDER_CHANGE envelope
// and invokes runFulfillmentOps directly (bypassing the webhook HMAC gate).
//
// Local: npm run agent:fulfillment-ops-test

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createAdminClient } from '@/lib/supabase/admin';
import { runFulfillmentOps } from '@/lib/agents/fulfillment-ops';
import type { NotificationEnvelope } from '@/lib/sp-api';

async function main() {
  const fixturePath = path.resolve(
    process.cwd(),
    'vendor',
    'sp-api-fixtures',
    'notification-order-change.json',
  );
  const raw = await readFile(fixturePath, 'utf8');
  const env = JSON.parse(raw) as NotificationEnvelope;

  const supabase = createAdminClient();
  const result = await runFulfillmentOps(supabase, {
    trigger: 'manual-test',
    event: env,
  });
  console.log(
    `[fulfillment-ops-test] briefings=${result.briefing_ids.length} ` +
      `candidates=${result.candidates_total} capped=${result.capped}`,
  );
  for (const id of result.briefing_ids) console.log(`  briefing_id=${id}`);
}

main().catch((err) => {
  console.error('[fulfillment-ops-test] fatal:', err);
  process.exit(1);
});
