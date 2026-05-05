// Keepa REST client. Token-bucket aware: reads tokensLeft from each response
// and refuses to call when balance < 5; on 429, sleeps refillIn and retries
// once. Console-warns when balance drops below 50 for visibility.

const KEEPA_BASE = 'https://api.keepa.com';
const MIN_TOKENS = 5;

let lastTokensLeft: number | null = null;

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

  if (lastTokensLeft !== null && lastTokensLeft < MIN_TOKENS) {
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
      return json;
    }
    if (res.status === 429 && attempt < 1) {
      // Retry once after refillIn, falling back to 5s.
      const refillIn = lastTokensLeft && lastTokensLeft >= 0 ? 5000 : 5000;
      await new Promise((r) => setTimeout(r, refillIn));
      attempt++;
      continue;
    }
    throw new Error(`Keepa ${path} ${res.status}: ${await res.text()}`);
  }
}
