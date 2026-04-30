<!-- docs/chatbot.md — Business Chatbot spec: persona, tools, system prompt, streaming, cost, auth/rate-limit/budget guard, Phase 1.5 upgrade. -->

# Chatbot

## Overview

The Business Chatbot is the **Chief of Staff** persona — the single Kaleem-facing surface for asking questions about the business, looking up data, and enqueuing deeper analysis jobs. It lives at `/chat` and runs through `/api/chat`.

The persona is defined as a static text block in `lib/system-prompt.ts` (`COS_PERSONA_TEXT`). There is no separate skill file for Chief of Staff — the chatbot is the only place this persona runs, so the prompt lives next to the code that uses it.

In Phase 1, the chatbot is the **only** working AI surface in the app. The other 8 agents have their skill prompts authored (`minicrew-config/skills/*.md`) but don't run yet — the worker stub waits on the minicrew Linux port. This means the chatbot is also Kaleem's first hands-on experience with the platform.

## Tool set

Five tools, all reading from Supabase via the service role behind a server-only route. Tool definitions are in `lib/tools/`; the dispatcher is `lib/tools/index.ts`.

### `query_products`

Search the pharmacy catalog. Use when Kaleem asks about specific products by name, NDC, UPC, ASIN, brand, or category.

```typescript
input_schema: {
  query: string,        // search term, 1-100 chars, regex /^[A-Za-z0-9 \-_.+/]+$/
  limit?: number,       // 1-100, default 20
}
```

