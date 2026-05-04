// Cron entry for the Bookkeeper agent.
// Local: npm run agent:bookkeeper
// Render: cron service `pharm1-bookkeeper`, daily 23:00 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runBookkeeper } from '@/lib/agents/bookkeeper';

async function main() {
  const supabase = createAdminClient();
  const r = await runBookkeeper(supabase);
  console.log(
    `[bookkeeper] done — briefing_id=${r.briefing_id} capped=${r.capped} anomalies=${r.anomaly_count ?? 0} net=${r.net ?? 'n/a'}`,
  );
}

main().catch((err) => {
  console.error('[bookkeeper] fatal:', err);
  process.exit(1);
});
