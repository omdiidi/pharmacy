<!-- docs/architecture.md — system architecture (layers, data flow, memory model, multi-tenant boundary, observability). -->

# Architecture

PharmaDash is a multi-agent AI platform that automates Kaleem's Amazon + eBay over-the-counter (OTC) arbitrage workflow. A swarm of 9 specialist agents — coordinated by a Chief of Staff persona Kaleem chats with — read wholesaler stock, Amazon market data, FDA shortages, and Kaleem's own sales history; recommend what to list, at what price, and when; and surface a daily action queue Kaleem reviews and approves. Kaleem keeps 100% of the decisions; the system does 100% of the busywork.

## Topology

```
                          ┌──────────────────────────────────┐
                          │          KALEEM (you)            │
                          │     opens app on phone/laptop    │
                          └────────────────┬─────────────────┘
                                           │
                                           ▼
                          ┌──────────────────────────────────┐
                          │      CHIEF OF STAFF (chatbot)    │
                          │  Inbox + Chat — single entry     │
                          └────────────────┬─────────────────┘
                                           │ coordinates
                                           ▼
            ┌──────────────────────────────────────────────────────┐
            │            9 AI SPECIALIST AGENTS                     │
            │   Research / Repricer / Fulfillment / Account Health  │
            │   Customer / Bookkeeper / Portfolio / Reflector       │
            └──────────────────────────────┬───────────────────────┘
                                           │ all share one memory
                                           ▼
                          ┌──────────────────────────────────┐
                          │   SUPABASE (Postgres + pgvector) │
                          │   queue + data + memory + audit  │
                          └────────────────┬─────────────────┘
                                           │ encrypted weekly backup
                                           ▼
                          ┌──────────────────────────────────┐
                          │   BACKBLAZE B2 (separate account)│
                          │   Object Lock + write-only token │
                          └──────────────────────────────────┘
```

Technical view:

```
┌─────────────────────────────────────────────────────────────────────┐
│                  SUPABASE (cloud — source of truth)                  │
│  Postgres + pgvector (HNSW) + pg_trgm                                │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Tables:                                                         │ │
│  │   queue  : minicrew jobs / workers / worker_events              │ │
│  │   data   : pharmacies, products, listings, orders, signals,     │ │
│  │             health_metrics, wholesaler_stock_snapshots          │ │
│  │   memory : memory (kind enum) + pgvector embedding column       │ │
│  │   policy : policy_rules, brand_authorization, tic_certifications│ │
│  │   audit  : briefings, inbox_items, audit_log, claude_usage,     │ │
│  │             backup_log                                          │ │
│  │   auth   : auth.users, user_pharmacy_access                     │ │
│  └────────────────────────────────────────────────────────────────┘ │
└────────┬────────────────────────────────────────────┬───────────────┘
         │ reads/writes                               │ reads/writes
         ▼                                            ▼
┌─────────────────────────────────────┐  ┌─────────────────────────────────────┐
│ Render — Web Service                │  │ Render — Worker Service              │
│  Next.js 14 App Router              │  │  minicrew worker (Phase 2)           │
│   /sign-in (magic link)             │  │   - polls Supabase jobs queue        │
│   / (Inbox = home)                  │  │   - claims jobs by job_type          │
│   /chat (Business Chatbot)          │  │   - invokes Claude Agent SDK         │
│   /preview (Phase 2 placeholders)   │  │     query({ ...skill prompt... })    │
│   /api/chat (Claude API + tools)    │  │   - per-job model selection          │
│   /api/auth/callback                │  │     (Haiku / Sonnet / Opus)          │
│   /api/health                       │  │   - HITL hooks: PreToolUse, etc.     │
│   Scheduled cron → enqueue jobs     │  │  SFTP/EDI polling (Phase 2)          │
│   (Phase 2)                         │  │   - EzriRx aggregator                │
│   SP-API webhook handlers (Phase 2) │  │   - ABC direct EDI (parallel track)  │
└─────────────────────────────────────┘  └─────────────────────────────────────┘
                                                       │
                                                       │ encrypted weekly
                                                       ▼
                              ┌─────────────────────────────────────────┐
                              │  Backblaze B2 (separate cloud account)  │
                              │   - Object Lock enabled at creation     │
                              │   - Write-only API token (no delete)    │
                              │   - 12-week lifecycle retention         │
                              │   - S3-compatible API                   │
                              │  Render Cron Jobs (~$1/mo each):        │
                              │   - Weekly: pg_dump → gpg → upload      │
                              │   - Monthly: --test-restore from latest │
                              └─────────────────────────────────────────┘
```

