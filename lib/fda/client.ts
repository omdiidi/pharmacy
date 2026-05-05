// openFDA REST wrapper. Free, keyless by default (1k/day/IP). FDA_API_KEY
// raises the rate limit to 120k/day. Backs off on 429/5xx with capped
// exponential delay; treats 404 as "no results" (openFDA convention).

const FDA_BASE = 'https://api.fda.gov';

export async function fdaFetch<T>(
  path: string,
  params: Record<string, string | number>,
): Promise<T> {
  const url = new URL(FDA_BASE + path);
  const allParams: Record<string, string | number> = { ...params };
  if (process.env.FDA_API_KEY) allParams.api_key = process.env.FDA_API_KEY;
  for (const [k, v] of Object.entries(allParams)) url.searchParams.set(k, String(v));

  let attempt = 0;
  while (true) {
    const res = await fetch(url.toString());
    if (res.ok) return (await res.json()) as T;
    if (res.status === 404) {
      // openFDA returns 404 when no results match. Treat as empty.
      return { meta: {}, results: [] } as unknown as T;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 3) {
        throw new Error(`openFDA ${path} ${res.status} after 3 retries`);
      }
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      attempt++;
      continue;
    }
    throw new Error(`openFDA ${path} ${res.status}: ${await res.text()}`);
  }
}
