// Cron entry for the Account Health agent.
// Local: npm run agent:account-health
// Render: cron service `pharm1-account-health`, daily 06:00 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runAccountHealth } from '@/lib/agents/account-health';

async function main() {
  const supabase = createAdminClient();
  const r = await runAccountHealth(supabase, { trigger: 'scheduled' });
  console.log(
    `[account-health] done — briefing_id=${r.briefing_id} status=${r.status ?? '—'} auto_paused=${r.auto_paused_count} sms=${r.sms_sent} capped=${r.capped}`,
  );
}

main().catch((err) => {
  console.error('[account-health] fatal:', err);
  process.exit(1);
});
