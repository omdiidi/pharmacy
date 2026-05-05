// Kernel: approveOne. Extracted from app/api/actions/approve/route.ts in
// Wave 3 Phase H so chat-tool batch operations can call the same logic
// without HTTP round-trips. Behavior preserved verbatim from the route:
//
//   1. Read briefing + proposed_actions, gated by pharmacy.
//   2. Atomic state flip — succeeds only when row is still 'pending'
//      (409-equivalent if stale). This is the executor lock.
//   3. Executor.forward FIRST. On failure, revert state so user can retry.
//   4. Atomic audit_log INSERT + pending_*.audit_log_id back-link via
//      approve_audit_atomic RPC (Phase 2 hardening).
//
// Returns a discriminated-union result so callers can map back to HTTP
// status codes or aggregate batch outcomes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import { getExecutor } from '@/lib/executors';
import { Sentry } from '@/lib/logger';

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
  actorKind?: 'human' | 'system';   // defaults to 'human'
  actorLabel?: string;              // e.g. 'account_health' when actorKind='system'
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

// Map executor result keys → pending_* table names. Must match the SQL
// allowlist in approve_audit_atomic exactly.
const PENDING_RESULT_KEY: Record<string, string> = {
  'pending_listings': 'pending_listing_id',
  'pending_pricing_changes': 'pending_pricing_change_id',
  'pending_customer_messages': 'pending_customer_message_id',
  'pending_health_actions': 'pending_health_action_id',
  'pending_purchase_orders': 'pending_purchase_order_id',
};

function pickPendingTable(result: Record<string, unknown>): string | null {
  for (const [table, key] of Object.entries(PENDING_RESULT_KEY)) {
    if (typeof result[key] === 'string') return table;
  }
  return null;
}

function pendingIdKey(table: string): string {
  return PENDING_RESULT_KEY[table];
}

async function tryReverseExecutor(
  kind: string,
  params: Record<string, unknown>,
  forwardResult: Record<string, unknown>,
  ctx: ApproveContext,
): Promise<void> {
  const executor = getExecutor(kind);
  await executor.reverse(params, forwardResult, {
    pharmacyId: ctx.pharmacyId,
    userId: ctx.userId,
  });
}

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

  // 2. Atomic state flip — only succeeds if still pending. This is the
  // executor lock: only one caller wins; concurrent callers get 409.
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

  // 3. Executor runs after the atomic claim. On failure, revert state.
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

  // 4. Audit insert + back-link in one transaction via RPC.
  const pendingTable = pickPendingTable(result);
  const pendingId = pendingTable
    ? ((result as Record<string, unknown>)[pendingIdKey(pendingTable)] as string)
    : null;

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('approve_audit_atomic', {
    p_inbox_item_id: inboxItemId,
    p_pharmacy_id: ctx.pharmacyId,
    p_actor: ctx.email,
    p_actor_kind: ctx.actorKind ?? 'human',
    p_actor_label: ctx.actorLabel ?? null,
    p_action: kind,
    p_params: params as unknown as Json,
    p_result: result as unknown as Json,
    p_undo_window_min: UNDO_WINDOW_MIN,
    p_pending_table: pendingTable,
    p_pending_id: pendingId,
  });

  if (rpcErr || !rpcResult || rpcResult.length === 0) {
    // RPC failed AFTER executor side-effect ran. Compensate best-effort.
    Sentry.captureException(rpcErr ?? new Error('audit RPC empty'), {
      tags: { kernel: 'approve', stage: 'audit-insert' },
    });
    await tryReverseExecutor(kind, params, result, ctx).catch(() => {});
    return {
      ok: false,
      status: 500,
      error: `kernel audit-insert failed: ${rpcErr?.message ?? 'EMPTY'}`,
    };
  }

  return {
    ok: true,
    audit_log_id: rpcResult[0].audit_log_id,
    undo_window_expires_at: rpcResult[0].undo_window_expires_at,
    result,
  };
}
