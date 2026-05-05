// Cron entry for the Research Analyst.
// Local: npm run agent:research-analyst
// Render: cron service `pharm1-research-analyst`, daily 06:15 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runResearchAnalyst } from '@/lib/agents/research-analyst';

async function main() {
  const supabase = createAdminClient();
  const result = await runResearchAnalyst(supabase);
  console.log(
    `[research-analyst] done — proposed=${result.proposed} capped=${result.capped} briefings=${result.briefing_ids.length}`,
  );
}

main().catch((err) => {
  console.error('[research-analyst] fatal:', err);
  process.exit(1);
});
