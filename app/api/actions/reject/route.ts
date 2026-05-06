// POST /api/actions/reject
// Atomic state flip to 'dismissed' (returns 409 if not pending/seen).
// Writes an audit_log row with action='reject_briefing'. No executor invoked.
// Phase 4b: routes through lib/kernel/reject.rejectOne for parity with the
// chat-tool dismiss path.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { rejectOne } from '@/lib/kernel/reject';

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

  const r = await rejectOne(supabase, body.inbox_item_id, reason, {
    pharmacyId: session.pharmacyId,
    userId: session.userId,
    email: session.email,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  return NextResponse.json({ rejected: true, audit_log_id: r.audit_log_id });
}
