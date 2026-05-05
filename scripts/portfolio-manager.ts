// Cron entry for the Portfolio Manager agent.
// Local: npm run agent:portfolio-manager
// Render: cron service `pharm1-portfolio-manager`, Sundays 07:00 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runPortfolioManager } from '@/lib/agents/portfolio-manager';
import { withSentry } from '@/lib/observability';
import { withCronLock } from '@/lib/cron-lock';
import { Sentry } from '@/lib/logger';

async function main() {
  const supabase = createAdminClient();
  await withSentry('portfolio-manager', () =>
    withCronLock(supabase, 'portfolio-manager', async () => {
      const r = await runPortfolioManager(supabase);
      console.log(
        `[portfolio-manager] done — briefing_id=${r.briefing_id} capped=${r.capped} actions=${r.action_count ?? 0} unmapped=${r.unmapped_count ?? 0}`,
      );
    }),
  );
}

main().catch(async (err) => {
  console.error('[portfolio-manager] fatal:', err);
  await Sentry.flush(2000);
  process.exit(1);
});
