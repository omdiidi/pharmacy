import * as Sentry from '@sentry/nextjs';

const REDACTED = '[REDACTED]';

function getRedactKeys(): string[] {
  return (process.env.REDACT_ENV ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

function shouldRedactString(s: string): boolean {
  if (s.includes('sk-ant-')) return true;
  if (s.startsWith('eyJ')) return true;
  for (const key of getRedactKeys()) {
    const v = process.env[key];
    if (v && v.length > 0 && s.includes(v)) return true;
  }
  return false;
}

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return shouldRedactString(value) ? REDACTED : value;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v);
    }
    return out;
  }
  return value;
}

let initialized = false;
export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    beforeSend: (event) => redact(event) as Sentry.ErrorEvent,
  });
  initialized = true;
}

initSentry();

export { Sentry };
