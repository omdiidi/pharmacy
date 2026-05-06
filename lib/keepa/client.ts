// Keepa REST client. Token-bucket aware: reads tokensLeft from each response
// and refuses to call when balance < 5; on 429, sleeps refillIn and retries
// once. Console-warns when balance drops below 50 for visibility.

const KEEPA_BASE = 'https://api.keepa.com';
const MIN_TOKENS = 5;

let lastTokensLeft: number | null = null;
let lastRefillIn: number | null = null;

export function getLastTokensLeft(): number | null {
  return lastTokensLeft;
}

type FetchOpts = {
  method?: 'GET' | 'POST';
  body?: unknown;
};

export async function keepaFetch<T extends { tokensLeft?: number; refillIn?: number }>(
  path: string,
  query: Record<string, string | number>,
  opts: FetchOpts = {},
): Promise<T> {
  const apiKey = process.env.KEEPA_API_KEY;
  if (!apiKey) {
    throw new Error('keepaFetch called without KEEPA_API_KEY');
  }

  // P4.6 fix — exempt /token status probe from MIN_TOKENS gate; that endpoint
  // is the one that REFRESHES our knowledge of the balance, so blocking it
  // when balance is low creates a self-deadlock.
  const isTokenProbe = path === '/token' || path.startsWith('/token?');
  if (!isTokenProbe && lastTokensLeft !== null && lastTokensLeft < MIN_TOKENS) {
    throw new Error(
      `Keepa token balance too low (${lastTokensLeft}); refusing to call ${path}`,
    );
  }

  const url = new URL(KEEPA_BASE + path);
  url.searchParams.set('key', apiKey);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }

  let attempt = 0;
  while (true) {
    const res = await fetch(url.toString(), init);
    if (res.ok) {
      const json = (await res.json()) as T;
      if (typeof json.tokensLeft === 'number') {
        lastTokensLeft = json.tokensLeft;
        if (json.tokensLeft < 50) {
          console.warn(`[keepa] tokens low: ${json.tokensLeft}`);
        }
      }
      // P4.6 — capture server-provided refillIn so 429 retries use real value.
      if (typeof json.refillIn === 'number' && json.refillIn >= 0) {
        lastRefillIn = json.refillIn;
      }
      return json;
    }
    if (res.status === 429 && attempt < 1) {
      // Retry once using server-provided refillIn (captured from prior response),
      // falling back to 5s if we don't have one yet.
      const refillIn = lastRefillIn ?? 5000;
      await new Promise((r) => setTimeout(r, refillIn));
      attempt++;
      continue;
    }
    throw new Error(`Keepa ${path} ${res.status}: ${await res.text()}`);
  }
}
