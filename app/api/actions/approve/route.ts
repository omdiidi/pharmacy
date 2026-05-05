// POST /api/actions/approve
// Thin route handler — defers to lib/kernel/approve.ts so chat tools and
// the HTTP route share one implementation. See lib/kernel/approve.ts for
// the kernel logic (atomic state flip → executor.forward → audit_log).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { approveOne } from '@/lib/kernel/approve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  inbox_item_id: z.string().uuid(),
  action_index: z.number().int().min(0).max(20),
});

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

  const supabase = createClient();
  const result = await approveOne(
    supabase,
    parsedBody.inbox_item_id,
    parsedBody.action_index,
    {
      pharmacyId: session.pharmacyId,
      userId: session.userId,
      email: session.email,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    audit_log_id: result.audit_log_id,
    undo_window_expires_at: result.undo_window_expires_at,
    result: result.result,
  });
}
