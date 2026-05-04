# Voyage AI Embeddings — Research Dossier

> Snapshot date: 2026-05-04
> Author: Researcher agent (Claude Opus 4.7)
> Purpose: De-risk Wave 3 memory-embeddings work for PharmaDash. Decide on model, integration shape, and credential gating.

---

## TL;DR

- **Use `voyage-3.5-lite`** (1024-dim, $0.02/M tokens, 200M token free tier on the model-family bucket). It matches our existing `vector(1024)` column and is the cheapest competent model that still fits our domain.
  - Alternative if we want more headroom: `voyage-3.5` ($0.06/M, 1024-dim) — same dim, ~3× the cost, marginally better recall.
- **Skip `voyage-large-2` and `voyage-3-large`** — the original architecture decision in `CLAUDE.md` named "voyage-3" specifically. The `-large` variants are 1536/2048-dim and would force a schema migration of the `vector(1024)` column.
- **Skip `voyage-code-3` / `voyage-finance-2` / `voyage-law-2`** — wrong domain (we have product / signal / decision text, not code or filings).
- **Do not block on the SDK.** The official `voyageai` npm package exists (v0.2.1, MIT) but a bare `fetch()` to `POST https://api.voyageai.com/v1/embeddings` is one function and removes a dependency. Either works; recommend `fetch` for the helper to keep the surface small.
- **Reranker is optional Phase 1.5 polish.** `rerank-2.5-lite` ($0.02/M) could improve Research Analyst result quality after a vector search but is not load-bearing; skip until we see retrieval misses.
- **Postgres pgvector compatibility:** `voyage-3` and `voyage-3.5` family are 1024-dim by default → drops straight into `vector(1024)`. No migration needed.

---

## 1. Authentication

- **Model:** single API key, sent as `Authorization: Bearer YOUR_API_KEY` header. Standard.
- **Where to get a key:** sign up at https://dash.voyageai.com (Voyage dashboard), generate key in the console.
- **Free tier:** 200M tokens free per account on the current model family (`voyage-4-large`, `voyage-4`, `voyage-4-lite`, `voyage-context-3`, `voyage-code-3`). Specialized older models (voyage-finance-2, voyage-law-2, voyage-code-2) get 50M free tokens. The `voyage-3` / `voyage-3.5` legacy line is paid but very cheap.
- **Tier progression:** Tier 1 unlocks on adding a payment method; Tier 2 at $100 cumulative spend (2× rate limits); Tier 3 at $1000 (3× rate limits).

For PharmaDash: 200M tokens is enormous for our scale. At ~500 tokens per memory row (a generous overestimate for a `summary` blob), 200M tokens = 400,000 memory rows. We will not approach this in Phase 2.

---

## 2. Embeddings Endpoint

**`POST https://api.voyageai.com/v1/embeddings`**

### Request body
```json
{
  "input": "string or string[]",
  "model": "voyage-3.5-lite",
  "input_type": "document",
  "truncation": true,
  "output_dimension": 1024,
  "output_dtype": "float",
  "encoding_format": null
}
```

| Field | Type | Notes |
|---|---|---|
| `input` | string \| string[] | Up to 1,000 items per batch. |
| `model` | string | Required. See section 3 for model list. |
| `input_type` | `"document"` \| `"query"` \| null | When set, Voyage prepends a retrieval-tuned prefix internally. Use `document` when storing in DB; use `query` when looking up. |
| `truncation` | boolean | Default `true`. If `false` and an input exceeds the model's context window, request fails. |
| `output_dimension` | integer | Series-3.5 and series-4 support flexible dims (256, 512, 1024, 2048). Default 1024. Older models fixed. |
| `output_dtype` | string | `float` (default), `int8`, `uint8`, `binary`, `ubinary`. We use `float` because pgvector's `vector` type stores float32. |
| `encoding_format` | string | `null` (default) returns plain JSON arrays; `base64` returns compressed strings. We don't need base64. |

