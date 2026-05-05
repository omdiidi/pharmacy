// POST /api/actions/reject
// Atomic state flip to 'dismissed' (returns 409 if not pending/seen).
// Writes an audit_log row with action='reject_briefing'. No executor invoked.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  inbox_item_id: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const session = await requireAuthenticatedUser(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await checkRateLimit(`actions:${session.userId}`, { window: 60_000, max: 60 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate-limited' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

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
  const reason = body.reason ?? 'kaleem_rejected';

  const { data: flipped } = await supabase
    .from('inbox_items')
    .update({ state: 'dismissed', dismissed_reason: reason })
    .eq('id', body.inbox_item_id)
    .eq('pharmacy_id', session.pharmacyId)
    .in('state', ['pending', 'seen'])
    .select('id')
    .single();
  if (!flipped) {
    return NextResponse.json({ error: 'stale — already acted or not found' }, { status: 409 });
  }

  const { error: auditErr } = await supabase.from('audit_log').insert({
    pharmacy_id: session.pharmacyId,
    actor: session.email,
    action: 'reject_briefing',
    target_entity_type: 'inbox_items',
    target_entity_id: body.inbox_item_id,
    params: { reason },
  });
  if (auditErr) {
    console.warn('[reject] audit_log insert failed (state already flipped):', auditErr.message);
  }

  return NextResponse.json({ rejected: true });
}
