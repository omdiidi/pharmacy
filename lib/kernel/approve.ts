// Kernel: approveOne. Extracted from app/api/actions/approve/route.ts in
// Wave 3 Phase H so chat-tool batch operations can call the same logic
// without HTTP round-trips. Behavior preserved verbatim from the route:
//
//   1. Read briefing + proposed_actions, gated by pharmacy.
//   2. Atomic state flip — succeeds only when row is still 'pending'
//      (409-equivalent if stale).
//   3. Executor.forward FIRST. On failure, revert state so user can retry.
//   4. INSERT audit_log with result populated up-front.
//   5. If executor created a pending_listings row, link audit_log_id back.
//
// Returns a discriminated-union result so callers can map back to HTTP
// status codes or aggregate batch outcomes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import { getExecutor } from '@/lib/executors';

export const UNDO_WINDOW_MIN = 30;

type ProposedActionRow = {
  kind?: unknown;
  params?: unknown;
  label?: unknown;
  variant?: unknown;
};

export type ApproveContext = {
  pharmacyId: string;
  userId: string;
  email: string;
};

export type ApproveSuccess = {
  ok: true;
  audit_log_id: string;
  undo_window_expires_at: string;
  result: Record<string, unknown>;
};

export type ApproveFailure = {
  ok: false;
  status: 400 | 404 | 409 | 500;
  error: string;
};

export type ApproveResult = ApproveSuccess | ApproveFailure;

export async function approveOne(
  supabase: SupabaseClient<Database>,
  inboxItemId: string,
  actionIndex: number,
  ctx: ApproveContext,
): Promise<ApproveResult> {
  // 1. Read briefing + proposed_actions, gated by pharmacy.
  const { data: row } = await supabase
    .from('inbox_items')
    .select(
      'id, state, briefing:briefings!inner(id, proposed_actions, briefing_type, source_agent)',
    )
    .eq('id', inboxItemId)
    .eq('pharmacy_id', ctx.pharmacyId)
    .single();
  if (!row || row.state !== 'pending') {
    return { ok: false, status: 404, error: 'not pending or not found' };
  }
  const briefing = row.briefing as unknown as
    | { proposed_actions: ProposedActionRow[] | null }
    | null;
  const actions = (briefing?.proposed_actions ?? []) as ProposedActionRow[];
  const action = actions[actionIndex];
  if (!action || typeof action.kind !== 'string') {
    return { ok: false, status: 400, error: 'invalid action_index' };
  }
  const kind = action.kind;
  const params = (action.params ?? {}) as Record<string, unknown>;

  // 2. Atomic state flip — only succeeds if still pending.
  const { data: flipped } = await supabase
    .from('inbox_items')
    .update({
      state: 'acted',
      acted_at: new Date().toISOString(),
      action_taken: kind,
      action_params: params as Json,
    })
    .eq('id', inboxItemId)
    .eq('state', 'pending')
    .select('id')
    .single();
  if (!flipped) {
    return { ok: false, status: 409, error: 'stale — already acted' };
  }

  // 3. Executor FIRST. On failure, revert state so user can retry.
  let result: Record<string, unknown> = {};
  try {
    const executor = getExecutor(kind);
    result = await executor.forward(params, {
      pharmacyId: ctx.pharmacyId,
      userId: ctx.userId,
    });
  } catch (err) {
    await supabase
      .from('inbox_items')
      .update({ state: 'pending', acted_at: null, action_taken: null, action_params: null })
      .eq('id', inboxItemId);
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 4. INSERT audit_log with result populated up-front.
  const undoExpiry = new Date(Date.now() + UNDO_WINDOW_MIN * 60 * 1000).toISOString();
  const { data: audit, error: auditErr } = await supabase
    .from('audit_log')
    .insert({
      pharmacy_id: ctx.pharmacyId,
      actor: ctx.email,
      action: kind,
      target_entity_type: 'inbox_items',
      target_entity_id: inboxItemId,
      params: params as Json,
      result: result as Json,
      undo_window_expires_at: undoExpiry,
    })
    .select('id')
    .single();
  if (auditErr || !audit) {
    return {
      ok: false,
      status: 500,
      error: `audit_log insert failed: ${auditErr?.message ?? 'unknown'}`,
    };
  }

  // 5. If executor created a pending_listings row, link it back.
  if (typeof result.pending_listing_id === 'string') {
    await supabase
      .from('pending_listings')
      .update({ audit_log_id: audit.id })
      .eq('id', result.pending_listing_id);
  }

  return {
    ok: true,
    audit_log_id: audit.id,
    undo_window_expires_at: undoExpiry,
    result,
  };
}
