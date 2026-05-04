// Cron entry for the Portfolio Manager agent.
// Local: npm run agent:portfolio-manager
// Render: cron service `pharm1-portfolio-manager`, Sundays 07:00 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runPortfolioManager } from '@/lib/agents/portfolio-manager';

async function main() {
  const supabase = createAdminClient();
  const r = await runPortfolioManager(supabase);
  console.log(
    `[portfolio-manager] done — briefing_id=${r.briefing_id} capped=${r.capped} actions=${r.action_count ?? 0} unmapped=${r.unmapped_count ?? 0}`,
  );
}

main().catch((err) => {
  console.error('[portfolio-manager] fatal:', err);
  process.exit(1);
});
