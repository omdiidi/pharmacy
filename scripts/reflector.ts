// Cron entry for the Reflector agent.
// Local: npm run agent:reflector
// Render: cron service `pharm1-reflector`, Sundays 23:30 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runReflector } from '@/lib/agents/reflector';

async function main() {
  const supabase = createAdminClient();
  const r = await runReflector(supabase);
  console.log(
    `[reflector] done — briefing_id=${r.briefing_id} capped=${r.capped} patterns=${r.pattern_count ?? 0} memory=${r.memory_count ?? 0}`,
  );
}

main().catch((err) => {
  console.error('[reflector] fatal:', err);
  process.exit(1);
});