## Layers

### Supabase (source of truth)

Postgres with `pgvector`, `pg_trgm`, and `moddatetime` extensions. One database holds everything — queue, data, memory, audit, policy, auth — to keep operations simple.

- **Queue tables (minicrew):** `jobs`, `workers`, `worker_events`. The schema ships with minicrew's `template.sql` (migration 1). Workers claim jobs by `job_type`, run them, write `result` JSON, update status.
- **Core data tables:** `pharmacies`, `products`, `listings`, `orders`, `wholesaler_stock_snapshots`, `signals`, `health_metrics`. Most rows are pharmacy-scoped via `pharmacy_id`. Append-only tables (`signals`, `wholesaler_stock_snapshots`) flagged for Phase 2+ partitioning by `captured_at` once volume warrants.
- **Memory:** single `memory` table with `kind enum ('episodic' | 'procedural' | 'semantic' | 'preferences')`. HNSW index on the `embedding vector(1024)` column (Voyage `voyage-3` dimension; Phase 1.5 backfill). Trigram GIN index on `content` for Phase 1 text search.
- **Audit + observability:** `briefings`, `inbox_items`, `audit_log`, `claude_usage`, `backup_log`. `audit_log` is the replay/undo backbone (`undo_window_expires_at` + `undone_at`). `claude_usage` records per-request LLM cost for the daily budget guard. `backup_log` records sha256 + size of every successful pg_dump.
- **Policy:** `policy_rules` (Tier 0/1/2 auto-exclude rules), `brand_authorization` (per-brand IP/LOA reseller-risk classification), `tic_certifications` (Amazon Dec 2025 supplement requirement).
- **Auth:** Supabase's built-in `auth.users` plus our `user_pharmacy_access` mapping table (the multi-tenant boundary).

### Render — Web Service

Next.js 14 App Router. Deploys from `main`. Hosts:

- `/sign-in` — Supabase Auth magic link.
- `/` — Inbox (briefing timeline).
- `/chat` — Business Chatbot UI (NDJSON streaming).
- `/preview` — single consolidated Phase 2 preview page (Products / Orders / Inventory / Listings / Analytics / CRM tiles).
- `/api/chat` — Claude API + tool loop, real SSE streaming, AbortSignal-cancellable, daily budget guard, rate limit, allowlist re-check.
- `/api/auth/callback` — magic-link code exchange + email allowlist verification + `user_pharmacy_access` bootstrap.
- `/api/health` — un-authed health check used by Render zero-downtime deploys.
- Phase 2: scheduled cron triggers that enqueue jobs into the minicrew queue, plus SP-API + eBay webhook handlers.

### Render — Worker Service

minicrew worker. **Phase 1: stub only.** The render.yaml stanza is committed but the service is disabled (`npm run worker` echoes "not yet implemented"). The worker activates when the minicrew Linux port lands. When live, it:

