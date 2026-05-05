// Voyage AI embeddings helper. Cred-gated: returns null when VOYAGE_API_KEY missing.
// Single-call surface used by lib/memory/write.ts (per-insert) and
// scripts/backfill-embeddings.ts (batch backfill).
//
// Picked: voyage-4-lite (1024-dim) — drops into existing memory.embedding vector(1024).
// Cost: free at our scale (200M tokens/account/month allowance on voyage-4-lite
// covers our ~600K tokens/mo). Listed paid price $0.02/M tokens applies only
// after exhausting the free tier. See tmp/research/2026-05-04-voyage-embeddings.md.

const VOYAGE_API_BASE = 'https://api.voyageai.com/v1/embeddings';
export const VOYAGE_EMBEDDING_MODEL = 'voyage-4-lite';

export async function embed(input: string | string[]): Promise<number[][] | null> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) return null;

  const inputs = Array.isArray(input) ? input : [input];
  if (inputs.length === 0) return [];
  if (inputs.length > 1000) throw new Error(`Voyage batch size > 1000: ${inputs.length}`);

  try {
    const res = await fetch(VOYAGE_API_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: inputs,
        model: VOYAGE_EMBEDDING_MODEL,
        input_type: 'document',
        truncation: true,
      }),
    });
    if (!res.ok) {
      console.warn(`[voyage] embed failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const body = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  } catch (err) {
    console.warn('[voyage] embed exception:', err instanceof Error ? err.message : err);
    return null;
  }
}
