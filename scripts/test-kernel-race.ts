// Programmatic race test for lib/kernel/approve.ts.
//
// Spawns 2 concurrent approveOne() calls against a single seeded inbox_item.
// Asserts exactly one returns {ok: true} and the other returns
// {ok: false, status: 409}. Verifies the atomic state-flip claim is the
// executor lock as advertised.
//
// Run via: npm run test:kernel-race

import { createAdminClient } from '@/lib/supabase/admin';
import { approveOne } from '@/lib/kernel/approve';
import type { Json } from '@/lib/supabase/types';

const PHARMACY_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  const supabase = createAdminClient();

  // 1. Seed a briefing + inbox_item with a no-side-effect proposed action.
  // We use 'dismiss_briefing' which has no executor side effects; its
  // forward() is a no-op-ish kind that just returns a result.
  const { data: briefing, error: briefErr } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: PHARMACY_ID,
      source_agent: 'test_race',
      briefing_type: 'account_health',
      title: 'Kernel race test',
      summary: 'Kernel race test seed',
      rationale: 'kernel race test',
      confidence: 0.5,
      urgency: 1,
      proposed_actions: [
        {
          kind: 'dismiss_briefing',
          label: 'Dismiss',
          variant: 'primary',
          params: {},
        },
      ] as Json,
    })
    .select('id')
    .single();
  if (briefErr || !briefing) throw new Error(`seed briefing failed: ${briefErr?.message}`);

  const { data: item, error: itemErr } = await supabase
    .from('inbox_items')
    .insert({
      pharmacy_id: PHARMACY_ID,
      briefing_id: briefing.id,
      state: 'pending',
    })
    .select('id')
    .single();
  if (itemErr || !item) throw new Error(`seed inbox_item failed: ${itemErr?.message}`);

  console.log(`[test-kernel-race] seeded inbox_item ${item.id}`);

  // 2. Concurrent approveOne race.
  const ctx = {
    pharmacyId: PHARMACY_ID,
    userId: '00000000-0000-0000-0000-000000000000',
    email: 'race-test@pharm1.local',
  };

  const [a, b] = await Promise.all([
    approveOne(supabase, item.id, 0, ctx),
    approveOne(supabase, item.id, 0, ctx),
  ]);

  console.log('[test-kernel-race] result A:', JSON.stringify({ ok: a.ok, ...(a.ok ? {} : { status: a.status, error: a.error }) }));
  console.log('[test-kernel-race] result B:', JSON.stringify({ ok: b.ok, ...(b.ok ? {} : { status: b.status, error: b.error }) }));

  // 3. Cleanup — best effort.
  await supabase.from('inbox_items').delete().eq('id', item.id);
  await supabase.from('briefings').delete().eq('id', briefing.id);

  // 4. Assert: exactly one ok=true and one ok=false (race-lost).
  // The loser may see 409 (pre-claim read, post-claim UPDATE race) or 404
  // (read AFTER claim flipped state). Both indicate the kernel correctly
  // prevented double-execution. The strict invariant is: exactly one wins.
  const successes = [a, b].filter((r) => r.ok).length;
  const losses = [a, b].filter(
    (r): r is typeof r & { ok: false } => !r.ok && (r.status === 409 || r.status === 404),
  ).length;

  if (successes !== 1 || losses !== 1) {
    console.error(
      `[test-kernel-race] FAIL — expected 1 success + 1 race-loss (409|404), got ${successes} success + ${losses} race-loss`,
    );
    process.exit(1);
  }

  const loser = [a, b].find((r) => !r.ok)!;
  console.log(
    `[test-kernel-race] PASS — exactly one approveOne won, one race-lost (status=${
      !loser.ok ? loser.status : 'n/a'
    })`,
  );
}

main().catch((err) => {
  console.error('[test-kernel-race] fatal:', err);
  process.exit(1);
});
