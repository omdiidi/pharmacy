// Kernel: rejectOne. Mirror of approveOne for the dismiss/reject path.
// Wraps state-flip (pending|seen → dismissed) + audit_log insert in one
// atomic Postgres transaction via the reject_action_atomic RPC.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import type { ApproveContext } from '@/lib/kernel/approve';

export type RejectContext = ApproveContext;

export type RejectResult =
  | { ok: true; audit_log_id: string }
  | { ok: false; status: 400 | 404 | 500; error: string };

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
  if (error || !data || data.length === 0) {
    return { ok: false, status: 404, error: error?.message ?? 'STALE_OR_NOT_FOUND' };
  }
  return { ok: true, audit_log_id: data[0].audit_log_id };
}