- Polls the Supabase `jobs` queue for pending rows.
- Claims jobs by `job_type` (e.g. `pharm:research-analyst`).
- Invokes the Claude Agent SDK's `query({ ... })` with the matching skill prompt loaded from `minicrew-config/skills/<agent>.md`.
- Picks model + thinking budget per `minicrew-config/config.yaml` (Haiku / Sonnet / Opus per job class).
- Wires HITL hooks (`PreToolUse`, `PermissionRequest`) so executor writes always pause for Kaleem.
- Streams OpenTelemetry traces out for observability.
- Handles SFTP/EDI polling (EzriRx aggregator + ABC direct) — may need a static egress IP per wholesaler (T43b).

### Render — Cron Jobs

Two cron jobs share `Dockerfile.backup` (alpine + postgresql-client + aws-cli + gnupg + bash):

- **`pharm1-backup-weekly`** — Sundays 09:00 UTC. Runs `scripts/backup-supabase.sh`: `pg_dump` → `gzip` → `gpg --symmetric` → `aws s3 cp` to Backblaze B2 → insert sha256 + size into `backup_log`. Fails loud if encrypted output is < 100KB or < 50% of last week's size.
- **`pharm1-backup-restore-test`** — 1st of month 10:00 UTC. Runs `scripts/restore-test.sh`: pull latest backup, decrypt, restore to throwaway DB, assert row counts sane. Catches silent corruption.

### Backblaze B2 — off-cloud backup target

Separate Backblaze account from Supabase (different email alias, different 2FA, no cross-account invitation) — true air-gap. Bucket created with **Object Lock enabled at creation** (cannot enable later). API token is **write-only** (no delete). Lifecycle rule keeps 12 weekly backups.

Why B2 vs Cloudflare R2 vs AWS S3: Object Lock has been GA on B2 since 2020 and B2 is cheaper at our scale ($0.006/GB/mo storage, $0.01/GB egress). S3-compatible API means standard `aws-cli` works.

A break-glass admin key is held offline for restore operations.

### Inference layer — Claude Agent SDK

`@anthropic-ai/claude-agent-sdk` (TypeScript). Same engine as Claude Code, library form. Native HITL hooks (`PreToolUse`, `PermissionRequest`), OpenTelemetry export, and skill-file loading via `setting_sources` config — meaning `minicrew-config/skills/*.md` files are loaded as-is.

