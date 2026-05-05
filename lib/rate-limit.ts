// Phase 3 hardening: string-key sliding-window rate limiter, fail-closed with
// LRU fallback when the DB is unreachable. Backed by `rate_limit_events`
// (purged hourly via the `pharm1-rate-limit-purge` cron).
//
// Why string-key: Phase 1 stand-in keyed off claude_usage rows by user_id, so
// every chat call doubled as a counter. Phase 3 splits the counter from the
// LLM ledger so we can scope limits like `actions:<user>` and
// `auth:<email>:<ip>` independently.
//
// Why fail-closed (with LRU): if the DB is down, the rate-limit ledger is
// gone, so falling fully open invites abuse during outages. We log to Sentry
// and degrade to an in-process LRU window — which loses cross-replica
// visibility but keeps a reasonable per-replica ceiling.

import { LRUCache } from 'lru-cache';
import { createClient } from '@/lib/supabase/server';
import { Sentry } from '@/lib/logger';

const fallbackLRU = new LRUCache<string, number[]>({ max: 1024, ttl: 60_000 });

if ((Number(process.env.RENDER_INSTANCE_COUNT) || 1) > 1) {
  Sentry.captureMessage(
    '[rate-limit] LRU fallback degrades with multi-replica',
    { level: 'warning' },
  );
}

export async function checkRateLimit(
  key: string,
  opts: { window: number; max: number },
): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const supabase = createClient();
  const since = new Date(Date.now() - opts.window).toISOString();

  const { count, error } = await supabase
    .from('rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('key', key)
    .gte('created_at', since);

  if (error) {
    Sentry.captureMessage('[rate-limit] db unavailable; LRU fallback', {
      level: 'warning',
    });
    const now = Date.now();
    const arr = (fallbackLRU.get(key) ?? []).filter((t) => t > now - opts.window);
    if (arr.length >= opts.max) {
      return { ok: false, retryAfterSeconds: Math.ceil(opts.window / 1000) };
    }
    arr.push(now);
    fallbackLRU.set(key, arr);
    return { ok: true, retryAfterSeconds: 0 };
  }

  if ((count ?? 0) >= opts.max) {
    return { ok: false, retryAfterSeconds: Math.ceil(opts.window / 1000) };
  }
  await supabase.from('rate_limit_events').insert({ key });
  return { ok: true, retryAfterSeconds: 0 };
}
