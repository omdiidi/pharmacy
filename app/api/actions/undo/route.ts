// POST /api/actions/undo
// Atomic gate on undone_at IS NULL AND undo_window_expires_at > now() (410 if expired).
// Reverses the executor, then writes a compensating audit_log row
// (action = 'undo:<original_action>'). inbox_items.state stays 'acted' — UI reads
// the original row's undone_at and renders a "Reverted at HH:MM" banner.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getExecutor } from '@/lib/executors';
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

  // Atomic: mark undone iff window valid and not already undone.
  const { data: original } = await supabase
    .from('audit_log')
    .update({ undone_at: new Date().toISOString() })
    .eq('id', body.audit_log_id)
    .eq('pharmacy_id', session.pharmacyId)
    .is('undone_at', null)
    .gt('undo_window_expires_at', new Date().toISOString())
    .select('id, action, params, result, target_entity_type, target_entity_id')
    .single();
  if (!original) {
    return NextResponse.json({ error: 'window expired or already undone' }, { status: 410 });
  }

  // Reverse executor.
  let reverseResult: Record<string, unknown> = {};
  try {
    const executor = getExecutor(original.action);
    reverseResult = await executor.reverse(
      (original.params ?? {}) as Record<string, unknown>,
      (original.result ?? {}) as Record<string, unknown>,
      { pharmacyId: session.pharmacyId, userId: session.userId },
    );
  } catch (err) {
    reverseResult = { error: err instanceof Error ? err.message : String(err) };
  }

  // Compensating audit_log row.
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