### Response
```json
{
  "object": "list",
  "data": [
    { "object": "embedding", "embedding": [0.012, -0.045, ...], "index": 0 }
  ],
  "model": "voyage-3.5-lite",
  "usage": { "total_tokens": 27 }
}
```

### Errors
- 4XX — bad request, auth failure, rate limit (429). Implement exponential backoff on 429.
- 5XX — server. Retry with backoff.

Source: https://docs.voyageai.com/reference/embeddings-api

---

## 3. Models Available (May 2026)

| Model | Dim (default) | Context | Price ($/M tok) | Free | Best for |
|---|---|---|---|---|---|
| `voyage-4-large` | 1024 | 32K | $0.12 | 200M | Highest quality, multilingual |
| `voyage-4` | 1024 | 32K | $0.06 | 200M | Quality general purpose |
| `voyage-4-lite` | 1024 | 32K | $0.02 | 200M | Cheap general purpose |
| `voyage-context-3` | 1024 | 32K | $0.18 | 200M | Long-context retrieval |
| `voyage-code-3` | 1024 | 32K | $0.18 | 200M | Code retrieval |
| `voyage-finance-2` | 1024 | 32K | $0.12 | 50M | Financial filings |
| `voyage-law-2` | 1024 | 16K | $0.12 | 50M | Legal docs |
| `voyage-3-large` | 1024 (flex) | 32K | $0.18 | — | Legacy high-quality |
| `voyage-3.5` | 1024 (flex) | 32K | $0.06 | — | Legacy general |
| `voyage-3.5-lite` | 1024 (flex) | 32K | $0.02 | — | Legacy cheap |
| `voyage-3` | 1024 | 32K | $0.06 | — | Legacy original |
| `voyage-3-lite` | 512 | 32K | $0.02 | — | Legacy 512-dim |

### Recommendation for PharmaDash

**Pick `voyage-3.5-lite`.**

Rationale:
1. Matches existing `vector(1024)` schema bit-for-bit. No migration.
2. $0.02/M tokens. At our scale (~thousands of memory rows in Phase 2), embeddings cost is rounding error — measured in cents per month.
3. MTEB scores are competitive: voyage-3.5-lite scores ~66.1% on MTEB retrieval — well above OpenAI `text-embedding-3-small` (~64.6%) and within striking distance of `voyage-3-large` (65.1%) at one-ninth the cost.
4. PharmaDash memory rows are short product / decision / observation summaries — no special domain fit (no code, finance, or law data).

If we later observe retrieval misses on Research Analyst's semantic search, upgrade to `voyage-3.5` (same dim, 3× cost, marginally better recall) without schema change.

**Do not pick `voyage-large-2` despite the name in CLAUDE.md.** That entry predates the voyage-3.5 family. The "1024-dim" qualifier in CLAUDE.md is what matters; voyage-3.5-lite satisfies it.

Sources: https://docs.voyageai.com/docs/embeddings, https://pecollective.com/tools/best-embedding-models/, https://www.buildmvpfast.com/blog/best-embedding-model-comparison-voyage-openai-cohere-2026

---

## 4. Batch Limits

- **Max inputs per request:** 1,000 strings.
- **Max tokens per single input:** the model's context window (32K for our pick).
- **Max total tokens per request:** varies by tier of model.
  - Lite models (`voyage-4-lite`, `voyage-3.5-lite`): **1M tokens** per request.
  - Standard (`voyage-4`, `voyage-3.5`, `voyage-3`): **320K tokens** per request.
  - Large/specialized (`voyage-4-large`, `voyage-3-large`, `voyage-code-3`, `voyage-finance-2`): **120K tokens** per request.

For PharmaDash: a backfill batch of 100 memory rows × ~500 tokens = 50K tokens. Fits trivially. Use batches of 100–200 for the backfill script to keep individual HTTP requests small and retryable.

---

## 5. Rate Limits

