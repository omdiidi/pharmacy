// Cron entry for the Research Analyst.
// Local: npm run agent:research-analyst
// Render: cron service `pharm1-research-analyst`, daily 06:15 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runResearchAnalyst } from '@/lib/agents/research-analyst';
import { withSentry } from '@/lib/observability';
import { withCronLock } from '@/lib/cron-lock';
import { Sentry } from '@/lib/logger';

async function main() {
  const supabase = createAdminClient();
  await withSentry('research-analyst', () =>
    withCronLock(supabase, 'research-analyst', async () => {
      const result = await runResearchAnalyst(supabase);
      console.log(
        `[research-analyst] done — proposed=${result.proposed} capped=${result.capped} briefings=${result.briefing_ids.length}`,
      );
    }),
  );
}

main().catch(async (err) => {
  console.error('[research-analyst] fatal:', err);
  await Sentry.flush(2000);
  process.exit(1);
});
