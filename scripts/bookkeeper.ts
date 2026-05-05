// Cron entry for the Bookkeeper agent.
// Local: npm run agent:bookkeeper
// Render: cron service `pharm1-bookkeeper`, daily 23:00 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runBookkeeper } from '@/lib/agents/bookkeeper';
import { withSentry } from '@/lib/observability';
import { withCronLock } from '@/lib/cron-lock';
import { Sentry } from '@/lib/logger';

async function main() {
  const supabase = createAdminClient();
  await withSentry('bookkeeper', () =>
    withCronLock(supabase, 'bookkeeper', async () => {
      const r = await runBookkeeper(supabase);
      console.log(
        `[bookkeeper] done — briefing_id=${r.briefing_id} capped=${r.capped} anomalies=${r.anomaly_count ?? 0} net=${r.net ?? 'n/a'}`,
      );
    }),
  );
}

main().catch(async (err) => {
  console.error('[bookkeeper] fatal:', err);
  await Sentry.flush(2000);
  process.exit(1);
});