Implementation runs six parallel parameterized queries (exact-match on `asin` / `ndc` / `upc`, ilike on `name` / `brand` / `category`) and unions in JS. LIKE metacharacters (`%`, `_`, `\`) are escaped. No `.or()` with string interpolation — that path was rejected by reviewer #2 for injection risk. `pharmacy_id` is threaded in from the session and applied as `.eq('pharmacy_id', ctx.pharmacyId)` on every query.

Returns `{ rows: Product[], count: number }`.

### `query_orders`

Look up orders by order ID, date range, status, or product. Use when Kaleem asks about historic sales, fulfillment status, or specific orders.

```typescript
input_schema: {
  order_id?: string,
  product_id?: string,
  status?: 'new' | 'ordered_from_supplier' | 'shipped' | 'delivered' | 'returned' | 'refunded',
  since?: string,       // ISO date
  until?: string,       // ISO date
  limit?: number,
}
```

Returns `{ rows: Order[], count: number }`.

### `search_memory`

Search across agent memory (episodic decisions + outcomes, procedural playbooks, semantic facts, Kaleem preferences). Use when Kaleem asks "what did we decide about X" or "why did the system pick Y last time."

```typescript
input_schema: {
  query: string,
  memory_type?: 'episodic' | 'procedural' | 'semantic' | 'preferences',
  k?: number,           // default 10, max 50
}
```

**Phase 1:** calls the `search_memory_text` Postgres RPC (pg_trgm `%` operator over a GIN index on `content`). Trigram similarity is good enough for the small Phase 1 memory table.

**Phase 1.5:** swap to `match_memory_vector` RPC (Voyage `voyage-3` embeddings, cosine over HNSW index) with text fallback. The HNSW index is already in place — no schema migration needed.

Returns `{ matches: MemoryRow[] }`.

### `get_recent_briefings`

Return the most recent briefings (with optional filters). Use when Kaleem asks "what did the agents flag this week" or "show me dismissed Repricer proposals."

```typescript
input_schema: {
  limit?: number,
  source_agent?: string,
  briefing_type?: string,
  state?: 'pending' | 'seen' | 'acted' | 'archived' | 'dismissed',
  since?: string,       // ISO date
}
```

Returns `{ briefings: Briefing[], count: number }`.

### `enqueue_job`

Enqueue a deep-analysis job into the minicrew queue. Use when the question is bigger than a direct query — e.g. "do a full Research Analyst pass on vitamin D today" or "run a manual Portfolio Manager review on magnesium."

```typescript
input_schema: {
  job_type: 'research-analyst' | 'repricer-sweep' | 'fulfillment-source'
          | 'account-health' | 'customer-triage' | 'customer-draft'
          | 'bookkeeper' | 'portfolio-manager' | 'reflector',
  payload: Record<string, unknown>,
  priority?: number,    // 1-10, default 5
}
```

Writes a row to the `jobs` table with `job_type = pharm:${input.job_type}`. The minicrew worker (Phase 2) will claim and execute. **Phase 1 returns the inserted job ID immediately — there is no result yet because the worker is a stub.** The chatbot tells Kaleem the job is queued and surfaces the eventual briefing through the Inbox once the worker activates.

Returns `{ job_id: string, job_type: string, status: 'pending' }`.

## System prompt structure

Built fresh each request by `buildSystemPrompt(session)` in `lib/system-prompt.ts`. Returns an array of `Anthropic.TextBlockParam` blocks:

```
[
  // Block 1 — static persona
  {
    type: 'text',
    text: COS_PERSONA_TEXT,
    // cache_control omitted in Phase 1 — Anthropic prompt caching needs ~1024 tokens minimum
    // for Sonnet/Opus. Current persona is ~200 tokens. Will add cache_control once persona
    // grows with examples + policy refs past the threshold.
  },
  // Block 2 — dynamic context
  {
    type: 'text',
    text: `# Current pharmacy context
${JSON.stringify({ pharmacy, preferences, accountHealth }, null, 2)}

# Recent briefings (last 5)
- [2026-04-29T...] List Tinactin 1oz at $39.99 — FBA empty 3 days
- ...

# Today
2026-04-30T...`,
  },
]
```

The dynamic context comes from four parallel queries:

1. **Pharmacy row** — `select * from pharmacies where id = ?`.
2. **Kaleem's preferences** — `select metadata from memory where pharmacy_id = ? and kind = 'preferences' order by created_at desc limit 1`. Falls back to `DEFAULT_PREFERENCES` if missing.
3. **Account health snapshot** — last 20 rows from `health_metrics` for this pharmacy.
4. **Recent briefings** — last 5 rows from `briefings`.

`KaleemPreferences` shape (committed; serialized as JSON in `memory.metadata`):

```typescript
type KaleemPreferences = {
  autopilot_level: 'approve_every' | 'approve_outside_rules' | 'auto';
  communication_style: 'terse' | 'detailed';
  risk_tolerance: 'conservative' | 'balanced' | 'aggressive';
  min_margin_floor_pct: number;        // default 25
  max_scarcity_premium_pct: number;    // default 200
  notification_channels: Array<'inbox' | 'email' | 'sms'>;
};
```

The persona itself is brief and direct:

> You are Kaleem's Chief of Staff for his pharmacy's Amazon/eBay OTC business.
>
> You have read access to every table in his Supabase DB via the provided tools — products, orders, listings, prices, stock, signals, health metrics, briefings, memory. You also can enqueue minicrew jobs via `enqueue_job` for deep analysis tasks.
>
> **How to respond.** Be terse and direct. Kaleem is busy at the pharmacy counter. Short sentences. No vague generalities. Back every factual claim with data from tools. When uncertain, say so.
>
> **What you can do.** Answer questions about products, orders, P&L, history, memory of past decisions. Draft emails, listing copy, customer replies. Explain past agent decisions (pull from audit log / memory). Enqueue deep-analysis jobs.
>
> **What you never do.** Never guess or fabricate data. Never give medical advice (Kaleem is the licensed pharmacist — flag medical questions to him). Never take destructive actions (no listing changes, no purchases — only information and job enqueue).

Full text is in `lib/system-prompt.ts` `COS_PERSONA_TEXT`.

## Cost model

Phase 1 uses `claude-opus-4-7` for the chatbot loop. Per-million-token USD prices (`lib/anthropic-pricing.ts`):

| Model              | Input  | Output | Cache read | Cache write |
|--------------------|-------:|-------:|-----------:|------------:|
| `claude-opus-4-7`  | $15    | $75    | $1.50      | $18.75      |
| `claude-sonnet-4-6`| $3     | $15    | $0.30      | $3.75       |
| `claude-haiku-4-5` | $0.80  | $4     | $0.08      | $1          |

Per-request envelope (estimate, calibrate with real data):

- System prompt: ~600 tokens (200 persona + 400 dynamic context once filled with seed data; will grow as briefings accumulate).
- Tools: 5 definitions ~800 tokens.
- User turn: typically 50-300 tokens.
- Tool results per round: 200-3000 tokens depending on row counts.
- Tool loop: max 8 iterations; typical 1-2.
- Output: 100-800 tokens of assistant text.

A typical question with one tool call runs ~3-6k input + ~400 output tokens on Opus → ~$0.07-0.13. Heavy back-and-forth with multiple tool rounds can hit ~30k input → ~$0.50.

**Daily budget guard.** `MAX_DAILY_CLAUDE_SPEND_USD` env var (default 50). `getTodayClaudeSpendUsd(userId)` sums today's `claude_usage` rows; the route returns 429 before calling Claude if the cap is exceeded. `recordClaudeUsage(userId, message)` writes a row after each Claude call with `priceClaudeUsage(model, usage)` computed from the per-million-token table.

**Per-request input cap.** `MAX_REQUEST_INPUT_TOKENS = 150_000`. Counted once with `anthropic.messages.countTokens()` at the start of the loop; re-counted only when tool results append > 10kb. Above the cap, the stream emits `{ type: 'error', value: 'conversation too long' }` and closes.

## Streaming protocol

`/api/chat` returns `Content-Type: application/x-ndjson` — one JSON object per line. Three event types in Phase 1:

```jsonc
{ "type": "text_delta",      "value": "string fragment" }     // forwarded from content_block_delta
{ "type": "tool_use_start",  "name": "query_products", "id": "toolu_..." }
{ "type": "error",           "value": "conversation too long" }
```

The client (`components/chat/chat-ui.tsx`) reads the stream line-by-line, appends `text_delta` values to the current message in real time, and renders inline cards for `tool_use_start` events showing "Calling query_products(…)".

**Anti-buffer headers** are critical:

```
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
Connection: keep-alive
```

Without these, Render and Cloudflare buffer the NDJSON until the response closes, defeating streaming. `X-Accel-Buffering: no` is the nginx convention Render's edge respects.

The route uses `anthropic.messages.stream(..., { signal: req.signal })`. When the client disconnects (browser tab closed, Render pod recycled mid-stream), `req.signal` aborts and the Anthropic call cancels cleanly — no half-billed completion.

## Request lifecycle

```
POST /api/chat
  │
  ├─ middleware.ts  → unauthenticated requests get redirected before reaching here
  │
  ├─ requireAuthenticatedUser(req)
  │     ├─ supabase.auth.getUser()                 → null if no session cookie → 401
  │     ├─ ALLOWED_USER_EMAILS re-check             → email revoked? 401 (revocation actually works)
  │     └─ select pharmacy_id from user_pharmacy_access where user_id = ?
  │           → null if no mapping → 401  (bootstrap should have run on first sign-in)
  │
  ├─ checkRateLimit(userId, { window: 60_000, max: 60 })
  │     └─ Supabase-table-backed sliding window (NOT in-memory — Render may run multiple workers)
  │     → 429 with Retry-After header on overflow
  │
  ├─ getTodayClaudeSpendUsd(userId)
  │     └─ sum claude_usage rows where created_at >= today_start
  │     → 429 if >= MAX_DAILY_CLAUDE_SPEND_USD
  │
  ├─ buildSystemPrompt(session)                     → SystemPromptParam[]
  ├─ anthropic.messages.countTokens(...)           → reject if > 150k
  │
  ├─ ReadableStream with anthropic.messages.stream({..., signal: req.signal })
  │     loop (max 8 iterations):
  │       for await event of claudeStream:
  │         emit text_delta / tool_use_start
  │       on stop_reason === 'tool_use':
  │         executeTool(name, input, { pharmacyId }) for each tool block
  │         append tool_results to conversation
  │         continue loop
  │       on stop_reason === 'end_turn':
  │         break
  │     recordClaudeUsage(userId, finalMessage)
  │
  └─ return Response(stream, { anti-buffer headers })
```

## Tool error handling

Tool dispatcher in `lib/tools/index.ts` wraps every handler in try/catch. On exception, returns `JSON.stringify({ error: message })` as the tool result. Claude sees the error string and summarizes gracefully ("I couldn't query products — looks like the search term had a special character. Try plain text.").

Each tool handler also catches its own internal exceptions and returns the error JSON rather than throwing. Defense in depth — never let an exception escape the handler into the stream.

## AbortSignal handling

Render pod recycling, browser-tab close, or client-side fetch abort all surface as `req.signal` aborting. The signal is passed into `anthropic.messages.stream(..., { signal: req.signal })` so the upstream Claude call cancels. The stream's `try/catch` swallows the abort error and closes the controller — no log noise, no half-billed completion.

## Phase 1.5 upgrade path — embeddings

When agents start writing rich memory content (Reflector running weekly), Phase 1.5 layers in vector search:

1. Add `lib/embeddings.ts` — Voyage AI client, `voyage-3` (1024-dim).
2. Add an embedding-job that backfills `memory.embedding` for existing rows (set `embedding_model = 'voyage-3'`).
3. Add a Postgres RPC:
   ```sql
   create or replace function match_memory_vector(
     query_embedding vector(1024),
     pharmacy uuid,
     kind_filter text default null,
     k int default 10
   ) returns table (...)
   language sql stable
   as $$
     select m.id, m.kind, m.content, m.metadata, m.importance,
            1 - (m.embedding <=> query_embedding) as similarity
     from memory m
     where m.pharmacy_id = pharmacy
       and (kind_filter is null or m.kind::text = kind_filter)
       and m.embedding is not null
     order by m.embedding <=> query_embedding
     limit k;
   $$;
   ```
4. Update `lib/tools/search_memory.ts` to embed the query, call `match_memory_vector` first, fall back to `search_memory_text` if results are sparse or embedding fails.
5. Add `VOYAGE_API_KEY` to env.

The HNSW index is already in place from Phase 1, so no migration is needed at the index layer. The `embedding_model` column tracks which model produced each embedding so we can migrate from `voyage-3` later without dropping rows.

## See also

- [architecture.md](./architecture.md) — full system architecture.
- [product-manager.md](./product-manager.md) — what the chatbot is the front-end for.
- [agents/chief-of-staff.md](./agents/chief-of-staff.md) — the persona standalone.
- `lib/system-prompt.ts`, `lib/tools/`, `app/api/chat/route.ts` — the actual code.
