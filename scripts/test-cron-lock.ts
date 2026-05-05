// Programmatic race test for lib/cron-lock.ts / claim_cron_lock RPC.
//
// Spawns 2 concurrent withCronLock calls against the same agent_name. Asserts
// exactly one runs the body (others see lock held + skip with null return).
// Validates the RETURNING-based atomic claim is the lock semantic advertised.
//
// Run via: npm run test:cron-lock

import { createAdminClient } from '@/lib/supabase/admin';
import { withCronLock } from '@/lib/cron-lock';

async function main() {
  const supabase = createAdminClient();
  const agentName = `cron-lock-race-test-${Date.now()}`;

  // Each side increments a counter when it actually entered the body.
  let aRan = false;
  let bRan = false;

  const work = async () => {
    // Hold the lock for ~250 ms so the second caller cannot squeak in
    // after release-but-before-our-claim-resolves.
    await new Promise((r) => setTimeout(r, 250));
  };

  const [a, b] = await Promise.all([
    withCronLock(supabase, agentName, async () => {
      aRan = true;
      await work();
      return 'a-done';
    }),
    withCronLock(supabase, agentName, async () => {
      bRan = true;
      await work();
      return 'b-done';
    }),
  ]);

  console.log(`[test-cron-lock] result A: ran=${aRan} return=${JSON.stringify(a)}`);
  console.log(`[test-cron-lock] result B: ran=${bRan} return=${JSON.stringify(b)}`);

  // Cleanup any leftover row (release_cron_lock is best-effort and we used
  // unique agent names anyway, but be tidy).
  await supabase.from('cron_locks').delete().eq('agent_name', agentName);

  // Assert: exactly one ran body, the other got null (skipped).
  const runners = [aRan, bRan].filter(Boolean).length;
  const nulls = [a, b].filter((r) => r === null).length;

  if (runners !== 1 || nulls !== 1) {
    console.error(
      `[test-cron-lock] FAIL — expected 1 runner + 1 null, got runners=${runners} nulls=${nulls}`,
    );
    process.exit(1);
  }
  console.log('[test-cron-lock] PASS — exactly one withCronLock claim won');
}

main().catch((err) => {
  console.error('[test-cron-lock] fatal:', err);
  process.exit(1);
});
