// Hourly purge of rate_limit_events rows older than 1 hour.
// Render: cron service `pharm1-rate-limit-purge` (hourly).
// Local: npm run cron:rate-limit-purge

import { createAdminClient } from '@/lib/supabase/admin';

async function main() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('purge_rate_limit_events');
  if (error) {
    console.error('[rate-limit-purge] RPC failed:', error.message);
    process.exit(1);
  }
  console.log(`[rate-limit-purge] deleted ${data ?? 0} rows`);
}

main().catch((err) => {
  console.error('[rate-limit-purge] fatal:', err);
  process.exit(1);
});
