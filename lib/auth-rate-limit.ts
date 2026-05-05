// Phase 1 in-process LRU rate limiter for auth endpoints.
// Per-replica only — Render Starter is single replica, so this is acceptable.
// Phase 3 swaps to a DB-backed limiter for multi-replica deployments.

import { LRUCache } from 'lru-cache';
import { Sentry } from '@/lib/logger';

if ((Number(process.env.RENDER_INSTANCE_COUNT) || 1) > 1) {
  Sentry.captureMessage(
    '[auth-rate-limit] in-process LRU degrades with multi-replica deploy',
    { level: 'warning' },
  );
}

const cache = new LRUCache<string, number[]>({ max: 4096, ttl: 600_000 });

export function checkAuthRateLimit(
  key: string,
  opts: { window: number; max: number },
): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const arr = (cache.get(key) ?? []).filter((t) => t > now - opts.window);
  if (arr.length >= opts.max) {
    return { ok: false, retryAfterSeconds: Math.ceil(opts.window / 1000) };
  }
  arr.push(now);
  cache.set(key, arr);
  return { ok: true, retryAfterSeconds: 0 };
}
