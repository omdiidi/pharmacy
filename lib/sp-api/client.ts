// Fetch wrapper for SP-API. 4xx (except 429) → throw immediately. 429/5xx →
// exponential backoff up to 5 retries, capped at 30s per delay.

import { getLwaAccessToken } from './auth';

const REGION_HOSTS = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
  sandbox_na: 'https://sandbox.sellingpartnerapi-na.amazon.com',
} as const;

export async function spFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const region = (process.env.SP_API_REGION ?? 'na') as keyof typeof REGION_HOSTS;
  const host = REGION_HOSTS[region] ?? REGION_HOSTS.na;
  const token = await getLwaAccessToken();
  const headers = new Headers(init.headers);
  headers.set('x-amz-access-token', token);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('User-Agent', 'pharmadash/1.0 (Language=Node.js; Platform=Render)');

  let attempt = 0;
  while (true) {
    const res = await fetch(`${host}${path}`, { ...init, headers });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) {
        throw new Error(`SP-API ${path} ${res.status} after 5 retries: ${await res.text()}`);
      }
      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 200, 30_000);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
      continue;
    }
    throw new Error(`SP-API ${path} ${res.status}: ${await res.text()}`);
  }
}
