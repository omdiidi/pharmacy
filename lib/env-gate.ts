// Phase 4a — env-gate sanitization. Treat empty / placeholder env values as
// "not set" so cred-gate factories can't be tricked by partial population
// (e.g. someone sets KEEPA_API_KEY="" or "placeholder" in the wrong env group).
//
// Used by lib/sp-api, lib/edi, lib/keepa, lib/sms factories.

const PLACEHOLDERS = new Set([
  'undefined',
  'null',
  'none',
  '',
  'disabled',
  'placeholder',
]);

export function envIsRealValue(name: string): boolean {
  const raw = process.env[name];
  if (typeof raw !== 'string') return false;
  const t = raw.trim();
  if (t.length === 0) return false;
  if (PLACEHOLDERS.has(t.toLowerCase())) return false;
  return true;
}

export function allEnvReal(...names: string[]): boolean {
  return names.every(envIsRealValue);
}

/** Cred-gate factory helper: real client only when ALL creds set AND ready-flag is 'true'. */
export function vendorReady(credEnvVars: string[], readyFlag: string): boolean {
  return allEnvReal(...credEnvVars) && process.env[readyFlag] === 'true';
}
