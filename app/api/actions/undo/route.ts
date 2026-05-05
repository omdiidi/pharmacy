// POST /api/actions/undo
// Reverse-first ordering (Phase 2 hardening): we run the executor.reverse
// BEFORE marking the audit row undone. If reverse throws, we do NOT burn
// the undo token — Kaleem can retry. Once reverse succeeds, we atomically
// mark undone with a race-guarded UPDATE (predicate `undone_at IS NULL`),
// then insert a compensating audit_log row. inbox_items.state stays
// 'acted' — the UI reads the original row's undone_at and renders a
// "Reverted at HH:MM" banner.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getExecutor } from '@/lib/executors';
import { Sentry } from '@/lib/logger';
import type { Json } from '@/lib/supabase/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ audit_log_id: z.string().uuid() });

export async function POST(req: Request) {
  const session = await requireAuthenticatedUser(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'invalid body' },
      { status: 400 },
    );
  }

  const supabase = createClient();

  // 1. Find audit row gated by undo window — DO NOT mark undone yet.
  const { data: original } = await supabase
    .from('audit_log')
    .select('id, action, params, result, target_entity_type, target_entity_id')
    .eq('id', body.audit_log_id)
    .eq('pharmacy_id', session.pharmacyId)
    .is('undone_at', null)
    .gt('undo_window_expires_at', new Date().toISOString())
    .single();
  if (!original) {
    return NextResponse.json(
      { error: 'audit row not found, already undone, or window expired' },
      { status: 404 },
    );
  }

  // 2. Run reverse executor. On failure, do NOT burn undo token.
  let reverseResult: Record<string, unknown>;
  try {
    const executor = getExecutor(original.action);
    if (!executor.reverse) {
      return NextResponse.json({ error: 'action not reversible' }, { status: 400 });
    }
    reverseResult = await executor.reverse(
      (original.params ?? {}) as Record<string, unknown>,
      (original.result ?? {}) as Record<string, unknown>,
      { pharmacyId: session.pharmacyId, userId: session.userId },
    );
  } catch (err) {
    Sentry.captureException(err, { tags: { kernel: 'undo' } });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'undo failed' },
      { status: 500 },
    );
  }

  // 3. Reverse succeeded. Mark original undone (race-guarded) + log compensating row.
  const { data: marked } = await supabase
    .from('audit_log')
    .update({ undone_at: new Date().toISOString() })
    .eq('id', original.id)
    .is('undone_at', null) // race guard
    .select('id')
    .single();

  if (!marked) {
    Sentry.captureMessage('undo: reverse succeeded but mark-undone race-lost', {
      level: 'warning',
    });
    return NextResponse.json({
      undone: true,
      reverse_result: reverseResult,
      warning: 'state-flip-race',
    });
  }

  await supabase.from('audit_log').insert({
    pharmacy_id: session.pharmacyId,
    actor: session.email,
    action: `undo:${original.action}`,
    target_entity_type: original.target_entity_type,
    target_entity_id: original.target_entity_id,
    params: { reverses_audit_log_id: body.audit_log_id } as Json,
    result: reverseResult as Json,
  });

  return NextResponse.json({ undone: true, reverse_result: reverseResult });
}
