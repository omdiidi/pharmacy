// LWA refresh-token flow. SP-API moved off Sigv4 in October 2023; LWA-only is
// the current production path. We cache the bearer in-process and expire 60s
// before Amazon's stated expires_in to absorb clock skew.

let cached: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

export async function getLwaAccessToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.token;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const refresh = process.env.SP_API_REFRESH_TOKEN;
      const clientId = process.env.LWA_CLIENT_ID;
      const clientSecret = process.env.LWA_CLIENT_SECRET;
      if (!refresh || !clientId || !clientSecret) {
        throw new Error(
          'getLwaAccessToken: missing SP_API_REFRESH_TOKEN, LWA_CLIENT_ID, or LWA_CLIENT_SECRET',
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
      cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
      return body.access_token;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// Test helper — clears the cache so unit tests can re-auth.
export function _resetLwaCacheForTests(): void {
  cached = null;
  inFlight = null;
}
