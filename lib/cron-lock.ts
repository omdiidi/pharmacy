// Phase 3 hardening — TTL heartbeat agent-name lock for cron entries.
// Backed by `cron_locks` table + `claim_cron_lock` / `release_cron_lock` RPCs
// (see migration 20260505000002). Works under PostgREST/PgBouncer because it
// does not rely on session-scoped advisory locks.
//
// Workflow per cron run:
//   1. Generate a unique worker_id (RENDER_INSTANCE_ID + uuid).
//   2. Call claim_cron_lock(agent_name, worker_id, ttl). RPC returns true on
//      a fresh claim or after a stale lock expired; false while another
//      worker still holds the lock.
//   3. If claimed, run fn() to completion, then release in finally.
//   4. If not claimed, log + return null (skipped — duplicate run).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { randomUUID } from 'crypto';

export async function withCronLock<T>(
  supabase: SupabaseClient<Database>,
  agentName: string,
  fn: () => Promise<T>,
  ttlMinutes = 60,
): Promise<T | null> {
  const workerId = `${process.env.RENDER_INSTANCE_ID ?? 'local'}:${randomUUID()}`;

  const { data: claimed, error: claimErr } = await supabase.rpc('claim_cron_lock', {
    p_agent_name: agentName,
    p_worker_id: workerId,
    p_ttl_minutes: ttlMinutes,
  });

  if (claimErr) {
    console.warn(`[cron-lock] ${agentName} claim RPC failed:`, claimErr.message);
    throw claimErr;
  }

  if (!claimed) {
    console.warn(`[cron-lock] ${agentName} already running; skipping`);
    return null;
  }

  try {
    return await fn();
  } finally {
    const { error: relErr } = await supabase.rpc('release_cron_lock', {
      p_agent_name: agentName,
      p_worker_id: workerId,
    });
    if (relErr) {
      console.warn(`[cron-lock] ${agentName} release RPC failed:`, relErr.message);
    }
  }
}