| Tier | Trigger | Multiplier |
|---|---|---|
| Tier 1 | Payment method on file | 1× base |
| Tier 2 | $100 cumulative spend | 2× base |
| Tier 3 | $1,000 cumulative spend | 3× base |

Base rate limits (per Voyage docs example for `voyage-3.5`):
- **2,000 RPM** (requests per minute)
- **8M TPM** (tokens per minute)

Lite models often have higher TPM caps. Voyage exposes per-project caps that org admins can adjust below the org limit.

For PharmaDash: we will run dozens of embed calls per day in Phase 2 (one per memory write). Free tier limits will not be a constraint. Backfill could in theory hit 2K RPM if we batch poorly; staying with batches of ≥50 makes that impossible.

429 handling: standard exponential backoff. SDK supports retry config; bare fetch needs explicit retry with jitter.

Source: https://docs.voyageai.com/docs/rate-limits

---

## 6. Pricing

Already covered in section 3 table. Restated for clarity:

| Model | $/M tokens | Free token allowance |
|---|---|---|
| `voyage-3.5-lite` (recommended) | $0.02 | n/a (legacy paid) |
| `voyage-3.5` | $0.06 | n/a |
| `voyage-4-lite` (newer alternative) | $0.02 | 200M free tokens |
| `voyage-4` | $0.06 | 200M |
| `voyage-4-large` | $0.12 | 200M |

**Cost projection for PharmaDash Phase 2:**
- Memory writes per day: ~50 (across all 9 agents combined, conservative)
- Average tokens per memory: ~400
- Daily tokens: 20K
- Monthly tokens: ~600K
- **Monthly cost on `voyage-3.5-lite`: ~$0.012** (literally one and a half cents)

If we switch to `voyage-4-lite`, we get 200M free tokens → effectively zero for years. The catch is dim is also 1024, so it's a drop-in replacement. **Worth considering: `voyage-4-lite` is functionally free for our scale.**

**Reranker pricing** (if we add it later):
- `rerank-2.5-lite`: $0.02/M (200M free)
- `rerank-2.5`: $0.05/M (200M free)

Source: https://docs.voyageai.com/docs/pricing

---

## 7. TypeScript SDK

**Official package:** `voyageai` (v0.2.1 as of March 2026, MIT license)
- npm: https://www.npmjs.com/package/voyageai
- GitHub: https://github.com/voyage-ai/typescript-sdk
- Runtime support: Node.js 18+, Vercel, Cloudflare Workers, Deno, Bun, React Native

### Sample SDK usage
```typescript
import { VoyageAIClient } from "voyageai";

const client = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });

const result = await client.embed({
  input: ["Tinactin 1oz spray", "Magnesium glycinate 200ct"],
  model: "voyage-3.5-lite",
  inputType: "document",
});

const embeddings: number[][] = result.data.map((d) => d.embedding);
```

### Recommendation: bare `fetch()` instead

For our `lib/memory/embed.ts` helper we don't need the SDK. The endpoint is one POST. Skipping the SDK:
- Removes a dependency
- Avoids SDK version drift
- Keeps the cred-gating logic inline and trivial

```typescript
// lib/memory/embed.ts
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3.5-lite";

export async function embed(text: string): Promise<number[] | null> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) return null; // graceful no-op; trigram fallback handles search

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      model: MODEL,
      input_type: "document",
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embed failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json() as {
    data: Array<{ embedding: number[]; index: number }>;
    usage: { total_tokens: number };
  };
  return json.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][] | null> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: MODEL,
      input_type: "document",
    }),
  });
  if (!res.ok) throw new Error(`Voyage embed batch failed: ${res.status}`);
  const json = await res.json() as { data: Array<{ embedding: number[]; index: number }> };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
```

Sources: https://github.com/voyage-ai/typescript-sdk, https://www.npmjs.com/package/voyageai

---

## 8. Reranking Endpoint

**`POST https://api.voyageai.com/v1/rerank`**

