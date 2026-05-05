// Cron entry for the Repricer agent.
// Local: npm run agent:repricer
// Render: cron service `pharm1-repricer`, twice-daily (14:00 + 02:00 UTC).

import { createAdminClient } from '@/lib/supabase/admin';
import { runRepricer } from '@/lib/agents/repricer';
import { withSentry } from '@/lib/observability';
import { withCronLock } from '@/lib/cron-lock';
import { Sentry } from '@/lib/logger';

async function main() {
  const supabase = createAdminClient();
  await withSentry('repricer', () =>
    withCronLock(supabase, 'repricer', async () => {
      const result = await runRepricer(supabase, { trigger: 'scheduled' });
      console.log(
        `[repricer] done — proposed=${result.proposed} evaluated=${result.evaluated ?? 0} capped=${result.capped}`,
      );
    }),
  );
}

main().catch(async (err) => {
  console.error('[repricer] fatal:', err);
  await Sentry.flush(2000);
  process.exit(1);
});
