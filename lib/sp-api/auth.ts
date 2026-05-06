// LWA refresh-token flow. SP-API moved off Sigv4 in October 2023; LWA-only is
// the current production path. We share the bearer across replicas via the
// `lwa_token_cache` singleton table, and serialize concurrent refreshes via
// the `lwa_token_refreshes` lease (RETURNING+worker_id pattern, same as
// claim_cron_lock — works correctly under PostgREST/PgBouncer; advisory locks
// would release prematurely).
//
// In-process cache layered on top of the DB cache to avoid hitting Postgres on
// every SP-API call. Expires 60s before Amazon's stated expires_in for clock-
// skew safety. See P4.10.

import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

let memCache: { token: string; expiresAt: number } | null = null;
let memInFlight: Promise<string> | null = null;

export async function getLwaAccessToken(): Promise<string> {
  const now = Date.now();
  if (memCache && memCache.expiresAt > now + 60_000) return memCache.token;
  if (memInFlight) return memInFlight;

  memInFlight = (async () => {
    try {
      return await refreshOrRead();
    } finally {
      memInFlight = null;
    }
  })();
  return memInFlight;
}

async function refreshOrRead(): Promise<string> {
  const supabase = createAdminClient();

  // 1. Read shared cache first.
  const { data: cached } = await supabase
    .from('lwa_token_cache')
    .select('token, expires_at')
    .eq('id', 1)
    .maybeSingle();
  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60_000) {
    memCache = { token: cached.token, expiresAt: new Date(cached.expires_at).getTime() };
    return cached.token;
  }

  // 2. Try to claim the refresh lease.
  const workerId = `${process.env.RENDER_INSTANCE_ID ?? 'local'}:${randomUUID()}`;
  const { data: claimed } = await supabase.rpc('claim_lwa_refresh', { p_worker_id: workerId });

  if (!claimed) {
    // 3. Lost the race — wait briefly + re-read shared cache.
    await new Promise((r) => setTimeout(r, 250));
    const { data: retry } = await supabase
      .from('lwa_token_cache')
      .select('token, expires_at')
      .eq('id', 1)
      .maybeSingle();
    if (retry?.token) {
      memCache = { token: retry.token, expiresAt: new Date(retry.expires_at).getTime() };
      return retry.token;
    }
    throw new Error('[lwa] refresh in progress; retry queue exhausted');
  }

  // 4. Won the lease — refresh, upsert cache, release lease.
  try {
    const fresh = await refreshLwaToken();
    const expiresAt = Date.now() + fresh.expiresInMs;
    await supabase.from('lwa_token_cache').upsert({
      id: 1,
      token: fresh.token,
      expires_at: new Date(expiresAt).toISOString(),
      refreshed_at: new Date().toISOString(),
    });
    memCache = { token: fresh.token, expiresAt };
    return fresh.token;
  } finally {
    await supabase.rpc('release_lwa_refresh', { p_worker_id: workerId });
  }
}

async function refreshLwaToken(): Promise<{ token: string; expiresInMs: number }> {
  const refresh = process.env.SP_API_REFRESH_TOKEN;
  const clientId = process.env.LWA_CLIENT_ID;
  const clientSecret = process.env.LWA_CLIENT_SECRET;
  if (!refresh || !clientId || !clientSecret) {
    throw new Error(
      'refreshLwaToken: missing SP_API_REFRESH_TOKEN, LWA_CLIENT_ID, or LWA_CLIENT_SECRET',
    );
  }
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LWA refresh failed: ${res.status} ${text}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return { token: body.access_token, expiresInMs: body.expires_in * 1000 };
}

// Test helper — clears the in-process cache so unit tests can re-auth.
export function _resetLwaCacheForTests(): void {
  memCache = null;
  memInFlight = null;
}