In Phase 1, the chatbot uses the bare `@anthropic-ai/sdk` directly (no Agent SDK loop yet — the chatbot's tool loop is implemented in `app/api/chat/route.ts`). The Agent SDK enters the picture in Phase 2 when the worker activates.

Models in use:

| Model            | Use                                                       |
|------------------|-----------------------------------------------------------|
| `claude-opus-4-7` | Chatbot, Research Analyst, Portfolio Manager, Reflector  |
| `claude-sonnet-4-6` | Repricer, Customer Draft                              |
| `claude-haiku-4-5` | Fulfillment Ops, Account Health, Customer Triage, Bookkeeper |

`scripts/verify-models.ts` runs as a Render pre-deploy build step and fails the deploy if any configured model ID is no longer available from `anthropic.models.list()`.

## Data flow — chatbot request

```
Browser
  │ POST /api/chat (NDJSON stream consumer)
  ▼
middleware.ts ────────── redirects unauthenticated users to /sign-in
  │
  ▼
/api/chat route handler
  │
  ├─ requireAuthenticatedUser()  →  Supabase getUser() + ALLOWED_USER_EMAILS check
  │                                + user_pharmacy_access lookup → { userId, email, pharmacyId }
  │
  ├─ checkRateLimit(userId, 60/min sliding via Supabase table)
  │
  ├─ getTodayClaudeSpendUsd(userId)  ← claude_usage table; reject 429 if > MAX_DAILY_CLAUDE_SPEND_USD
  │
  ├─ buildSystemPrompt(session)  ← assembles persona + pharmacy + preferences + accountHealth + recent briefings
  │
  ├─ anthropic.messages.countTokens(...)  ← cap MAX_REQUEST_INPUT_TOKENS=150k, reject 'conversation too long'
  │
  └─ anthropic.messages.stream({ ..., signal: req.signal })
        │
        ├─ for each event:  forward content_block_delta as { type: 'text_delta', value }
        │                   forward tool_use start as { type: 'tool_use_start', name, id }
        │
        ├─ on stop_reason === 'tool_use':
        │     execute each tool via lib/tools/index.ts dispatcher
        │       - pharmacyId threaded into every handler (multi-tenant safety)
        │       - try/catch returns JSON {error} string rather than throwing
        │     append { role: 'assistant', content }, { role: 'user', tool_results }
        │     loop again (max 8 iterations)
        │
        ├─ recordClaudeUsage()  ← per-call usage row into claude_usage
        │
        └─ on stop_reason === 'end_turn': close stream

Response headers: Content-Type: application/x-ndjson, Cache-Control: no-cache, no-transform,
                  X-Accel-Buffering: no  (prevents Render/Cloudflare buffering the stream)
```

## Memory model

Single `memory` table; the `kind` enum keeps the schema simple:

| Kind          | What it stores                                           | Who writes it |
|---------------|----------------------------------------------------------|---------------|
| `episodic`    | Specific events: a decision, an outcome, a customer reply | All agents (post-action) |
| `procedural`  | How-to playbooks: "when X, do Y because Z"               | Mostly Reflector |
| `semantic`    | Facts about the world: brand-hunt list, supplier reliability | Reflector + Research Analyst |
| `preferences` | Kaleem's standing rules and tone profile                 | Kaleem (via app) + Reflector (when patterns emerge) |

Every row has `pharmacy_id`, `kind`, `source` (which agent or `kaleem` wrote it), `content`, `metadata` JSON, `importance` (0-1), optional `related_entity_type`/`related_entity_id`, and `embedding vector(1024)` (nullable).

**Phase 1 retrieval:** `search_memory_text(q, pharmacy, kind_filter, k)` RPC uses pg_trgm `%` operator over the `gin_trgm_ops` index on `content`. Trigram similarity is good enough for the small memory table seeded in Phase 1 (preferences row + a handful of seed semantic facts).

**Phase 1.5 upgrade:** When agents start writing rich memory content, add `lib/embeddings.ts` with Voyage `voyage-3` (1024-dim), backfill `memory.embedding` for existing rows, add a `match_memory_vector(query_embedding, pharmacy, kind_filter, k)` RPC, and swap `lib/tools/search_memory.ts` to vector-first with text fallback. The HNSW index is already in place — no schema migration needed.

The `embedding_model` column tracks which model produced each embedding so we can migrate models later without dropping rows.

There is **no TTL/staleness column in Phase 1** — rows live forever. Phase 2+ may add `expires_at` for episodic noise.

## Multi-tenant boundary

`pharmacies` and `user_pharmacy_access` are the boundary. Every business-data row is pharmacy-scoped via `pharmacy_id`.

```sql
create table user_pharmacy_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  role text not null check (role in ('owner', 'staff', 'viewer')) default 'owner',
  created_at timestamptz default now(),
  primary key (user_id, pharmacy_id)
);
```

`lib/auth.ts` returns `{ userId, email, pharmacyId }` from `requireAuthenticatedUser()`. The tool dispatcher threads `pharmacyId` into every handler. No magic globals; no ambient tenant.

**Phase 1: single tenant.** One `pharmacies` row (Kaleem's consolidated OTC business across both physical locations) and one `user_pharmacy_access` row (Kaleem). The first magic-link sign-in auto-bootstraps the `user_pharmacy_access` row pointing at the seeded default pharmacy.

**Phase 2: staff accounts.** Add more `user_pharmacy_access` rows with `role='staff'` or `role='viewer'`.

**Phase 3+: multi-pharmacy split.** Add another `pharmacies` row if useful (e.g., halal-vitamin private label as its own tenant). The schema already supports this.

## RLS posture

**Phase 1: RLS DISABLED.** Reads + writes from server-only routes use the Supabase service role key (`SUPABASE_SERVICE_ROLE_KEY`) which bypasses RLS. Auth is enforced by `middleware.ts` redirect + `requireAuthenticatedUser()` allowlist re-check + `user_pharmacy_access` mapping. The service-role key never leaves the server (`lib/supabase/server.ts` throws at module-load if `typeof window !== 'undefined'`).

**Phase 2: RLS ENABLED** when staff accounts land. Policies look like:

```sql
create policy "rows scoped to user's pharmacy"
  on listings for select
  using (pharmacy_id = (auth.jwt() ->> 'pharmacy_id')::uuid);
```

The migration to RLS is purely additive — every existing query already filters by `pharmacy_id`.

## Two-POS isolation invariant (non-negotiable)

PharmaDash is **OTC-only**. The Pioneer / Heartland / prescription side of Kaleem's pharmacy is on a **completely separate POS architecture** that this system never touches.

- **HIPAA proximity:** prescription data is PHI; OTC arbitrage data isn't. Mixing creates BAA / breach-notification surface area.
- **Licensure:** rules around handling Rx data are stricter than OTC; isolation simplifies compliance.
- **Failure isolation:** an Amazon listing bug can't propagate to Pioneer and break Rx fulfillment.

Don't propose unifying the two systems. Don't pull Rx data into Supabase. Don't share network paths.

## Phase 2+ partitioning

`signals` and `wholesaler_stock_snapshots` are append-only and high-volume (every Keepa pull, every wholesaler sweep, every FDA shortage update writes a row). Phase 1 leaves them as plain tables — fine while we have no agents writing to them. When agents activate in Phase 2, partition by `captured_at` (monthly partitions) and add a retention job that drops partitions older than 365 days.

`audit_log` and `claude_usage` may grow fast too; same partition-or-prune treatment applies.

## Observability stack

- **Sentry** (`@sentry/nextjs`) — exceptions from web service. `lib/logger.ts` initializes with `SENTRY_DSN` (no-op when empty). Redacts secrets matching `sk-`, `eyJ`, or any value of an env var listed in `REDACT_ENV`.
- **`claude_usage` table** — per-request LLM cost trail, used by the daily budget guard. `lib/budget.ts` writes `recordClaudeUsage(userId, message)` after each Claude call; `getTodayClaudeSpendUsd(userId)` sums today's rows. `lib/anthropic-pricing.ts` holds per-million-token USD prices per model.
- **OpenTelemetry from the Agent SDK (Phase 2)** — when the worker activates, OTLP traces export to LangSmith free tier (5k traces/mo) or self-hosted Langfuse. Both are framework-agnostic.
- **`audit_log` table** — every executor write is recorded with full params + result + 30-min undo window. This is the replay/debug backbone, not the metric backbone.

## Deploy topology

See [render-setup.md](./render-setup.md) for the click-by-click Render Blueprint setup. Short version: `render.yaml` declares `pharm1-web`, `pharm1-worker` (commented-out for Phase 1), `pharm1-backup-weekly`, `pharm1-backup-restore-test`. Connect repo → click Apply → fill the `pharm1-shared` env var group.

## See also

- [product-manager.md](./product-manager.md) — the 9-agent swarm spec.
- [chatbot.md](./chatbot.md) — chatbot internals (tools, prompt, streaming, cost).
- [integrations.md](./integrations.md) — minicrew, Keepa, EzriRx, SP-API, eBay, FDA.
- [agents/](./agents/) — per-agent specs.
- [render-setup.md](./render-setup.md) — deployment runbook.
- [mvp-scope.md](./mvp-scope.md) — Phase 1 deliverables checklist.
- [open-questions.md](./open-questions.md) — unresolved decisions + things pending from Kaleem.
- Repo-root [CLAUDE.md](../CLAUDE.md) — full project briefing.
- Repo-root [PLAN.md](../PLAN.md) — 30k-foot overview.
