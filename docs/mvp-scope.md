<!-- docs/mvp-scope.md — Phase 1 condensed scope: what ships, what's deferred, success criteria. -->

# Phase 1 MVP Scope

The 44-task plan condensed. For the full task list with rationale and reviewer-pass changelog, see [`tmp/ready-plans/2026-04-19-phase-1-mvp.md`](../tmp/ready-plans/2026-04-19-phase-1-mvp.md).

## What ships in Phase 1

- **Complete Supabase schema** for all tables — queue (minicrew), business data, memory, policy, audit. Five migrations, one seed file. Single-tenant in operation; multi-tenant-ready.
- **Next.js 14 app shell** with sidebar navigation matching the PharmaDash demo. Three live routes: Inbox (`/`), Chat (`/chat`), Preview (`/preview`). Sign-in (`/sign-in`) gated by Supabase Auth + email allowlist.
- **Functional Inbox / Timeline** page rendering briefings from the database. Empty initially, structurally ready for agents to populate.
- **Working Business Chatbot** with 5 Supabase-backed tools (`query_products`, `query_orders`, `search_memory`, `get_recent_briefings`, `enqueue_job`), real SSE streaming via `anthropic.messages.stream`, pharmacy-scoped multi-tenant safety, anti-buffer headers, AbortSignal cancellation.
- **Auth + multi-tenant boundary** — Supabase magic-link sign-in, email allowlist re-checked on every request, `user_pharmacy_access` mapping with first-login bootstrap.
- **Production guardrails** — per-user rate limit (60/min sliding window, Supabase-table-backed), daily Claude spend cap (`MAX_DAILY_CLAUDE_SPEND_USD`), per-request input token cap (150k), max 8 tool-loop iterations, Sentry exception reporting, `claude_usage` per-request cost trail.
- **Single consolidated `/preview` page** with tiles for Products / Orders / Inventory / Listings / Analytics / CRM (replacing 6 placeholder routes).
- **minicrew config + 9 agent skill prompts** authored as files. Worker stub committed to `render.yaml`; activates when minicrew Linux port lands.
- **Weekly encrypted backup → Backblaze B2** via Render Cron Job. `pg_dump | gzip | gpg --symmetric | aws s3 cp`. Sha256 + size logged to `backup_log` table. 12-week lifecycle retention. Object Lock + write-only API token. Separate Backblaze account from Supabase for true air-gap.
- **Monthly restore-test** via second Render Cron Job — pulls latest backup, decrypts, restores to throwaway DB, asserts row counts sane. Catches silent corruption.
- **Health check endpoint** (`/api/health`) for Render zero-downtime deploys.
- **Architecture + agent + integration docs** — this directory.
- **Render Blueprint** (`render.yaml`) — one-click deploy of web + worker (commented-out) + 2 cron jobs with shared env var group.

## What's deferred

### Phase 1.5 (between Phase 1 and Phase 2)

- **Voyage AI embeddings + memory.embedding backfill.** `lib/embeddings.ts` with `voyage-3`, embedding-job that backfills existing rows, `match_memory_vector` RPC, swap `search_memory` to vector-first with text fallback.
- **Refinements** based on Kaleem's chatbot use — what shortcuts does he ask for? What tools does the chatbot lack?
- **Prompt caching** on the Chief of Staff persona once it grows past Anthropic's ~1024-token cache threshold (currently ~200 tokens, below threshold).

### Phase 2 (agents + integrations)

- **minicrew Linux port lands → deploy as Render worker service.** Worker uncomments in `render.yaml`.
- **4 user-facing agents activate** — Research Analyst, Repricer, Fulfillment Ops, Account Health. Each gets a day-1 spike to validate IO contract.
- **SP-API integration** — listings sync, order webhooks, pricing writes, account health metrics, settlement reports. 1-4 week Amazon gating; procedure in [amazon-sp-api-setup.md](./amazon-sp-api-setup.md).
- **EzriRx EDI integration** — wholesaler aggregator, SFTP polling, snapshot writes. Static-IP question per T43b.
- **Keepa subscription + integration** — $54/mo. Buy Box history, offer count, BSR, FBA flag. Drives Repricer + Research Analyst.
- **FDA Drug Shortage + Recall + Google Trends** — daily polling, write to `signals`. Free, rate-limited.
- **Remaining 4 agents** — Customer Success (triage + draft), Bookkeeper, Portfolio Manager, Reflector.
- **Executor** — the actual write surface for SP-API + eBay + wholesaler purchases. Pre-authorized for Account Health red auto-pause; everything else gated by Kaleem-click.
- **Phase 2 day-1 spike target:** Bookkeeper. Simplest agent (daily cron, single-pass reasoning, one DB write, no executor branch). Validates Agent SDK + minicrew composition end-to-end before porting other 8.

