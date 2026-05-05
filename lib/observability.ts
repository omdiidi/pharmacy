// Phase 3 hardening — Sentry helpers wrapping `lib/logger`'s singleton.
// Cron entries wrap their main work in `withSentry(name, fn)` so any throw
// gets tagged + flushed before the worker exits. HTTP routes use the
// captureRouteWarning / captureRouteFatal helpers for severity-tagged events.

import { Sentry } from '@/lib/logger';

export async function withSentry<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    Sentry.captureException(err, { tags: { agent: name } });
    await Sentry.flush(2000);
    throw err;
  }
}

export function captureRouteWarning(
  err: unknown,
  route: string,
  extra?: Record<string, unknown>,
): void {
  Sentry.captureException(err, { tags: { route }, extra, level: 'warning' });
}

export function captureRouteFatal(
  err: unknown,
  route: string,
  extra?: Record<string, unknown>,
): void {
  Sentry.captureException(err, { tags: { route }, extra, level: 'error' });
}

export { Sentry };
