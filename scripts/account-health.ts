// Cron entry for the Account Health agent.
// Local: npm run agent:account-health
// Render: cron service `pharm1-account-health`, daily 06:00 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runAccountHealth } from '@/lib/agents/account-health';
import { withSentry } from '@/lib/observability';
import { withCronLock } from '@/lib/cron-lock';
import { Sentry } from '@/lib/logger';

async function main() {
  const supabase = createAdminClient();
  await withSentry('account-health', () =>
    withCronLock(supabase, 'account-health', async () => {
      const r = await runAccountHealth(supabase, { trigger: 'scheduled' });
      console.log(
        `[account-health] done — briefing_id=${r.briefing_id} status=${r.status ?? '—'} auto_paused=${r.auto_paused_count} sms=${r.sms_sent} capped=${r.capped}`,
      );
    }),
  );
}

main().catch(async (err) => {
  console.error('[account-health] fatal:', err);
  await Sentry.flush(2000);
  process.exit(1);
});