### Request
```json
{
  "query": "supplements with stable demand",
  "documents": ["doc 1 text", "doc 2 text", "..."],
  "model": "rerank-2.5-lite",
  "top_k": 10,
  "return_documents": false,
  "truncation": true
}
```

### Response
```json
{
  "data": [
    { "index": 4, "relevance_score": 0.91 },
    { "index": 0, "relevance_score": 0.87 }
  ],
  "model": "rerank-2.5-lite",
  "usage": { "total_tokens": 312 }
}
```

### Models
- `rerank-2.5` ($0.05/M, 200M free) — current best.
- `rerank-2.5-lite` ($0.02/M, 200M free) — recommended cheap default.
- Older: `rerank-2`, `rerank-2-lite`, `rerank-1`, `rerank-lite-1`.

### Limits
- Up to **1,000 documents** per request.
- Query token cap: 8K for rerank-2.5/2.5-lite, 4K for rerank-2.

### Use case for PharmaDash
**Optional Phase 1.5+ polish.** Pattern: vector-search returns top-50 from memory or product table → rerank to top-5–10 by query relevance → feed those to the agent. Improves retrieval quality at the cost of one extra API call (~$0.0001 per agent run at our scale).

Most useful for:
- Research Analyst — surfacing past similar opportunities or category patterns.
- Chief of Staff — semantic memory lookup when Kaleem asks "what did we decide about X last month?"

**Not load-bearing.** Skip until we have evidence that vector search alone is missing relevant items.

Source: https://docs.voyageai.com/reference/reranker-api

---

## 9. Integration Shape for PharmaDash

### 9.1 Helper module (Wave 3)

`lib/memory/embed.ts` — see code in section 7. Two exports: `embed(text)` and `embedBatch(texts)`. Both return `null` when `VOYAGE_API_KEY` is unset. Callers must handle the null case (write the row with `embedding=NULL`; let trigram search do the work).

### 9.2 Memory write path

`lib/memory/write.ts` (or wherever agents write to the `memory` table):
```typescript
import { embed } from "./embed";

export async function writeMemory(supabase, kind, content, summary, metadata) {
  const embedding = await embed(summary ?? content); // null when key missing
  await supabase.from("memory").insert({
    kind,
    content,
    summary,
    metadata,
    embedding, // pgvector accepts null OR number[1024]
  });
}
```

### 9.3 Backfill script

`scripts/backfill-embeddings.ts` — walks `memory WHERE embedding IS NULL`, batches 100 at a time, calls `embedBatch`, writes back.

```typescript
// pseudocode
const PAGE = 100;
let offset = 0;
while (true) {
  const { data: rows } = await supabase
    .from("memory")
    .select("id, summary, content")
    .is("embedding", null)
    .order("created_at", { ascending: true })
    .range(offset, offset + PAGE - 1);
  if (!rows?.length) break;

  const texts = rows.map((r) => r.summary ?? r.content);
  const embeds = await embedBatch(texts);
  if (!embeds) {
    console.error("VOYAGE_API_KEY missing; aborting backfill.");
    return;
  }

  await Promise.all(
    rows.map((row, i) =>
      supabase.from("memory").update({ embedding: embeds[i] }).eq("id", row.id)
    )
  );
  offset += PAGE;
  console.log(`backfilled ${offset} rows`);
}
```

Run via `npm run memory:backfill` (add to `package.json`). Idempotent — safe to re-run.

### 9.4 Search path

`lib/memory/search.ts` — already exists with trigram path (per CLAUDE.md). Add a vector-search branch when key is present:
```typescript
export async function searchMemory(supabase, queryText, limit = 10) {
  const queryEmbedding = await embed(queryText); // need input_type: 'query' here
  if (queryEmbedding) {
    // pgvector cosine distance: <=>
    return supabase.rpc("memory_vector_search", {
      query_embedding: queryEmbedding,
      match_count: limit,
    });
  }
  // Fallback: existing pg_trgm path
  return supabase.rpc("memory_trigram_search", { query: queryText, match_count: limit });
}
```

