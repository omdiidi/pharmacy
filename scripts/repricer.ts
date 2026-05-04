// Cron entry for the Repricer agent.
// Local: npm run agent:repricer
// Render: cron service `pharm1-repricer`, twice-daily (14:00 + 02:00 UTC).

import { createAdminClient } from '@/lib/supabase/admin';
import { runRepricer } from '@/lib/agents/repricer';

async function main() {
  const supabase = createAdminClient();
  const result = await runRepricer(supabase, { trigger: 'scheduled' });
  console.log(
    `[repricer] done — proposed=${result.proposed} evaluated=${result.evaluated ?? 0} capped=${result.capped}`,
  );
}

main().catch((err) => {
  console.error('[repricer] fatal:', err);
  process.exit(1);
});
