// Cron entry for the Reflector agent.
// Local: npm run agent:reflector
// Render: cron service `pharm1-reflector`, Sundays 23:30 UTC.

import { createAdminClient } from '@/lib/supabase/admin';
import { runReflector } from '@/lib/agents/reflector';
import { withSentry } from '@/lib/observability';
import { withCronLock } from '@/lib/cron-lock';
import { Sentry } from '@/lib/logger';

async function main() {
  const supabase = createAdminClient();
  await withSentry('reflector', () =>
    withCronLock(supabase, 'reflector', async () => {
      const r = await runReflector(supabase);
      console.log(
        `[reflector] done — briefing_id=${r.briefing_id} capped=${r.capped} patterns=${r.pattern_count ?? 0} memory=${r.memory_count ?? 0}`,
      );
    }),
  );
}

main().catch(async (err) => {
  console.error('[reflector] fatal:', err);
  await Sentry.flush(2000);
  process.exit(1);
});
