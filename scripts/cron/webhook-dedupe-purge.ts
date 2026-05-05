// Daily purge of webhook_dedupe rows past their 24h TTL.
// Render: cron service `pharm1-webhook-dedupe-purge` (daily 09:00 UTC).
// Local: npm run cron:webhook-dedupe-purge

import { createAdminClient } from '@/lib/supabase/admin';

async function main() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('purge_webhook_dedupe');
  if (error) {
    console.error('[webhook-dedupe-purge] RPC failed:', error.message);
    process.exit(1);
  }
  console.log(`[webhook-dedupe-purge] deleted ${data ?? 0} rows`);
}

main().catch((err) => {
  console.error('[webhook-dedupe-purge] fatal:', err);
  process.exit(1);
});
