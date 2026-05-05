// Cron entry for the Chief of Staff Daily Digest.
// Local: npm run agent:chief-of-staff-digest
// Render: cron service `pharm1-chief-of-staff-digest`, daily 07:00 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runChiefOfStaffDigest } from '@/lib/agents/chief-of-staff-digest';

async function main() {
  const supabase = createAdminClient();
  const result = await runChiefOfStaffDigest(supabase);
  console.log(
    `[digest] done — briefing_id=${result.briefing_id} skipped=${result.skipped} capped=${result.capped}`,
  );
}

main().catch((err) => {
  console.error('[digest] fatal:', err);
  process.exit(1);
});