### Phase 3+

- Own-store e-commerce (after Amazon + eBay stabilize).
- Halal/kosher private-label vitamins (Vitamin D + multivitamin, Utah supplier).
- TikTok store + AI video gen for marketing track.
- Multi-pharmacy split if useful.
- Staff accounts + RLS enable (`pharmacy_id = auth.jwt() ->> 'pharmacy_id'`).

## Concrete deliverables checklist

Grouped from the 44 tasks in the plan:

- [ ] **Bootstrap (T1-T5)** — Next.js + Tailwind + shadcn/ui project, dependencies (`@anthropic-ai/sdk`, `@supabase/{ssr,supabase-js}`, `zod`, etc.), `.env.example`, Supabase init, browser/server client split with browser-import guard.
- [ ] **Schema (T6-T10)** — 5 migrations: minicrew template, core schema (pharmacies/products/listings/orders/signals/...), memory schema (pgvector HNSW + pg_trgm), briefings schema (briefings/inbox_items/audit_log/claude_usage/backup_log), policy schema (policy_rules/brand_authorization/tic_certifications). `seed.sql` with default pharmacy + policy + KaleemPreferences memory row.
- [ ] **Chatbot (T11-T17)** — Anthropic client + auth (allowlist re-check) + rate-limit, tool registry + 5 tool handlers (Zod-validated, parameterized queries, no PostgREST `or=` injection), system prompt builder, chat API route (real streaming, abort signal, budget guard, max 8 iterations, 150k input cap), chat UI (NDJSON consumer, inline tool-call cards).
- [ ] **App shell (T18-T23b)** — root layout + sidebar, auth middleware (redirect to `/sign-in`), Inbox (briefing timeline), single `/preview` page, Tailwind styling, Sentry init + `claude_usage` budget guard, `/sign-in` page + `/api/auth/callback` (allowlist + `user_pharmacy_access` bootstrap), `/api/health`.
- [ ] **Minicrew config + skills (T24-T33)** — `minicrew-config/config.yaml` with 9 job types, 9 skill prompts in `minicrew-config/skills/`. Worker stub.
- [ ] **Ops scripts + docs (T34-T41)** — backup script + Dockerfile.backup (alpine + postgresql-client + aws-cli + gnupg), restore-test script, dev seed script, this directory of docs (architecture + product-manager + chatbot + integrations + 9 per-agent docs + mvp-scope + open-questions + README + render-setup).
- [ ] **Deploy (T42-T44, T43b)** — auth hardening checklist, `render.yaml` Render Blueprint with web + worker (commented) + 2 cron jobs + `pharm1-shared` env group, B2 bucket setup (separate account, Object Lock at creation, write-only token), static-IP wholesaler-rep verification, smoke test.

## Success criteria — "Phase 1 done"

1. **Kaleem can sign in** via magic link from his email; revoking the email from `ALLOWED_USER_EMAILS` cuts off access on the next request.
2. **Kaleem can chat with the bot** at `/chat` and ask things like "what products do we have," "show me last week's briefings," "search memory for repricing notes." Tool calls render inline. Responses stream token-by-token.
3. **The Inbox renders** seeded briefings (`scripts/seed-dev-data.ts` provides 3 sample briefings so it isn't empty).
4. **Health check passes** at `/api/health`. Render uses it during deploys.
5. **Rate limiting works** — hammering `/api/chat` returns 429 with a `Retry-After` header.
6. **Daily budget guard works** — setting `MAX_DAILY_CLAUDE_SPEND_USD=0.01` and making one request returns 429 on the second.
7. **Backup runs** — first weekly cron writes an encrypted dump to B2; `backup_log` has a row with sha256 + size.
8. **Restore-test runs** — first monthly cron pulls the latest backup, decrypts, restores to a throwaway DB, asserts row counts.
9. **Smoke test on production** — sign in, chat, see Inbox, hit `/preview`, hit rate-limit. All green.
10. **Docs are coherent** — a fresh agent reading [CLAUDE.md](../CLAUDE.md) → [PLAN.md](../PLAN.md) → [architecture.md](./architecture.md) → [chatbot.md](./chatbot.md) can navigate the codebase without re-deriving anything.

When 1-10 are true, Phase 1 is shipped and we move to Phase 1.5 / Phase 2.

## See also

- [open-questions.md](./open-questions.md) — unresolved decisions still pending.
- [render-setup.md](./render-setup.md) — deployment runbook.
- [`tmp/ready-plans/2026-04-19-phase-1-mvp.md`](../tmp/ready-plans/2026-04-19-phase-1-mvp.md) — full 44-task plan with reviewer-pass changelog.
