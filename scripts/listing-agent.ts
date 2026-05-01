// Cron entry for the Listing agent.
// Local: npm run agent:listing
// Render: cron service `pharm1-listing-agent`, daily 13:00 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runListingAgent } from '@/lib/agents/listing-agent';

async function main() {
  const supabase = createAdminClient();
  const result = await runListingAgent(supabase, { maxCandidates: 5 });
  console.log(
    `[listing-agent] done — proposed=${result.proposed} skipped=${result.skipped} capped=${result.capped}`,
  );
}

main().catch((err) => {
  console.error('[listing-agent] fatal:', err);
  process.exit(1);
});
