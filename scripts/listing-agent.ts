// Cron entry for the Listing agent.
// Local: npm run agent:listing
// Render: cron service `pharm1-listing-agent`, daily 13:00 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runListingAgent } from '@/lib/agents/listing-agent';
import { withSentry } from '@/lib/observability';
import { withCronLock } from '@/lib/cron-lock';
import { Sentry } from '@/lib/logger';

async function main() {
  const supabase = createAdminClient();
  await withSentry('listing-agent', () =>
    withCronLock(supabase, 'listing-agent', async () => {
      const result = await runListingAgent(supabase, { maxCandidates: 5 });
      console.log(
        `[listing-agent] done — proposed=${result.proposed} skipped=${result.skipped} capped=${result.capped}`,
      );
    }),
  );
}

main().catch(async (err) => {
  console.error('[listing-agent] fatal:', err);
  await Sentry.flush(2000);
  process.exit(1);
});
