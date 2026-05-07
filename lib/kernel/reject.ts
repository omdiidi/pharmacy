// Kernel: rejectOne. Mirror of approveOne for the dismiss/reject path.
// Wraps state-flip (pending|seen → dismissed) + audit_log insert in one
// atomic Postgres transaction via the reject_action_atomic RPC.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import type { ApproveContext } from '@/lib/kernel/approve';
import { Sentry } from '@/lib/logger';

export type RejectContext = ApproveContext;

export type RejectResult =
  | { ok: true; audit_log_id: string }
  | { ok: false; status: 400 | 404 | 500; error: string };

// The reject_action_atomic RPC raises this Postgres error code (P0001) with
// message 'STALE_OR_NOT_FOUND' when the inbox row is already acted/dismissed
// or doesn't belong to the caller's pharmacy. Anything else is an internal
// failure that should NOT collapse to a 404.
const STALE_MESSAGES = new Set(['STALE_OR_NOT_FOUND']);

function isStaleError(message: string | undefined): boolean {
  if (!message) return false;
  // Postgres exception messages are surfaced verbatim by Supabase RPC.
  return STALE_MESSAGES.has(message) || message.includes('STALE_OR_NOT_FOUND');
}

export async function rejectOne(
  supabase: SupabaseClient<Database>,
  inboxItemId: string,
  reason: string,
  ctx: RejectContext,
): Promise<RejectResult> {
  const { data, error } = await supabase.rpc('reject_action_atomic', {
    p_inbox_item_id: inboxItemId,
    p_pharmacy_id: ctx.pharmacyId,
    p_actor: ctx.email,
    p_actor_kind: ctx.actorKind ?? 'human',
    p_actor_label: ctx.actorLabel ?? null,
    p_dismissed_reason: reason,
  });

  if (error) {
    // Distinguish stale-or-not-found (404) from real internal errors (500).
    // Previous version collapsed everything to 404, which hid prod breakage.
    if (isStaleError(error.message)) {
      return { ok: false, status: 404, error: error.message };
    }
    Sentry.captureException(error, {
      tags: { kernel: 'reject', stage: 'rpc' },
      extra: { inbox_item_id: inboxItemId, reason },
    });
    return { ok: false, status: 500, error: error.message };
  }

  if (!data || data.length === 0) {
    return { ok: false, status: 404, error: 'STALE_OR_NOT_FOUND' };
  }
  return { ok: true, audit_log_id: data[0].audit_log_id };
}