Note: when embedding the **query** (not the document) we should pass `input_type: 'query'` to Voyage. The helper signature should accept an `inputType` arg or expose a separate `embedQuery()` function.

### 9.5 Env vars to add

Add to `.env.example` and `render.yaml` envVarGroup:
```
VOYAGE_API_KEY=          # leave empty to disable embeddings; trigram search still works
VOYAGE_MODEL=voyage-3.5-lite  # optional override
```

Mark `sync: false` in `render.yaml` (operator fills in dashboard).

---

## 10. Postgres pgvector Compatibility

**Confirmed compatible.**

- pgvector's `vector(1024)` stores 1024-dim float32.
- Voyage `voyage-3`, `voyage-3.5`, `voyage-3.5-lite`, `voyage-4`, `voyage-4-lite`, `voyage-4-large`, `voyage-code-3`, `voyage-finance-2`, `voyage-law-2`, `voyage-context-3` all default to **1024 dimensions, float**.
- Drop-in: SQL `INSERT INTO memory (embedding) VALUES ($1::vector)` where `$1` is the JSON array Voyage returns.
- pgvector's HNSW index on the existing column already supports cosine (`vector_cosine_ops`), L2, and inner-product distance. Cosine is the right choice for Voyage embeddings (Voyage's docs recommend cosine).

**Watch out for:**
- If anyone ever switches to `voyage-3-lite` (512-dim), the column type must change. We won't.
- `output_dimension` parameter on series-3.5 / 4 lets Matryoshka-style truncation to 256 / 512 / 2048. Don't set it; let it default to 1024.
- Voyage returns plain JSON `number[]`. Supabase JS client sends it as-is; pgvector accepts the `[0.012, -0.045, ...]` text format directly.

---

## Decision Recommendations

1. **Adopt `voyage-3.5-lite`** as the default model. Add `VOYAGE_MODEL` env to allow overriding to `voyage-4-lite` once we want to use the 200M-free-tokens bucket.
2. **Skip the SDK.** Use a 30-line `fetch`-based `lib/memory/embed.ts` helper. Returns `null` when key missing.
3. **Defer the reranker.** Add only if Research Analyst retrieval is observably weak.
4. **Don't migrate the schema.** Existing `vector(1024)` is correct.
5. **Build the backfill script alongside the helper.** No big bang — it's idempotent and runs in seconds for our scale.
6. **Cost ceiling is irrelevant at our scale** — phase-2 spend on embeddings is sub-dollar per month. No need for `MAX_DAILY_VOYAGE_SPEND_USD` style guard. The OpenRouter spend cap remains the relevant guard.

---

## Sources

- [Voyage AI — Text Embeddings overview](https://docs.voyageai.com/docs/embeddings)
- [Voyage AI — POST /v1/embeddings reference](https://docs.voyageai.com/reference/embeddings-api)
- [Voyage AI — POST /v1/rerank reference](https://docs.voyageai.com/reference/reranker-api)
- [Voyage AI — Pricing](https://docs.voyageai.com/docs/pricing)
- [Voyage AI — Rate limits](https://docs.voyageai.com/docs/rate-limits)
- [`voyageai` on npm (TypeScript SDK)](https://www.npmjs.com/package/voyageai)
- [Voyage AI TypeScript SDK on GitHub](https://github.com/voyage-ai/typescript-sdk)
- [Best Embedding Models 2026 — MTEB benchmarks](https://pecollective.com/tools/best-embedding-models/)
- [Voyage 3.5 vs OpenAI vs Cohere comparison](https://www.buildmvpfast.com/blog/best-embedding-model-comparison-voyage-openai-cohere-2026)
- [MTEB Embedding Model Leaderboard March 2026](https://awesomeagents.ai/leaderboards/embedding-model-leaderboard-mteb-march-2026/)
