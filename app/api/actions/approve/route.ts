// POST /api/actions/approve
// Approve flow:
//   auth → resolve action by index → atomic state flip (RETURNING id, 409 on stale)
//   → executor.forward (revert state on failure → 500)
//   → INSERT audit_log with result populated
//   → if pending_listing_id, link audit_log_id back on pending_listings row.
//
// Executor runs BEFORE audit_log insert (closes the audit_log result-write race
// window from pass-1 review). On executor failure, the inbox row is reverted to
// 'pending' so the user can retry. See Plan §Approve flow + Known limitation.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getExecutor } from '@/lib/executors';
import type { Json } from '@/lib/supabase/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  inbox_item_id: z.string().uuid(),
  action_index: z.number().int().min(0).max(20),
});

const UNDO_WINDOW_MIN = 30;

type ProposedActionRow = {
  kind?: unknown;
  params?: unknown;
  label?: unknown;
  variant?: unknown;
};

export async function POST(req: Request) {
  const session = await requireAuthenticatedUser(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let parsedBody: z.infer<typeof Body>;
  try {
    parsedBody = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'invalid body' },
      { status: 400 },
    );
  }
  const { inbox_item_id, action_index } = parsedBody;

  const supabase = createClient();

  // 1. Read briefing + proposed_actions, gated by pharmacy.
  const { data: row } = await supabase
    .from('inbox_items')
    .select(
      'id, state, briefing:briefings!inner(id, proposed_actions, briefing_type, source_agent)',
    )
    .eq('id', inbox_item_id)
    .eq('pharmacy_id', session.pharmacyId)
    .single();
  if (!row || row.state !== 'pending') {
    return NextResponse.json({ error: 'not pending or not found' }, { status: 404 });
  }
  const briefing = row.briefing as unknown as
    | { proposed_actions: ProposedActionRow[] | null }
    | null;
  const actions = (briefing?.proposed_actions ?? []) as ProposedActionRow[];
  const action = actions[action_index];
  if (!action || typeof action.kind !== 'string') {
    return NextResponse.json({ error: 'invalid action_index' }, { status: 400 });
  }
  const kind = action.kind;
  const params = (action.params ?? {}) as Record<string, unknown>;

  // 2. Atomic state flip — only succeeds if still pending. (409 on stale.)
  const { data: flipped } = await supabase
    .from('inbox_items')
    .update({
      state: 'acted',
      acted_at: new Date().toISOString(),
      action_taken: kind,
      action_params: params as Json,
    })
    .eq('id', inbox_item_id)
    .eq('state', 'pending')
    .select('id')
    .single();
  if (!flipped) {
    return NextResponse.json({ error: 'stale — already acted' }, { status: 409 });
  }

  // 3. Executor FIRST. On failure, revert state so user can retry.
  let result: Record<string, unknown> = {};
  try {
    const executor = getExecutor(kind);
    result = await executor.forward(params, {
      pharmacyId: session.pharmacyId,
      userId: session.userId,
    });
  } catch (err) {
    await supabase
      .from('inbox_items')
      .update({ state: 'pending', acted_at: null, action_taken: null, action_params: null })
      .eq('id', inbox_item_id);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // 4. INSERT audit_log with result populated up-front (no later UPDATE needed).
  const undoExpiry = new Date(Date.now() + UNDO_WINDOW_MIN * 60 * 1000).toISOString();
  const { data: audit, error: auditErr } = await supabase
    .from('audit_log')
    .insert({
      pharmacy_id: session.pharmacyId,
      actor: session.email,
      action: kind,
      target_entity_type: 'inbox_items',
      target_entity_id: inbox_item_id,
      params: params as Json,
      result: result as Json,
      undo_window_expires_at: undoExpiry,
    })
    .select('id')
    .single();
  if (auditErr || !audit) {
    return NextResponse.json(
      { error: `audit_log insert failed: ${auditErr?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }

  // 5. If executor created a pending_listings row, link it back to this audit_log entry.
  if (typeof result.pending_listing_id === 'string') {
    await supabase
      .from('pending_listings')
      .update({ audit_log_id: audit.id })
      .eq('id', result.pending_listing_id);
  }

  return NextResponse.json({
    audit_log_id: audit.id,
    undo_window_expires_at: undoExpiry,
    result,
  });
}
