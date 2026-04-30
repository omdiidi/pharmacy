import { createClient } from '@/lib/supabase/server';

// Sliding-window rate limiter backed by the claude_usage table.
// Counts rows in the last `window` ms for this user_id; if >= max, reject.
// Phase 1 stand-in: claude_usage doubles as our request-counter table since
// every chat call records at least one usage row. When we add a dedicated
// rate_limit table in Phase 2 we can swap this implementation behind the
// same signature without touching callers.
export async function checkRateLimit(
  userId: string,
  opts: { window: number; max: number },
): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const supabase = createClient();
  const since = new Date(Date.now() - opts.window).toISOString();

  const { count, error } = await supabase
    .from('claude_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);

  if (error) {
    // Fail-open: if the counter table is unreachable, don't block legitimate users.
    console.warn('[rate-limit] count query failed, failing open:', error.message);
    return { ok: true, retryAfterSeconds: 0 };
  }

  const used = count ?? 0;
  if (used >= opts.max) {
    return { ok: false, retryAfterSeconds: Math.ceil(opts.window / 1000) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}
