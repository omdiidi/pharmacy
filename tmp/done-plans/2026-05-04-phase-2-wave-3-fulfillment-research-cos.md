# Plan: Phase 2 Wave 3 — Fulfillment Ops · Research Analyst · Chief of Staff Upgrade + Phase 1.5 Memory Embeddings

> Reconciled from intent brief + research dossier. Final feature wave of Phase 2.
> Implementation target: three new agents that consume external-shaped inputs (cred-gated real-or-fixture), four new executors that stub external mutations as `pending_*` table writes, two new client libraries (`lib/edi/`, `lib/fda/`, `lib/keepa/`, `lib/voyage/`), one new pending table (`pending_purchase_orders`), two new Render crons (Research Analyst daily 6am, Chief of Staff Digest daily 7am), one webhook ingestion path that reuses the SP-API webhook route, one chat-tool extension surface (`batch_approve_briefings`, `dismiss_all_briefings`, plus a digest-aware `summarize_inbox`), and the Phase 1.5 fold-in: Voyage embeddings on memory writes plus a backfill script.
>
> Wave 3 is the proof that the propose→approve→execute kernel scales across diverse external surfaces (EDI, openFDA REST, Keepa REST, internal cross-agent reads). Kernel itself is unchanged.
> The comprehensive E2E test plan (cred-toggle matrix × every feature) ships **after** Wave 3 lands per the upstream brief.

---

## Summary

Wire the three pre-authored skill prompts (`fulfillment-ops.md`, `research-analyst.md`; **note:** `chief-of-staff.md` does NOT exist — author it during this plan as part of the Chief of Staff upgrade) into the proven Wave 1+2 agent shape (`lib/agents/_shared.ts` + `lib/executors/*` + `pending_*` tables + Render cron). Each external surface is wrapped in a credential-gated facade that returns real data when env vars are set, and synthesized fixtures otherwise. **Fulfillment Ops** is webhook-driven only — reuses `app/api/sp-api/webhook/route.ts` with a new dispatch case on `ORDER_CHANGE` / `ORDER_STATUS_CHANGE` notifications. **Research Analyst** runs single-pass daily 6am UTC cron — pulls openFDA shortage + recall (free, no auth) and Keepa Buy Box / FBA-stockout signals (cred-gated), scores 5–10 picks, emits `new_opportunity` briefings reusing Wave 1's `add_to_watchlist` executor. **Chief of Staff Digest** runs daily 7am UTC cron — reads all 24h briefings, writes one `digest`-typed briefing summarizing per-agent counts and key takeaways. **Chat tool extension** at `lib/tools/batch_approve_briefings.ts` and `lib/tools/dismiss_all_briefings.ts` lets Kaleem say "approve all the Bookkeeper anomalies" in `/chat` and have the orchestrator approve/dismiss the matching set. **Phase 1.5** Voyage embeddings fold in: `lib/voyage/embed.ts` (cred-gated), call from `lib/memory/write.ts` on every insert (best-effort; pg_trgm fallback already exists), and a backfill script for legacy rows.

The plan introduces:
- 3 new agent runtimes (`lib/agents/{fulfillment-ops,research-analyst,chief-of-staff-digest}.ts`) and 2 cron entries (`scripts/{research-analyst,chief-of-staff-digest}.ts`); Fulfillment Ops is webhook-only.
- 1 new executor (`lib/executors/generate-purchase-order.ts` — kind `generate_purchase_order`); registry update. Reuses `add_to_watchlist` (Wave 1) for Research Analyst.
- 2 new chat tools (`batch_approve_briefings`, `dismiss_all_briefings`) registered in `lib/tools/index.ts`. Plus a third helper tool `summarize_inbox` for the digest agent and Kaleem's natural-language queries.
- 1 new EDI client tree at `lib/edi/` (~250 LOC) — `x12.ts` (node-x12 wrap), `wholesaler-832.ts` (price/sales catalog parse), `wholesaler-856.ts` (advance ship notice parse), `_fixtures.ts` (synthesized ABC/McKesson/Cardinal/Parmed/EzriRx 832 snapshots), `index.ts` (`getWholesalerCatalogClient()` cred-gated).
- 1 new FDA client tree at `lib/fda/` (~120 LOC) — `client.ts`, `shortage.ts`, `recall.ts`. Real fetch; no creds required for default path; `FDA_API_KEY` raises rate limit from 1k/day to 120k/day.
- 1 new Keepa client tree at `lib/keepa/` (~180 LOC) — `client.ts` (token-bucket aware), `deal.ts`, `product.ts`, `_fixtures.ts`. Cred-gated by `KEEPA_API_KEY`.
- 1 new Voyage embeddings helper at `lib/voyage/embed.ts` (~30 LOC). Cred-gated by `VOYAGE_API_KEY`. Returns `null` if missing.
- 1 new pending table (`pending_purchase_orders`) — same shape as `pending_listings`.
- 1 migration file for the new pending table + indexes + a new `briefing_type` enum value `digest`.
- 1 modified `lib/memory/write.ts` — calls `embed()` on every insert (best-effort).
- 1 new backfill script (`scripts/backfill-embeddings.ts`).
- New skill file `minicrew-config/skills/chief-of-staff-digest.md` (the Chief of Staff upgrade authors a digest-specific prompt; the base `chief-of-staff.md` is the existing chat-handler system prompt at `lib/system-prompt.ts` and does NOT need a new file).
- Render cron entries: Research Analyst daily 6am UTC (`0 6 * * *` — same slot as Account Health; staggered to `15 6 * * *` to avoid colliding), Chief of Staff Digest daily 7am UTC (`0 7 * * *`). Fulfillment Ops is webhook-only.
- Inbox UI: `agentLabel()` mapping for `fulfillment_ops` and `research_analyst` are already present (Wave 1+2 added them prospectively per timeline.tsx:67-68); add `chief_of_staff_digest` mapping.
- Briefing-card tweak: extend `isReportOnly` to include `chief_of_staff_digest` source_agent (digests are read-only summaries — Kaleem can dismiss).
- 5 new env vars in `pharm1-shared` envVarGroup + `.env.example` (`KEEPA_API_KEY`, `EZRIRX_SFTP_HOST`, `EZRIRX_SFTP_USER`, `EZRIRX_SFTP_KEY`, `FDA_API_KEY`, `VOYAGE_API_KEY` — six vars; all `sync: false`).

Scope: ~33 NEW code files (lib/edi: 7, lib/fda: 5, lib/keepa: 6, lib/voyage: 1, lib/agents: 4, lib/executors: 1, lib/tools: 3, scripts: 6) + 2 new migrations + 1 new skill prompt + 12 new fixture files (vendor/edi-fixtures: 7, vendor/keepa-fixtures: 3, vendor/fda-fixtures: 2, vendor/sp-api-fixtures: 1 new entry) = ~49 NEW total when fixtures + skill counted. ~6 MODIFIED (lib/memory/write.ts, lib/executors/index.ts, lib/tools/index.ts, lib/system-prompt.ts, app/api/sp-api/webhook/route.ts, components/inbox/timeline.tsx, components/inbox/briefing-card.tsx, package.json, render.yaml, .env.example, lib/supabase/types.ts, app/api/actions/approve/route.ts via the Phase B kernel-extraction refactor). Net code addition ~1100–1450 LOC excluding fixtures/skill, ~1350–1700 LOC including. **Confidence for one-pass implementation: 8/10.**

---

## Intent / Why

Phase 2 Waves 1+2 are shipped: agents writing memory + briefings against our own Supabase tables (Wave 1) and SP-API-shaped fixtures (Wave 2). Wave 3 closes the agent set with the three remaining roles in the architecture diagram: Fulfillment Ops (the order-routing brain), Research Analyst (the morning opportunity sweep), and Chief of Staff (the curator of all 8 specialists' output for Kaleem). Plus, the Phase 1.5 memory-embeddings work — deferred since Phase 1 — folds in here because Wave 1's Reflector and the new Research Analyst need vector search for "what have we seen before" lookups.

After Wave 3, all 9 agents are live. Real-data swap of stub executors becomes the post-Wave-3 pass.

**Must not be optimized away:**
- Human-in-loop on every executor write (Kaleem clicks every approve/reject/undo).
- 30-minute undo on every action.
- Research Analyst is **single-pass** — locked decision; no 8-fanout subagents.
- Fulfillment Ops never auto-purchases; PO PDF generation is a stub that writes to `pending_purchase_orders`.
- Chief of Staff Digest is **report-only** (proposed_actions = []); Kaleem dismisses or replies in chat.
- Cred-gated everywhere: openFDA works without key (low rate limit); EzriRx, Keepa, Voyage all gracefully degrade to fixtures or no-ops when creds missing. End-state: Kaleem onboards to EzriRx/Keepa/Voyage post-launch and the agents go live without code changes.
- OTC-only — two-POS isolation invariant.
- Skill prompts are pre-authored except `chief-of-staff-digest.md` which we author here.

---

## Source Artifacts
- **Intent / why:** `tmp/plan-artifacts/2026-05-04-phase-2-wave-3-fulfillment-research-cos-brief.md`
- **Research dossier (this wave):** `tmp/plan-artifacts/2026-05-04-phase-2-wave-3-fulfillment-research-cos-research-dossier.md`
- **Discussion brief (upstream):** `tmp/briefs/2026-05-04-phase-2-waves-1-2-3-roadmap.md` (Wave 3 section)
- **Original Phase 2 brief (locked decisions):** `tmp/briefs/2026-05-01-phase-2-listing-automation.md`
- **Predecessor plans (mirror their shape):** `tmp/done-plans/2026-05-04-phase-2-wave-2-sp-api-agents.md`, `tmp/done-plans/2026-05-04-phase-2-wave-1-self-contained-agents.md`
- **Critical primary research:**
  - `tmp/research/2026-05-04-sp-api-comprehensive.md` (SP-API Orders + webhook patterns)
  - `tmp/research/2026-05-04-keepa-api.md` (Keepa token-bucket, /deal endpoint, /product)
  - `tmp/research/2026-05-04-fda-google-trends.md` (openFDA shortage + recall; Google Trends DEFERRED)
  - `tmp/research/2026-05-04-ezrirx-sms.md` (EzriRx EDI 832/856; node-x12 lib choice; no 846 → reframe as cross-source 832 comparison)
  - `tmp/research/2026-05-04-voyage-embeddings.md` (`voyage-4-lite`, 1024-dim drop-in)

---

## Verified Repo Truths

Each item is `Fact / Evidence / Implication`. Negative claims include `Search Evidence`.

### Kernel surface (carried from Waves 1+2)

- **Fact:** Executor registry at `lib/executors/index.ts:15-25` lists 9 executors after Wave 2.
  **Evidence:** Read of `lib/executors/index.ts` (current).
  **Implication:** Wave 3 adds `generate_purchase_order` only — one new entry.

- **Fact:** SP-API webhook route exists at `app/api/sp-api/webhook/route.ts` and dispatches by `NotificationType` to Wave 2 agents.
  **Evidence:** `app/api/sp-api/webhook/route.ts` from Wave 2 plan §J.
  **Implication:** Fulfillment Ops adds two new dispatch cases (`ORDER_CHANGE`, `ORDER_STATUS_CHANGE`) in the same `switch`. **No new route file needed.**

- **Fact:** Wave 1 + 2 agent shape (`lib/agents/_shared.ts` exports `loadSkillPrompt`, `callAgentLLM`, `dailyBudgetGate`, `DEFAULT_PHARMACY_ID`, `AGENT_MODEL`, `stripJsonFence`).
  **Evidence:** `lib/agents/_shared.ts:1-91`.
  **Implication:** Three Wave 3 agents reuse `_shared.ts` verbatim. No additions needed.

- **Fact:** Existing `/chat` API route at `app/api/chat/route.ts` uses `toolDefinitions` + `executeTool` from `lib/tools/index.ts` with OpenAI tool-calling protocol.
  **Evidence:** `app/api/chat/route.ts:1-198`.
  **Implication:** Adding chat tools is two new files in `lib/tools/` plus three lines in `lib/tools/index.ts`. No route changes.

- **Fact:** Tool registry shape: each tool exports `<name>_def` (OpenAI ToolDefinition) and `<name>` (handler with signature `(input, ctx) => Promise<string>`).
  **Evidence:** `lib/tools/index.ts:1-37`, `lib/tools/get_recent_briefings.ts:29-73`.
  **Implication:** New tools follow the same pattern.

### Schema reality

- **Fact:** `briefing_type` enum already includes `order_to_fulfill`, `new_opportunity`, `fda_recall_triggered`, `rx_shortage_adjacency` — Fulfillment Ops + Research Analyst briefing types are present.
  **Evidence:** `supabase/migrations/20260419000004_briefings_schema.sql:6-11`.
  **Implication:** No enum migration for the agents themselves. **One new value needed: `digest`** for Chief of Staff Digest output. Postgres `ALTER TYPE ... ADD VALUE` cannot run in a transaction, so this lives in its own migration file (per Wave 1's enum-add precedent: `20260504000001_wave1_brand_paused_enum.sql`).

- **Fact:** `pending_listings` is the canonical breadcrumb table shape. `pending_pricing_changes`, `pending_customer_messages`, `pending_health_actions` mirror it (Wave 2).
  **Evidence:** `supabase/migrations/20260501000001_pending_listings_and_system_spend.sql:6-21`, `supabase/migrations/20260504000003_wave2_pending_tables.sql`.
  **Implication:** `pending_purchase_orders` follows the same pattern: id, pharmacy_id, FK to `orders`, proposed_* columns, status enum, audit_log_id FK, edi_*_id slots for post-launch swap, applied_at, cancelled_at, created_at.

- **Fact:** `wholesaler_stock_snapshots` table exists with columns `(id, product_id, supplier, stock_qty, price, anticipated_restock_date, lot_number, expiration_date, captured_at)` and an index on `(product_id, captured_at desc)`. **There is NO `metadata` jsonb column.**
  **Evidence:** `supabase/migrations/20260419000002_core_schema.sql:106-117` — verified column-by-column.
  **Implication:** Wave 3 Fulfillment Ops does NOT persist wholesaler comparisons to `wholesaler_stock_snapshots`. The cross-source comparison is held in-memory only (passed into the LLM payload and stored as `briefings.data_snapshot` jsonb on the briefing row) per Known Limitation below. Wave 4 (post-EzriRx onboarding) may add persistent snapshot rows. **No `metadata->>'source' = 'fixture'` tagging — the column does not exist; do not attempt to write it.**

- **Fact:** `orders` table has `(platform, platform_order_id, listing_id, sold_price, sold_at, customer_address, status)`. `unique (platform, platform_order_id)` already exists.
  **Evidence:** `supabase/migrations/20260419000002_core_schema.sql:81-101`.
  **Implication:** Fulfillment Ops's webhook ingest upserts into `orders` by `(platform, platform_order_id)` from the SP-API order envelope; idempotent on retry.

- **Fact:** `memory.embedding vector(1024)` column exists; HNSW index on cosine ops; trigram fallback present. `embedding_model text` column exists.
  **Evidence:** `supabase/migrations/20260419000003_memory_schema.sql:14-31`.
  **Implication:** Voyage `voyage-4-lite` (1024-dim default) drops in without schema change. `embedding_model = 'voyage-4-lite'` is set on each insert.

- **Fact:** `briefings.proposed_actions jsonb` is free-form. Wave 1 + 2 conventions: each action has `kind`, `params`, `label`, optional `variant: 'primary'`.
  **Evidence:** `lib/agents/listing-agent.ts`, `briefing-card.tsx:178-200`.
  **Implication:** Fulfillment Ops emits `proposed_actions = [{ kind: 'generate_purchase_order', variant: 'primary', label: 'PO from <wholesaler>', params: {...}}, ... one per wholesaler ..., { kind: 'dismiss_briefing', label: 'Skip — handle manually', params: {} }]`. Research Analyst emits `proposed_actions = [{ kind: 'add_to_watchlist', variant: 'primary', label: 'Add to watchlist', params: { product_ids: [pick.product_id], reason: pick.rationale.slice(0, 500) }}, { kind: 'dismiss_briefing', label: 'Skip', params: {} }]` — note `add_to_watchlist` requires `product_ids: string[]` (plural) per the Wave 1 Zod shape. Chief of Staff Digest emits `proposed_actions = []` (report-only).

- **Fact:** Skill prompt loader resolves `minicrew-config/skills/<name>.md` by `process.cwd()`.
  **Evidence:** `lib/agents/_shared.ts:26-32`.
  **Implication:** New skill file `minicrew-config/skills/chief-of-staff-digest.md` is loaded by `loadSkillPrompt('chief-of-staff-digest')`.

### Inbox UI / `timeline.tsx`

- **Fact:** `components/inbox/timeline.tsx:51-74` — `agentLabel()` already maps all 9 currently-shipped agent source_agent values: `bookkeeper`, `reflector`, `portfolio_manager`, `listing_agent`, `repricer`, `research_analyst`, `account_health`, `fulfillment_ops`, `customer_success`. **The only missing mapping is `chief_of_staff_digest`** (the new agent introduced in this plan).
  **Evidence:** Read of `components/inbox/timeline.tsx:51-74`.
  **Implication:** Add one `case 'chief_of_staff_digest': return 'Daily Digest';` line. Other Wave 3 agents already mapped.

- **Fact:** `briefing-card.tsx:201-213` has the `isReportOnly` flag for `bookkeeper` / `reflector` / `portfolio_manager` (empty actions) / `account_health` (empty actions). Render: "Acknowledge" instead of "Dismiss".
  **Evidence:** `components/inbox/briefing-card.tsx:201-213`.
  **Implication:** Extend the disjunct to include `chief_of_staff_digest` — `(item.source_agent === 'chief_of_staff_digest')` is always report-only because digest briefings always have empty `proposed_actions`.

### Render / cron

- **Fact:** `render.yaml` has 8 services after Wave 2: web + 6 agent crons + 2 backup crons. EnvVarGroup `pharm1-shared` has 30 vars.
  **Evidence:** Bash inspection of `render.yaml`.
  **Implication:** Wave 3 adds 2 more cron services (Research Analyst daily 06:15 UTC staggered, Chief of Staff Digest daily 07:00 UTC). Six new env vars get added to `pharm1-shared`.

- **Fact:** `package.json:14-17, 33` already has `agent:repricer`, `agent:account-health`, `tsx`, etc.
  **Evidence:** `package.json` read.
  **Implication:** Wave 3 adds `agent:research-analyst`, `agent:chief-of-staff-digest`, `agent:fulfillment-ops-test` (one-shot dry-run for the webhook handler), `embeddings:backfill`, `fda:smoke` (one-shot probe), `keepa:token` (cheap balance probe).

### Skill files

- **Fact:** `minicrew-config/skills/{fulfillment-ops,research-analyst}.md` exist (authored Phase 1).
  **Evidence:** Bash `ls minicrew-config/skills/`.
  **Implication:** Wire these as system prompts.

- **Fact:** `minicrew-config/skills/chief-of-staff.md` does NOT exist.
  **Search Evidence:** `find minicrew-config/skills -name "chief-of-staff*"` returns nothing.
  **Implication:** The brief said "existing chat handler" — that is `lib/system-prompt.ts` (which builds the chat persona). The Wave 3 upgrade is adding a separate digest agent (own skill file) and chat-tool extensions (no skill file needed; system-prompt.ts already mentions tool-use). **Plan authors `minicrew-config/skills/chief-of-staff-digest.md`, NOT `chief-of-staff.md`.**

### Negative checks

- **Fact:** No file under `lib/edi/`, `lib/fda/`, `lib/keepa/`, `lib/voyage/`, `lib/agents/{fulfillment-ops,research-analyst,chief-of-staff-digest}.ts`, `lib/executors/generate-purchase-order.ts`, `scripts/{research-analyst,chief-of-staff-digest,backfill-embeddings,fda-smoke,keepa-token-probe,fulfillment-ops-test}.ts`, or `lib/tools/{batch_approve_briefings,dismiss_all_briefings,summarize_inbox}.ts` exists today.
  **Search Evidence:** `find lib/edi lib/fda lib/keepa lib/voyage 2>&1 | grep -v "No such"` — empty. `find lib/agents/fulfillment-ops.ts lib/agents/research-analyst.ts lib/agents/chief-of-staff-digest.ts 2>&1 | grep -v "No such"` — empty.
  **Implication:** All those paths are NEW.

- **Fact:** No `node-x12` package installed.
  **Search Evidence:** `grep '"node-x12"' package.json` — zero matches.
  **Implication:** `npm i node-x12` adds the EDI parser. Per dossier, `node-x12` is actively maintained.

- **Fact:** No `voyageai` package installed; we use bare `fetch()` per dossier §7.
  **Search Evidence:** `grep "voyageai" package.json` — zero.
  **Implication:** No SDK install. `lib/voyage/embed.ts` is a 30-line `fetch()` wrapper.

- **Fact:** No FDA or Keepa SDK installed (none exists for Keepa in TypeScript per dossier; FDA is just REST).
  **Implication:** Both `lib/fda/` and `lib/keepa/` are hand-rolled fetch clients.

- **Fact:** `briefing_type` enum has no `digest` value.
  **Search Evidence:** `grep "create type briefing_type" -A 8 supabase/migrations/20260419000004_briefings_schema.sql`.
  **Implication:** Migration adds `digest` (split into a separate enum-add migration file because Postgres forbids `ALTER TYPE ... ADD VALUE` inside a transaction with other DDL).

- **Fact:** `lib/memory/write.ts:23-55` already exists from Wave 1 with no embedding hook.
  **Evidence:** Read of file.
  **Implication:** Modify `writeMemory` to call `embed()` post-insert (separate UPDATE call so the insert happens whether embed succeeds or not).

---

## Locked Decisions

1. **Three agents only.** Fulfillment Ops, Research Analyst, Chief of Staff Digest. Plus two cross-cutting features: chat tool extensions (not a separate agent) and Voyage embeddings fold-in.
2. **Skill prompts are pre-authored except `chief-of-staff-digest.md`** — wire `fulfillment-ops.md` + `research-analyst.md`; author `chief-of-staff-digest.md` as part of this plan. **Do NOT author `chief-of-staff.md` — the user said "existing chat handler" which is `lib/system-prompt.ts` and `app/api/chat/route.ts`. The "upgrade" is the new tools and the digest agent, not a new chat persona prompt.**
3. **Research Analyst is single-pass.** No 8-fanout subagents. Locked. Per `tmp/briefs/2026-05-01-phase-2-listing-automation.md` and the upstream brief.
4. **Fulfillment Ops is webhook-only.** No cron entry. Reuses `app/api/sp-api/webhook/route.ts` with two new dispatch cases (`ORDER_CHANGE`, `ORDER_STATUS_CHANGE`). The fixture-mode dry-run uses `scripts/fulfillment-ops-test.ts`.
5. **Real APIs for FDA + Voyage; cred-gated for Keepa + EzriRx.**
   - openFDA: real fetch; key optional (raises rate limit). No fixture fallback for the 200-OK happy path; on 5xx, fall back to a synthesized empty-results payload.
   - Voyage: cred-gated by `VOYAGE_API_KEY`. If missing, `embed()` returns `null`. Memory writes succeed without embeddings (pg_trgm fallback covers retrieval).
   - Keepa: cred-gated by `KEEPA_API_KEY`. If missing, `getKeepaClient()` returns the fixture client which produces synthesized Buy Box / Sales Rank / FBA-stockout snapshots.
   - EzriRx EDI: cred-gated by `EZRIRX_SFTP_HOST` (and supporting user/key). If missing, `getWholesalerCatalogClient()` returns the fixture client which loads `vendor/edi-fixtures/*.832.edi` snapshots and parses them via the same `node-x12` path.
6. **Google Trends DEFERRED to Phase 2.5.** Per the FDA-Trends dossier recommendation: pytrends is unsafe (archived, 429s); SerpAPI is paid ($75/mo); DataForSEO is paid; the signal value is sub-linear vs FDA shortage data. Wave 3 does NOT pull Trends data. Documented as an open Phase-2.5 item in `Open Questions` and `tmp/briefs/`.
7. **Single new pending table.** `pending_purchase_orders` mirrors `pending_listings` shape with `wholesaler` and `proposed_unit_price` columns added. Status enum: `pending | applied | cancelled` (post-launch swap: `applied` happens after the EDI 850 is sent).
8. **Single new executor: `generate_purchase_order`.** Forward inserts a `pending_purchase_orders` row with `status='pending'` and stub-logs `[STUB] would generate PO PDF and send 850 EDI to <wholesaler>`. Reverse marks row cancelled. Real EDI 850 send (post-Wave-3 swap) replaces the log line; reverse may add a 860 PO Change for cancellation.
9. **Research Analyst reuses Wave 1's `add_to_watchlist` executor.** No new executor for opportunities — listing happens later via the Listing Agent's `list_on_amazon` once a watching product matures. **Params shape (per Wave 1's Zod schema at `lib/executors/add-to-watchlist.ts:10-13`): `{ product_ids: string[1..20], reason: string[1..500] }`. Plural `product_ids`, required `reason`. Research Analyst per-pick emits `params: { product_ids: [pick.product_id], reason: pick.rationale.slice(0, 500) }` — single-element array per briefing (one watchlist add per pick).**
10. **Chief of Staff Digest is report-only.** `proposed_actions = []`. Briefings appear in inbox with `isReportOnly` rendering.
11. **Two new chat tools.** `batch_approve_briefings(filter)` and `dismiss_all_briefings(filter)` plus a third helper `summarize_inbox()` used by both the digest agent and Kaleem's natural-language queries. Filter shape: `{ source_agent?: string, briefing_type?: string, briefing_ids?: string[] }`.
12. **Voyage embeddings on memory writes are best-effort.** `writeMemory` calls `embed()` after the insert; if it returns `null` (creds missing) or throws (rate limit / 5xx), insert succeeds anyway. Embedding `UPDATE` happens out-of-band via `await` after insert. Same idempotence semantics as before.
13. **Backfill script is idempotent.** Walks `memory` rows where `embedding IS NULL` in batches of 100; embeds and updates. Safe to re-run.
14. **Same daily spend cap (`MAX_DAILY_CLAUDE_SPEND_USD = 50`).** Research Analyst's daily Sonnet 4.6 ~$0.03/run (single-pass over 5–10 candidates). Fulfillment Ops per-order ~$0.02 (Sonnet 4.6 with 4–5 wholesaler rows in payload). Chief of Staff Digest daily ~$0.02 (Sonnet 4.6 over 24h briefing summaries). All trivial vs cap.
15. **Voyage cost is effectively zero on `voyage-4-lite`.** Per the dossier (`tmp/research/2026-05-04-voyage-embeddings.md` §6 + table at lines 83-94), `voyage-4-lite` is 1024-dim (drops into existing `vector(1024)` column with no migration), $0.02/M tokens paid, AND has a **200M-token-per-account free allowance** on the v4 model family. Our projected ~600K tokens/month sits inside the free tier indefinitely; even if usage 100×s, it stays inside free. Originally we picked `voyage-3.5-lite` (legacy line, also 1024-dim, also $0.02/M, but **paid from token 1** with no free tier). Switched to `voyage-4-lite` for the free tier — no quality regression (both score similarly on MTEB; v4-lite is the newer line).
16. **Single tenant** — `pharmacy_id = 00000000-0000-0000-0000-000000000001`. Same as Waves 1+2.
17. **Cron-safe Supabase admin client** for both cron scripts and the webhook handler.
18. **Approve-flow ordering carried from Waves 1+2:** executor first, audit_log second.
19. **No automated tests.** Wave 3 mirrors Waves 1+2 manual-click-through validation. **Comprehensive E2E test plan ships AFTER Wave 3** per upstream brief — that is the next deliverable, not part of this plan.
20. **Render cron schedules:**
    - Research Analyst: `15 6 * * *` (06:15 UTC, staggered 15 min after Account Health's 06:00 — not because of serial-execution contention, but so log streams don't interleave during morning agent debugging).
    - Chief of Staff Digest: `0 7 * * *` (07:00 UTC, 45 min after Research Analyst, so the digest captures the Research Analyst's morning briefings in the same daily cycle). **Render cron services are independent concurrent workers — no serial-execution coupling between them.**
21. **Reasoning effort:**
    - Research Analyst: `'medium'` (skill prompt has scoring + filter logic; medium is enough).
    - Fulfillment Ops: `'medium'`.
    - Chief of Staff Digest: `'low'` (summary task; cheap).
22. **No Google Trends, no Perplexity-style web search.** The `research-analyst.md` skill mentions LLM web search — runtime payload omits it. Skill prompt is not rewritten; an instruction in the system message addendum disables that step (per Wave 1's `_shared.ts` JSON-only suffix pattern).
23. **EDI fixtures are committed.** Same precedent as `vendor/sp-api-fixtures/`. `vendor/edi-fixtures/wholesaler-832-{abc,mckesson,cardinal,parmed,ezrirx}.edi` are hand-synthesized files — text-based EDI envelopes — committed at ~2KB each.
24. **`pending_purchase_orders` references the order ID, not the briefing ID.** This couples the executor row to the underlying business object (the order being fulfilled). Multiple PO proposals against one order create multiple rows; the `audit_log_id` FK distinguishes them.
25. **Chat tool extensions perform a server-side approve/dismiss loop.** `batch_approve_briefings` does NOT call the `/api/actions/approve` HTTP route — it directly invokes `approveOne()` exported from `lib/kernel/approve.ts` (the kernel-extraction landed in Phase H, BEFORE the new agents in Phases I/J/K — see Phase H rationale). The same `approveOne()` is also used by the route handler, so both paths share identical logic. This avoids cookie/auth round-trips inside the chat session. The session's authenticated user_id (from `requireAuthenticatedUser`) is reused as the actor.
26. **Digest writes to `briefings` with `briefing_type='digest'` and `proposed_actions=[]`.** Inbox renders it as `isReportOnly`.
27. **`rx_shortage_adjacency` enum value is interpreted broadly.** The literal name (from the original Phase 1 enum) implies Rx-shortage→OTC-adjacency, but Wave 3 Research Analyst uses the same value for direct OTC shortages too (e.g. an FDA-listed acetaminophen OTC shortage). Reasoning: adding a new enum value (`otc_shortage`) requires its own migration (Postgres `ALTER TYPE ADD VALUE` cannot live in a transaction with other DDL), and the runtime semantic — "shortage-driven opportunity worth surfacing" — is identical for both cases. **Documentation contract: `rx_shortage_adjacency` means "any FDA-shortage-driven Research Analyst pick" in Wave 3.** Future plan may split into two enum values if the distinction becomes operationally meaningful. Keeps Wave 3 migration scope to two files (digest enum-add + pending_purchase_orders structure).

---

## Known Mismatches / Assumptions

| # | Item | Brief said | Repo / dossier reality | Resolution |
|---|---|---|---|---|
| 1 | EzriRx 846 (real-time inventory) | "Cross-source comparison table (price, stock, ETA per wholesaler)" | EzriRx EDI does NOT support 846 (per dossier §1.2) | **Reframe as "most-recent-832 cross-source comparison"** with timestamps. Stock numbers come from the most recent 832 push (typically nightly). Real-time stock would require per-wholesaler portal scraping (out of scope). The fixture mode synthesizes 832-derived snapshots dated ≤24h. |
| 2 | "Order webhook from SP-API" | Real-time push | SP-API has `ORDER_CHANGE` and `ORDER_STATUS_CHANGE` notification types per dossier §5 | Reuse `app/api/sp-api/webhook/route.ts`. Add two `case` branches in the existing `switch`. No new route. |
| 3 | "Real Keepa client" | Cred-gated | Keepa has no TS SDK; we hand-roll | Hand-rolled fetch client at `lib/keepa/` per dossier §3. Token-bucket aware (use `tokensLeft` from response body to gate further calls; 429-aware retry per dossier §2 token mechanics). |
| 4 | "FDA Drug Shortage + Recall (free, no auth)" | Free | Confirmed per dossier §1, §2 | Real fetch only. Optional `FDA_API_KEY` raises rate limit from 1k/day to 120k/day. No fixture fallback for happy path; 5xx → empty-results payload. |
| 5 | "Generate PO PDF (stubbed)" | "writes to pending_purchase_orders" | We don't have a PDF library installed | Stub forward logs `[STUB] would generate PO PDF and send 850 EDI to <wholesaler>` — no PDF library install in Wave 3. Post-launch swap may add `pdf-lib` or `puppeteer-core`. |
| 6 | "Daily digest agent at lib/agents/chief-of-staff-digest.ts" | New file | Confirmed; no `chief-of-staff.md` skill exists | Author `minicrew-config/skills/chief-of-staff-digest.md` (~80 lines) for the digest agent's system prompt. |
| 7 | "Chief of Staff upgrade — already half-built at /chat" | "Add: read pending briefings across all 8 specialists, route Kaleem's natural-language replies into proposed_actions" | `/chat` exists at `app/api/chat/route.ts`; tool registry at `lib/tools/index.ts` | Add 3 new tools (`batch_approve_briefings`, `dismiss_all_briefings`, `summarize_inbox`); no chat-route changes. The system prompt at `lib/system-prompt.ts` is updated to mention these new tools. |
| 8 | "Phase 1.5 fold-in: Voyage AI memory embeddings" | "30-line fetch helper at lib/memory/embed.ts" | Brief said `lib/memory/embed.ts`; the dossier and our convention prefer `lib/voyage/embed.ts` (consistent with `lib/sp-api/`, `lib/sms/`, `lib/edi/`, `lib/fda/`, `lib/keepa/`) | Resolve to `lib/voyage/embed.ts`. `lib/memory/write.ts` imports from there. **Open Question 1 below; defaulting to `lib/voyage/`.** |
| 9 | "Update lib/memory/write.ts (Wave 1) to also call embed() on insert" | Confirmed | `writeMemory` is the only public API in `lib/memory/write.ts` | Modify to call `embed()` after the INSERT and `UPDATE memory SET embedding=$1, embedding_model='voyage-4-lite' WHERE id=$inserted_id`. Best-effort; if `embed()` returns null or throws, log warning, return original `{ id, inserted }` result. |
| 10 | "Backfill script scripts/backfill-embeddings.ts" | Confirmed | No existing backfill script | New file. Walks `memory WHERE embedding IS NULL` in batches of 100. For each batch, calls Voyage's batch-embed endpoint (max 1000 inputs/req per dossier §4). Updates via Postgres `unnest` array trick or per-row UPDATE. |
| 11 | "Chat tool extension: extend the existing /chat API route's tool set (lib/tools/) with batch_approve_briefings" | Brief specified two tools | Three are useful (also `summarize_inbox`); aligns with digest agent's needs | Add three tools. `summarize_inbox` is reused by both Kaleem queries and the digest agent. |
| 12 | "Briefing type: order_to_fulfill (already in enum)" | Confirmed | `supabase/migrations/20260419000004_briefings_schema.sql:9` | No enum change for Fulfillment Ops. |
| 13 | "Briefing type: new_opportunity (in enum)" | Confirmed | `supabase/migrations/20260419000004_briefings_schema.sql:7` | No enum change for Research Analyst. |
| 14 | "Briefing type: digest" (Chief of Staff Digest) | Implied — "writes a single digest-typed briefing" | NOT in enum | Add `digest` to `briefing_type` enum. New migration `20260504000004_wave3_digest_enum.sql` (enum-add only — must be its own migration). |
| 15 | "Inbox UI: agentLabel() mapping for fulfillment_ops, research_analyst, chief_of_staff_digest" | "verify Wave 1 already added these prospectively or add now" | Wave 1 added `fulfillment_ops` and `research_analyst` (timeline.tsx:67-68). `chief_of_staff_digest` is new. | Add one case to `agentLabel()`: `chief_of_staff_digest → 'Daily Digest'`. |
| 16 | "Render cron entries: Research Analyst daily 6am UTC" | 06:00 UTC | Account Health (Wave 2) is 06:00 UTC | Stagger Research Analyst to 06:15 UTC to avoid Render serial-cron contention; document. |
| 17 | "FDA + Real Keepa clients (no fixtures needed for FDA — it's free; Keepa cred-gated)" | Confirmed | FDA is keyless; Keepa is paid | FDA has no fixtures; on 5xx, return empty-results synthetic envelope. Keepa has fixtures in `vendor/keepa-fixtures/` for cred-missing path. |
| 18 | "EzriRx onboarding requires Kaleem account" | Brief: "use 832 + 856; no 846" | Per dossier §1.2 | Cred-gated. Fixture-mode wholesaler-comparison data is synthesized for ABC/McKesson/Cardinal/Parmed/EzriRx. |
| 19 | "Single executor: generate_purchase_order" | Brief implied | We need only one new kind | Confirmed. Re-uses `dismiss_briefing` (Wave 1; `lib/executors/dismiss-briefing.ts` — thin no-op forward returns `{dismissed:true}`, reverse `{restored:true}`) for the explicit "Skip" pseudo-action. **All `dismiss_briefing` proposed-action entries use `params: {}` — no `briefing_id: '_self'` magic string. The bottom-row Reject button on `briefing-card.tsx:191-199` is a separate path that routes to `/api/actions/reject` and dismisses without invoking any executor; both paths are valid.** |
| 20 | Wave 2 `acknowledge_health_alert` undo gap | Wave 2's locked decision 21 noted | Carried as known limitation | Same applies to Wave 3 generate_purchase_order: Kaleem-clicked POs are undoable for 30 min via the kernel; system-actor POs (we don't have any in Wave 3) would not be undoable via UI. Wave 3 has no system-actor POs — every PO is a Kaleem click. |

---

## Critical Codebase Anchors

Keep open while implementing.

- `lib/executors/index.ts:15-25` — registry to extend
- `lib/executors/types.ts:1-30` — Executor interface + UnknownExecutorError
- `lib/executors/list-on-amazon.ts:1-77` — canonical executor shape (forward + reverse + Zod schema + `console.log('[STUB] ...')` SP-API call site) — most relevant precedent for `generate_purchase_order`
- `lib/agents/_shared.ts:1-91` — shared helpers (use as-is)
- `lib/agents/listing-agent.ts:1-262` — canonical agent shape
- `lib/agents/portfolio-manager-output-adapter.ts` — Zod discriminated-union adapter pattern (Research Analyst's pick→briefing mapper mirrors this)
- `lib/agents/customer-success.ts` — two-stage agent pattern (precedent for digest agent's two-pass: gather+summarize)
- `app/api/sp-api/webhook/route.ts` — Wave 2 webhook route to extend with two new dispatch cases
- `lib/sp-api/index.ts` — fixture-vs-real factory pattern to mirror in `lib/edi/`, `lib/fda/`, `lib/keepa/`, `lib/voyage/`
- `lib/sp-api/_fixtures.ts` — fixture loader pattern (`loadFixture<T>(operationId)`)
- `lib/sms/twilio.ts` — single-call cred-gated client pattern (precedent for `lib/voyage/embed.ts` shape)
- `lib/memory/write.ts:23-55` — modify to add embed() call
- `lib/tools/index.ts:9-21` — registry to extend with 3 new tools
- `lib/tools/get_recent_briefings.ts:29-73` — canonical tool shape (def + handler)
- `app/api/chat/route.ts:1-198` — chat route (no changes; reads tool registry)
- `lib/system-prompt.ts` — Chat persona; add 1 paragraph about new tools (small edit)
- `app/api/actions/approve/route.ts:36-148` — kernel approve route. Phase H extracts the body to `lib/kernel/approve.ts` (NEW); the route's body shrinks to a thin call site. Behavior preserved; chat tools also call `approveOne()` from the new module.
- `components/inbox/timeline.tsx:51-74` — agentLabel switch to extend
- `components/inbox/briefing-card.tsx:201-213` — isReportOnly disjunct to extend with `chief_of_staff_digest`
- `supabase/migrations/20260501000001_pending_listings_and_system_spend.sql` — pending_listings schema (mirror for pending_purchase_orders)
- `supabase/migrations/20260504000001_wave1_brand_paused_enum.sql` — single-statement enum-add migration precedent
- `supabase/migrations/20260419000004_briefings_schema.sql` — briefings/inbox/audit schema
- `tmp/research/2026-05-04-keepa-api.md:50-220` — Keepa endpoints + token mechanics
- `tmp/research/2026-05-04-fda-google-trends.md:30-260` — openFDA shortage + recall query syntax
- `tmp/research/2026-05-04-ezrirx-sms.md:50-160` — node-x12 + 832/856 segment shapes
- `tmp/research/2026-05-04-voyage-embeddings.md:30-200` — Voyage embed endpoint
- `tmp/research/2026-05-04-sp-api-comprehensive.md` (sections on Orders + Notifications) — `ORDER_CHANGE` envelope shape
- `minicrew-config/skills/fulfillment-ops.md` — skill prompt to wire
- `minicrew-config/skills/research-analyst.md` — skill prompt to wire
- (NEW) `minicrew-config/skills/chief-of-staff-digest.md` — author this file

---

## Files Being Changed

```
pharm1/
├── supabase/
│   └── migrations/
│       ├── 20260504000004_wave3_digest_enum.sql                ← NEW (enum-add: 'digest' to briefing_type)
│       └── 20260504000005_wave3_pending_purchase_orders.sql    ← NEW (pending_purchase_orders table + indexes)
│
├── vendor/
│   ├── edi-fixtures/                                            ← NEW (committed)
│   │   ├── wholesaler-832-abc.edi                               ← synthesized 832 from 5 wholesalers, 30-product overlap
│   │   ├── wholesaler-832-mckesson.edi
│   │   ├── wholesaler-832-cardinal.edi
│   │   ├── wholesaler-832-parmed.edi
│   │   ├── wholesaler-832-ezrirx.edi
│   │   ├── wholesaler-856-sample.edi                            ← one ASN sample for the receive-side parser tests
│   │   └── wholesaler-comparison-sample.json                    ← parsed-and-merged shape: array of {wholesaler, ndc, unit_price, stock, eta, captured_at}
│   ├── keepa-fixtures/                                          ← NEW (committed)
│   │   ├── deal.json                                             ← /deal response shape (5 deals)
│   │   ├── product.json                                          ← /product response (1 ASIN; csv arrays)
│   │   └── token.json                                            ← /token response
│   └── fda-fixtures/                                            ← NEW (committed; only used on 5xx fallback)
│       ├── shortage-empty.json                                   ← {meta:{...}, results:[]}
│       └── recall-empty.json
│
├── lib/
│   ├── edi/                                                     ← NEW (~250 LOC)
│   │   ├── x12.ts                                                ← node-x12 thin wrap
│   │   ├── wholesaler-832.ts                                     ← parse 832 → {ndc, name, unit_price, pack_size, captured_at}
│   │   ├── wholesaler-856.ts                                     ← parse 856 → {bsn_number, tracking, items[], shipped_at}
│   │   ├── _fixtures.ts                                          ← loadFixtureCatalog()/loadFixtureAsn()
│   │   ├── _real.ts                                              ← NEW (placeholder; throws "not implemented" pointing to EzriRx onboarding doc)
│   │   ├── types.ts                                              ← shared Zod schemas
│   │   └── index.ts                                              ← getWholesalerCatalogClient() cred-gated; produces normalized wholesaler-comparison-sample-shaped output
│   │
│   ├── fda/                                                     ← NEW (~120 LOC)
│   │   ├── client.ts                                             ← shared fetch wrapper (api.fda.gov; URL-encoded query syntax helper)
│   │   ├── shortage.ts                                           ← getActiveOtcShortages(): FdaShortageRecord[]
│   │   ├── recall.ts                                             ← getRecentDrugRecalls({since}): FdaRecallRecord[]
│   │   ├── types.ts                                              ← interfaces from dossier §1.2, §2.4
│   │   └── index.ts                                              ← getFdaClient() — always returns real client; on 5xx returns empty
│   │
│   ├── keepa/                                                   ← NEW (~180 LOC)
│   │   ├── client.ts                                             ← token-bucket aware wrapper; reads tokensLeft from each response
│   │   ├── deal.ts                                               ← getRecentDeals({categories, dateRange})
│   │   ├── product.ts                                            ← getProduct(asin, opts)
│   │   ├── _fixtures.ts                                          ← loadFixture<T>(operationId)
│   │   ├── types.ts                                              ← KeepaProduct, KeepaDeal, KeepaTokenResponse
│   │   └── index.ts                                              ← getKeepaClient() cred-gated
│   │
│   ├── voyage/                                                  ← NEW (~30 LOC)
│   │   └── embed.ts                                              ← `embed(input: string | string[]): Promise<number[][]|null>` — bare fetch; null when VOYAGE_API_KEY missing
│   │
│   ├── memory/
│   │   └── write.ts                                              ← MODIFIED — call embed() post-insert; UPDATE row with embedding + embedding_model
│   │
│   ├── agents/
│   │   ├── fulfillment-ops.ts                                    ← NEW (~250 LOC)
│   │   ├── research-analyst.ts                                   ← NEW (~250 LOC)
│   │   ├── research-analyst-output-adapter.ts                    ← NEW (~50 LOC) — pick → briefing+proposed_action mapper
│   │   └── chief-of-staff-digest.ts                              ← NEW (~150 LOC)
│   │
│   ├── executors/
│   │   ├── generate-purchase-order.ts                            ← NEW (kind: 'generate_purchase_order')
│   │   └── index.ts                                              ← MODIFIED (register 1 new executor)
│   │
│   ├── kernel/                                                    ← NEW directory
│   │   └── approve.ts                                             ← NEW — exports approveOne(); extracted from app/api/actions/approve/route.ts in Phase H
│   │
│   ├── tools/
│   │   ├── batch_approve_briefings.ts                            ← NEW (consumes lib/kernel/approve.ts in Phase L)
│   │   ├── dismiss_all_briefings.ts                              ← NEW
│   │   ├── summarize_inbox.ts                                    ← NEW
│   │   └── index.ts                                              ← MODIFIED (register 3 new tools)
│   │
│   ├── system-prompt.ts                                          ← MODIFIED (~6 lines added — describe new tools)
│   ├── llm-pricing.ts                                            ← MODIFIED (no new model entries needed; Sonnet 4.6 already covered)
│   └── supabase/types.ts                                         ← MODIFIED (regenerated after migrations)
│
├── components/
│   └── inbox/
│       ├── timeline.tsx                                          ← MODIFIED (agentLabel switch +1 case)
│       └── briefing-card.tsx                                     ← MODIFIED (extend isReportOnly disjunct)
│
├── app/
│   └── api/
│       ├── actions/
│       │   └── approve/
│       │       └── route.ts                                      ← MODIFIED — body shrinks to call approveOne() from lib/kernel/approve.ts (Phase H refactor; behavior unchanged)
│       └── sp-api/
│           └── webhook/
│               └── route.ts                                      ← MODIFIED (add ORDER_CHANGE / ORDER_STATUS_CHANGE switch cases dispatching to runFulfillmentOps)
│
├── scripts/
│   ├── research-analyst.ts                                      ← NEW (cron entry)
│   ├── chief-of-staff-digest.ts                                 ← NEW (cron entry)
│   ├── fulfillment-ops-test.ts                                  ← NEW (one-shot dry-run loading fixture order envelope)
│   ├── backfill-embeddings.ts                                   ← NEW (Voyage backfill walker)
│   ├── fda-smoke.ts                                             ← NEW (one-shot openFDA probe; prints first 3 shortages)
│   └── keepa-token-probe.ts                                     ← NEW (one-shot /token call to verify creds; prints tokensLeft + refillRate)
│
├── minicrew-config/
│   └── skills/
│       └── chief-of-staff-digest.md                             ← NEW (~80 lines)
│
├── .env.example                                                  ← MODIFIED (6 new vars: KEEPA_API_KEY, EZRIRX_SFTP_HOST, EZRIRX_SFTP_USER, EZRIRX_SFTP_KEY, FDA_API_KEY, VOYAGE_API_KEY)
├── package.json                                                  ← MODIFIED (add `node-x12` dep + 6 new scripts)
└── render.yaml                                                  ← MODIFIED (2 new cron services + 6 new envVars in pharm1-shared)
```

Total (counted explicitly from the tree above):

**NEW code/config files (~34):**
- `lib/edi/`: 7 (`x12.ts`, `wholesaler-832.ts`, `wholesaler-856.ts`, `_fixtures.ts`, `_real.ts`, `types.ts`, `index.ts`)
- `lib/fda/`: 5 (`client.ts`, `shortage.ts`, `recall.ts`, `types.ts`, `index.ts`)
- `lib/keepa/`: 6 (`client.ts`, `deal.ts`, `product.ts`, `_fixtures.ts`, `types.ts`, `index.ts`)
- `lib/voyage/`: 1 (`embed.ts`)
- `lib/kernel/`: 1 (`approve.ts` — Phase H extraction)
- `lib/agents/`: 4 (`fulfillment-ops.ts`, `research-analyst.ts`, `research-analyst-output-adapter.ts`, `chief-of-staff-digest.ts`)
- `lib/executors/`: 1 (`generate-purchase-order.ts`)
- `lib/tools/`: 3 (`batch_approve_briefings.ts`, `dismiss_all_briefings.ts`, `summarize_inbox.ts`)
- `scripts/`: 6 (`research-analyst.ts`, `chief-of-staff-digest.ts`, `fulfillment-ops-test.ts`, `backfill-embeddings.ts`, `fda-smoke.ts`, `keepa-token-probe.ts`)

**NEW migrations (2):** digest enum-add + pending_purchase_orders.

**NEW skill prompt (1):** `minicrew-config/skills/chief-of-staff-digest.md`.

**NEW committed fixture files (~13):**
- `vendor/edi-fixtures/`: 5 × 832 + 1 × 856 + 1 × parsed JSON = 7
- `vendor/keepa-fixtures/`: 3
- `vendor/fda-fixtures/`: 2
- `vendor/sp-api-fixtures/notification-order-change.json`: 1

**Grand total NEW (code + skill + fixtures):** ~33 + 1 + 13 = **~47 files** (vs the prior "~22" estimate, which counted only code files and excluded fixtures/skill/migrations).

**MODIFIED files (~12):**
- `lib/memory/write.ts` (Voyage embed call)
- `lib/executors/index.ts` (register `generate_purchase_order`)
- `lib/tools/index.ts` (register 3 new tools)
- `lib/system-prompt.ts` (chat-tool descriptions)
- `lib/llm-pricing.ts` (no entries needed but listed for completeness; may stay untouched)
- `lib/supabase/types.ts` (regenerated after migrations)
- `app/api/actions/approve/route.ts` (Phase H refactor — call `approveOne()`)
- `app/api/sp-api/webhook/route.ts` (Wave 2 webhook + 2 new ORDER cases)
- `components/inbox/timeline.tsx` (agentLabel +1 case)
- `components/inbox/briefing-card.tsx` (extend isReportOnly disjunct)
- `package.json` (add `node-x12`, 6 new scripts)
- `render.yaml` (2 cron services + 6 envVar entries)
- `.env.example` (6 new vars)

Net code addition ~1100–1450 LOC excluding fixtures and skill files; ~1350–1700 LOC including them.

---

## Reconciliation Notes

Imported from dossiers:
- **openFDA** is keyless on the default 1k/day/IP path; `FDA_API_KEY` (free at open.fda.gov/apis/authentication) raises to 120k/day. Use the keyless path by default; set the key in `.env` for local debugging if needed.
- **Keepa** uses a single `key=` query parameter; token-bucket model with `tokensLeft` in response body. Use `update=2` (cache hint) on `/product` calls to avoid burning tokens on stable data.
- **Keepa `/deal`** is the cheapest opportunity-discovery path (5 tokens/page; up to 150 deals per page). Research Analyst calls `/deal` once per run with category filter Health & Household, drop range 10–100%, in-stock only.
- **EzriRx** has no real-time inventory (no 846); we reframe Fulfillment Ops as "most-recent-832 cross-source comparison". Snapshots come from nightly 832 pushes. No real-time path. Document explicit timestamps on each row.
- **`node-x12`** is the chosen EDI parser; `edi-parser` is abandoned. Path-based query syntax (`parser.query("ST/LIN[1]/N4")`) covers all our parse needs.
- **Voyage `voyage-4-lite`** is 1024-dim by default → drops into existing `vector(1024)` column with no migration. Free at our scale (200M tokens/account/month allowance on voyage-4-lite covers our ~600K tokens/mo). Listed paid price $0.02/M tokens applies only after exhausting the free tier.
- **HMAC verification** on the SP-API webhook is already in place from Wave 2 (`SP_API_WEBHOOK_SECRET`). New `ORDER_CHANGE` cases inherit the same gate.
- **Order envelope shape** (per `tmp/research/2026-05-04-sp-api-comprehensive.md` §5 — Notifications API): `Payload.OrderChangeNotification.{SellerId, AmazonOrderId, OrderStatus, MarketplaceId, PurchaseDate, ItemSummaries[]}`. Fulfillment Ops extracts `AmazonOrderId` and per-item `ASIN` + `Quantity`.

Dropped from dossiers (low value at this scope):
- Google Trends (deferred to Phase 2.5 per locked decision 6).
- Voyage SDK (`voyageai` npm package) — bare `fetch()` is one function and removes a dependency.
- Keepa subscriptions for product webhook tracking (Repricer's job; out of scope here).
- EzriRx AS2 transport (defer to post-Wave-3; SFTP is sufficient).
- DSCSA T3 lot/expiry parsing on 856 (not load-bearing for fulfillment routing; flag as Phase 3 compliance work).
- openFDA NDC + Drug Label endpoints (used for catalog enrichment; out of Wave 3 scope).

Conflicts surfaced:
- Brief said "lib/memory/embed.ts" — we resolve to `lib/voyage/embed.ts` for symmetry with other `lib/<vendor>/` clients. Noted as Open Question 1.
- Brief said "extend chief-of-staff.md skill prompt" — that file does not exist. The "upgrade" is the digest agent (which DOES need its own skill file, authored here) plus chat tools (which do NOT need a skill file — `lib/system-prompt.ts` is the chat persona).
- Brief listed "agentLabel() mapping for fulfillment_ops, research_analyst, chief_of_staff_digest" — first two are already mapped (Wave 1 was prospective). Only `chief_of_staff_digest` is new.

Non-goals preserved:
- No SQS-polling worker (Wave 4 / post-launch).
- No real EDI 850 send (executor stays stubbed).
- No automated tests (manual click-through pattern carried).
- No Google Trends.
- No reranker (Voyage `rerank-2.5-lite`) — defer to Phase 2.5.
- No coupling to minicrew.
- No RLS changes.

---

## Delta Design

### Migrations

**`supabase/migrations/20260504000004_wave3_digest_enum.sql`** (single ALTER TYPE — must be its own file per Postgres limitation):

```sql
-- Add 'digest' to briefing_type enum for Chief of Staff Digest agent.
-- Postgres forbids ALTER TYPE ADD VALUE inside a transaction with other DDL,
-- so this is a standalone migration applied before the structural one below.
alter type briefing_type add value if not exists 'digest';
```

**`supabase/migrations/20260504000005_wave3_pending_purchase_orders.sql`**:

```sql
-- Phase 2 Wave 3 — pending_purchase_orders table for Fulfillment Ops's generate_purchase_order executor.
-- Mirrors pending_listings shape (id, pharmacy_id, FK, proposed_*, status, audit_log_id FK, edi_*_id, applied_at, cancelled_at, created_at).
-- Wholesaler-specific fields: wholesaler text, proposed_unit_price numeric, proposed_quantity int.
-- Status: pending → applied → cancelled. 'applied' = real EDI 850 sent (post-launch swap).

-- FK ON DELETE behavior: cascade for all three (pharmacy_id, order_id, product_id) — matches
-- the pending_listings precedent at supabase/migrations/20260501000001_pending_listings_and_system_spend.sql:8-9
-- (both `on delete cascade`). Same rationale: a deleted product/pharmacy/order means the pending PO is
-- meaningless. order_id and product_id are nullable (no `not null`) because the listing-agent precedent
-- shows that occasionally we may insert before either is fully resolved; pharmacy_id stays NOT NULL because
-- it's always known.
create table pending_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  wholesaler text not null,
  proposed_unit_price numeric(10,2) not null,
  proposed_quantity integer not null check (proposed_quantity > 0),
  proposed_eta date,
  reasoning text,
  status text not null check (status in ('pending', 'applied', 'cancelled')) default 'pending',
  audit_log_id uuid references audit_log(id),
  edi_850_envelope_id text,                       -- null while stubbed; populated when real EDI 850 send lands
  edi_855_acknowledgment_id text,                 -- post-send acknowledgment correlation id
  applied_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index pending_purchase_orders_pharmacy_status_idx on pending_purchase_orders (pharmacy_id, status, created_at desc);
create index pending_purchase_orders_order_idx on pending_purchase_orders (order_id) where order_id is not null;
```

### `lib/voyage/embed.ts` (cred-gated; ~30 LOC)

```ts
// Voyage AI embeddings helper. Cred-gated: returns null when VOYAGE_API_KEY missing.
// Single-call surface used by lib/memory/write.ts (per-insert) and
// scripts/backfill-embeddings.ts (batch backfill).
//
// Picked: voyage-4-lite (1024-dim) — drops into existing memory.embedding vector(1024).
// Cost: Free at our scale (200M tokens/account/month allowance on voyage-4-lite covers our ~600K tokens/mo).
// Listed paid price $0.02/M tokens applies only after exhausting the free tier.
// See tmp/research/2026-05-04-voyage-embeddings.md §6 + model table.

const VOYAGE_API_BASE = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-4-lite';

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
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: inputs,
        model: VOYAGE_MODEL,
        input_type: 'document',
        truncation: true,
      }),
    });
    if (!res.ok) {
      console.warn(`[voyage] embed failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const body = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
    // Voyage returns by index; sort to ensure order matches input order.
    return body.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
  } catch (err) {
    console.warn('[voyage] embed exception:', err instanceof Error ? err.message : err);
    return null;
  }
}

export const VOYAGE_EMBEDDING_MODEL = VOYAGE_MODEL;
```

### `lib/memory/write.ts` modification

```ts
// (existing imports + WriteMemoryArgs unchanged)
import { embed, VOYAGE_EMBEDDING_MODEL } from '@/lib/voyage/embed';

export async function writeMemory(
  supabase: SupabaseClient<Database>,
  args: WriteMemoryArgs,
): Promise<{ id: string; inserted: boolean }> {
  // ... existing idempotence check + INSERT ... yields { id, inserted: true | false }
  const result = await coreInsert(/*existing logic*/);

  if (result.inserted) {
    const vectors = await embed(args.content);
    if (vectors && vectors[0]) {
      // pgvector over PostgREST accepts the bracketed-string form '[0.1,0.2,...]'.
      // Supabase's generated types treat the column as `string | null`, so we serialize
      // the number[] explicitly. Direct array assignment fails type-checking AND occasionally
      // serializes wrong on the wire (Postgres rejects with "malformed array literal").
      const vectorLiteral = '[' + vectors[0].join(',') + ']';
      const { error: embedErr } = await supabase
        .from('memory')
        .update({ embedding: vectorLiteral as any, embedding_model: VOYAGE_EMBEDDING_MODEL })
        .eq('id', result.id);
      if (embedErr) console.warn(`[memory.write] embed update failed for ${result.id}: ${embedErr.message}`);
    }
    // If embed returns null (no creds), pg_trgm fallback covers retrieval.
  }
  return result;
}
```

(Note: `embedding` column in `memory` is `vector(1024)`; `pgvector` accepts the bracketed-string form `'[0.1,0.2,...]'` over PostgREST. Same pattern applies in `scripts/backfill-embeddings.ts` for batch updates.)

### `lib/edi/index.ts` — wholesaler catalog facade (cred-gated)

```ts
// Surfaces normalized wholesaler-catalog rows: { wholesaler, ndc, unit_price, stock, eta, captured_at }.
// Cred-gated by EZRIRX_SFTP_HOST presence. Real mode polls SFTP for latest 832 envelopes;
// fixture mode loads vendor/edi-fixtures/wholesaler-832-*.edi files and parses via node-x12.

import { getRealCatalogClient } from './_real';
import { getFixtureCatalogClient } from './_fixtures';

export type WholesalerSnapshot = {
  wholesaler: 'abc' | 'mckesson' | 'cardinal' | 'parmed' | 'ezrirx';
  ndc: string;
  product_name: string;
  unit_price: number;
  pack_size: string;
  stock_qty: number;             // best-effort from 832 (no 846 — see dossier §1.2)
  eta_days: number;              // wholesaler-typical lead time
  captured_at: string;           // ISO timestamp from 832 BCT segment
};

export interface CatalogClient {
  getSnapshotsForNdcs(ndcs: string[]): Promise<WholesalerSnapshot[]>;
}

const credsPresent = (): boolean =>
  !!process.env.EZRIRX_SFTP_HOST &&
  !!process.env.EZRIRX_SFTP_USER &&
  !!process.env.EZRIRX_SFTP_KEY;

export const getWholesalerCatalogClient = (): CatalogClient =>
  credsPresent() ? getRealCatalogClient() : getFixtureCatalogClient();
```

`lib/edi/_fixtures.ts` reads each `vendor/edi-fixtures/wholesaler-832-*.edi`, parses via node-x12, returns merged WholesalerSnapshot[]. Filters by `ndcs[]` argument. Fixture data covers the 5 default seeded products (Omega-3, Magnesium, Tinactin, etc.) at ~5 different prices per wholesaler with synthesized stock 50–500 units.

`lib/edi/_real.ts` (Phase 2 fixture mode is what actually runs — real mode is post-launch swap; the file exists and throws "not implemented" with a clear message that points to the EzriRx onboarding doc).

### `lib/fda/client.ts`

```ts
const FDA_BASE = 'https://api.fda.gov';

export async function fdaFetch<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(FDA_BASE + path);
  if (process.env.FDA_API_KEY) params.api_key = process.env.FDA_API_KEY;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  let attempt = 0;
  while (true) {
    const res = await fetch(url.toString());
    if (res.ok) return await res.json() as T;
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 3) throw new Error(`openFDA ${path} ${res.status} after 3 retries`);
      await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
      attempt++;
      continue;
    }
    if (res.status === 404) {
      // openFDA returns 404 when there are no results (intentional). Caller treats as empty.
      return { meta: {}, results: [] } as unknown as T;
    }
    throw new Error(`openFDA ${path} ${res.status}: ${await res.text()}`);
  }
}
```

`lib/fda/shortage.ts` — `getActiveOtcShortages(limit=50)` returns `FdaShortageRecord[]` filtered to `status:"Currently in Shortage"` AND `openfda.product_type:"HUMAN OTC DRUG"`, sorted by `update_date:desc`.

`lib/fda/recall.ts` — `getRecentDrugRecalls({since: ISO-date, limit=50})` returns Class I or II recalls in the last N days. Drug-only filter (`product_type:Drugs`).

### `lib/keepa/client.ts`

Fetch wrapper. Reads `tokensLeft` from response body; refuses to call when `tokensLeft < 5`; on 429, sleeps `refillIn` ms and retries once. Single-process token cache; logs to console when token balance < 50 for visibility.

`lib/keepa/deal.ts` — `getRecentDeals({categories=[3760931 /*Health & Household*/], dateRange=1, limit=20})` returns top 20 deals.

`lib/keepa/product.ts` — `getProduct(asin, opts={ stats: 90, history: 0, update: 24 })` — used by Research Analyst to enrich top picks with Buy Box / FBA-stockout status.

`lib/keepa/_fixtures.ts` — fixture-mode equivalents reading from `vendor/keepa-fixtures/`.

### `lib/agents/research-analyst.ts` (excerpt — single-pass)

```ts
import { z } from 'zod';
import { openrouter } from '@/lib/llm';
import { recordLLMUsage } from '@/lib/budget';
import { AGENT_MODEL, DEFAULT_PHARMACY_ID, callAgentLLM, dailyBudgetGate, loadSkillPrompt, stripJsonFence } from './_shared';
import { getActiveOtcShortages } from '@/lib/fda/shortage';
import { getRecentDrugRecalls } from '@/lib/fda/recall';
import { getKeepaClient } from '@/lib/keepa';

const Output = z.object({
  picks: z.array(z.object({
    product_id: z.string().uuid().nullable(),    // null if not in our products table yet
    candidate_name: z.string(),
    ndc: z.string().nullable(),
    asin: z.string().nullable(),
    score: z.number().min(0).max(100),
    confidence: z.number().min(0).max(1),
    urgency: z.number().int().min(1).max(5),
    rationale: z.string(),
    signals: z.array(z.string()),                  // e.g. ['fda_shortage:acetaminophen', 'keepa_buybox_drop:30%']
  })).min(0).max(10),
});

export async function runResearchAnalyst(supabase: SupabaseClient<Database>, opts: { pharmacyId?: string } = {}) {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;
  const gate = await dailyBudgetGate(supabase, 'research-analyst');
  if (gate.capped) return { proposed: 0, capped: true };

  // 1. Pull external signals
  const [shortages, recalls, deals] = await Promise.all([
    getActiveOtcShortages(50).catch(err => { console.warn('[research-analyst] FDA shortage failed:', err); return []; }),
    getRecentDrugRecalls({ since: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) }).catch(err => { console.warn('[research-analyst] FDA recall failed:', err); return []; }),
    getKeepaClient().getRecentDeals({ dateRange: 1 }).catch(err => { console.warn('[research-analyst] Keepa deals failed:', err); return []; }),
  ]);

  // 2. Pull internal context
  const { data: watchingProducts } = await supabase
    .from('products')
    .select('id, name, ndc, brand, watchlist_status, asin')
    .eq('pharmacy_id', pharmacyId)
    .in('watchlist_status', ['watching', 'evaluating'])
    .limit(100);

  const { data: prefMem } = await supabase
    .from('memory')
    .select('content, metadata')
    .eq('pharmacy_id', pharmacyId)
    .eq('kind', 'preferences')
    .eq('source', 'kaleem')
    .limit(1)
    .maybeSingle();

  // 3. Single-pass LLM call (NO 8-fanout — locked decision)
  const skill = await loadSkillPrompt('research-analyst');
  const skillNoWebSearch = skill + '\n\n## Wave 3 runtime override\n- Step 5 (LLM web search): SKIP. Wave 3 single-pass mode does not call WebSearch. Score from signals + watching list only.';
  const completion = await callAgentLLM(openrouter, {
    model: AGENT_MODEL,
    reasoningEffort: 'medium',
    systemPrompt: skillNoWebSearch,
    userPayload: { shortages: shortages.slice(0, 25), recalls: recalls.slice(0, 25), keepa_deals: deals.slice(0, 50), watching_products: watchingProducts ?? [], preferences: prefMem?.metadata ?? {} },
  });
  await recordLLMUsage(supabase, null, completion);

  const parsed = Output.parse(JSON.parse(stripJsonFence(completion.choices[0]?.message?.content ?? '{}')));

  // 3a. Post-parse validation: LLM occasionally emits a uuid not in our watching_products set.
  // Drop it to null so the briefing falls through to the "no internal product row yet" branch
  // (Acknowledge-only) instead of failing on the executor's UUID FK validation downstream.
  const watchingIds = new Set((watchingProducts ?? []).map(p => p.id));
  for (const pick of parsed.picks) {
    if (pick.product_id && !watchingIds.has(pick.product_id)) {
      console.warn(`[research-analyst] LLM emitted unknown product_id ${pick.product_id}; setting null`);
      pick.product_id = null;
    }
  }

  // 4. Per-pick: insert briefing + inbox row
  const briefingIds: string[] = [];
  for (const pick of parsed.picks) {
    // Map signals into briefing_type (FDA-shortage signals → rx_shortage_adjacency; recalls → fda_recall_triggered; otherwise → new_opportunity)
    const briefingType = pick.signals.some(s => s.startsWith('fda_shortage')) ? 'rx_shortage_adjacency'
      : pick.signals.some(s => s.startsWith('fda_recall')) ? 'fda_recall_triggered'
      : 'new_opportunity';

    const proposedActions = pick.product_id
      ? [
          // Wave 1's add_to_watchlist executor requires { product_ids: string[], reason: string } (Zod-validated;
          // see lib/executors/add-to-watchlist.ts:10-13). Plural form. Singular is a bug.
          { kind: 'add_to_watchlist', variant: 'primary', label: 'Add to watchlist', params: { product_ids: [pick.product_id], reason: pick.rationale.slice(0, 500) } },
          { kind: 'dismiss_briefing', label: 'Skip', params: {} },
        ]
      : [
          { kind: 'dismiss_briefing', label: 'Acknowledge', params: {} },        // pick has no internal product row yet → no actionable executor
        ];

    const { data: briefing } = await supabase
      .from('briefings')
      .insert({
        pharmacy_id: pharmacyId,
        source_agent: 'research_analyst',
        briefing_type: briefingType,
        title: `${pick.candidate_name}: score ${pick.score}/100`,
        summary: pick.rationale.slice(0, 240),
        rationale: pick.rationale,
        confidence: pick.confidence,
        urgency: pick.urgency,
        related_entity_type: pick.product_id ? 'products' : null,
        related_entity_id: pick.product_id,
        proposed_actions: proposedActions as any,
        data_snapshot: { kind: 'research_pick', pick, signals_used: pick.signals } as any,
      })
      .select('id')
      .single();
    if (briefing) {
      briefingIds.push(briefing.id);
      await supabase.from('inbox_items').insert({ pharmacy_id: pharmacyId, briefing_id: briefing.id, state: 'pending' });
    }
  }

  return { proposed: briefingIds.length, briefing_ids: briefingIds, capped: false };
}
```

### `lib/agents/fulfillment-ops.ts` (excerpt — webhook-driven)

```ts
// runFulfillmentOps: invoked from app/api/sp-api/webhook/route.ts switch case ORDER_CHANGE/ORDER_STATUS_CHANGE.
// 1. Upsert order from envelope. 2. Pull product. 3. getWholesalerCatalogClient().getSnapshotsForNdcs([product.ndc]).
// 4. Apply policy filter (Tier 0 from policy_rules). 5. Compute margin per candidate.
// 6. Single-pass LLM call (skill prompt + payload) → ranked candidates.
// 7. Insert briefing with briefing_type='order_to_fulfill', source_agent='fulfillment_ops',
//    proposed_actions = [{kind:'generate_purchase_order', variant:'primary', label:'PO from <wholesaler>',
//                        params:{order_id, wholesaler, unit_price, quantity}}, ...one per viable candidate...,
//                        {kind:'dismiss_briefing', label:'Skip — handle manually'}].
// 8. urgency=5 (orders are time-critical).

// Signature matches Wave 2 webhook-driven agent convention: takes `trigger` discriminator so the
// agent can log its invocation source (webhook vs manual-test). See lib/agents/customer-success.ts
// (Wave 2) for the precedent.
export async function runFulfillmentOps(
  supabase: SupabaseClient<Database>,
  { trigger, event }: { trigger: 'webhook' | 'manual-test'; event: NotificationEnvelope },
) {
  const orderEnv = event.Payload as { OrderChangeNotification: { AmazonOrderId: string; OrderStatus: string; ItemSummaries: Array<{ ASIN: string; Quantity: number; }>; PurchaseDate: string; MarketplaceId: string; } };
  const change = orderEnv.OrderChangeNotification;

  // 1. Upsert order (idempotent on (platform, platform_order_id))
  const { data: order } = await supabase
    .from('orders')
    // Keep canonical SP-API OrderStatus casing (Pending, Unshipped, PartiallyShipped, Shipped,
    // Canceled, Unfulfillable). Wave 2 convention (lib/sp-api/types.ts) preserves SP-API casing
    // verbatim — do not .toLowerCase(). The orders.status column is plain text; downstream readers
    // (Bookkeeper, Inbox) compare case-sensitively against the SP-API literal set.
    .upsert({ pharmacy_id: DEFAULT_PHARMACY_ID, platform: 'amazon', platform_order_id: change.AmazonOrderId, status: change.OrderStatus, sold_at: change.PurchaseDate }, { onConflict: 'platform,platform_order_id' })
    .select('id')
    .single();

  // Per-item fan-out cap: bulk orders (>10 items) get truncated to first 10. Reason:
  // bound LLM cost (each item triggers one Sonnet call). Kaleem's average OTC order is 1-3 items;
  // bulk orders are rare and would be flagged for manual handling anyway.
  let items = change.ItemSummaries;
  if (items.length > 10) {
    console.warn(`[fulfillment-ops] order ${change.AmazonOrderId} has ${items.length} items; processing first 10`);
    items = items.slice(0, 10);
  }

  // For each item summary, run a fulfillment briefing:
  for (const item of items) {
    const { data: product } = await supabase
      .from('products')
      .select('id, ndc, name, brand, asin')
      .eq('pharmacy_id', DEFAULT_PHARMACY_ID)
      .eq('asin', item.ASIN)
      .maybeSingle();
    if (!product?.ndc) continue; // can't query wholesalers without NDC; skip

    const snapshots = await getWholesalerCatalogClient().getSnapshotsForNdcs([product.ndc]);

    // 2. Policy filter — Wave 3 stub. Wholesalers are not Tier 0 filtered (Tier 0 is
    // a product-level concept already enforced upstream at listing time). The function
    // is a passthrough that logs which wholesalers it sees, leaving room for Wave 4 to
    // add real wholesaler-level rules (e.g. "skip Parmed for controlled substances").
    const filtered = applyPolicyFilter(snapshots, /* policy rows from supabase.from('policy_rules')... */);
    // applyPolicyFilter signature (defined inline in this module):
    //   function applyPolicyFilter(snapshots: WholesalerSnapshot[], _policyRows: PolicyRule[]): WholesalerSnapshot[] {
    //     console.log(`[fulfillment-ops] policy filter (Wave 3 stub): ${snapshots.length} → ${snapshots.length} (passthrough); ` +
    //                 `wholesalers seen: ${snapshots.map(s => s.wholesaler).join(',')}`);
    //     return snapshots;
    //   }
    // TODO Wave 4: enforce wholesaler-level rules from policy_rules where target_type='wholesaler'.

    // 3. Single-pass LLM call: rank candidates + emit reasoning
    const skill = await loadSkillPrompt('fulfillment-ops');
    const completion = await callAgentLLM(openrouter, {
      model: AGENT_MODEL,
      reasoningEffort: 'medium',
      systemPrompt: skill,
      userPayload: { order_id: order.id, product, quantity: item.Quantity, wholesaler_snapshots: filtered },
    });
    await recordLLMUsage(supabase, null, completion);
    const parsed = FulfillmentOutput.parse(JSON.parse(stripJsonFence(completion.choices[0]?.message?.content ?? '{}')));

    const proposedActions = parsed.candidates.map(c => ({
      kind: 'generate_purchase_order',
      variant: c.recommended ? 'primary' : 'secondary',
      label: `PO from ${c.wholesaler} @ $${c.unit_price.toFixed(2)}`,
      params: { order_id: order.id, product_id: product.id, wholesaler: c.wholesaler, proposed_unit_price: c.unit_price, proposed_quantity: item.Quantity, proposed_eta: c.eta },
    }));
    proposedActions.push({ kind: 'dismiss_briefing', label: 'Skip — handle manually', params: {} });
    // Note: dismiss_briefing IS a real Wave 1 executor (lib/executors/dismiss-briefing.ts) — a thin no-op.
    // Forward returns {dismissed:true}; reverse returns {restored:true}. Empty params; no `briefing_id: '_self'`
    // magic string. The Reject button on briefing-card.tsx ALSO routes to /api/actions/reject (no executor)
    // and dismisses the inbox_item directly — both paths are valid; the Skip pseudo-action exists when we want
    // an explicit "Skip" button alongside other primary actions instead of the bottom-row Reject button.

    await supabase.from('briefings').insert({/* briefing_type: 'order_to_fulfill', urgency: 5, ...*/});
  }
}
```

### `lib/agents/chief-of-staff-digest.ts` (excerpt)

```ts
// Runs daily 7am UTC. Reads briefings + inbox_items from last 24h, summarizes per-agent counts and key takeaways.
// Output: ONE briefing with briefing_type='digest', source_agent='chief_of_staff_digest', proposed_actions=[].

export async function runChiefOfStaffDigest(supabase, opts: { pharmacyId?: string } = {}) {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;
  const gate = await dailyBudgetGate(supabase, 'chief-of-staff-digest');
  if (gate.capped) return { capped: true };

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: briefings } = await supabase
    .from('briefings')
    .select('id, source_agent, briefing_type, title, summary, urgency, confidence, created_at')
    .eq('pharmacy_id', pharmacyId)
    .neq('source_agent', 'chief_of_staff_digest')         // exclude prior digests (open question 3 default)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);

  // Empty-window short-circuit: nothing to summarize. Skip LLM call + briefing write.
  if (!briefings || briefings.length === 0) {
    console.log('[digest] no activity in last 24h; skipping');
    return { skipped: true, briefing_id: null, capped: false };
  }

  // Aggregate per-agent counts + top-urgency briefings
  const byAgent: Record<string, { count: number; top: any[] }> = {};
  for (const b of briefings ?? []) {
    if (!byAgent[b.source_agent]) byAgent[b.source_agent] = { count: 0, top: [] };
    byAgent[b.source_agent].count++;
    if ((b.urgency ?? 0) >= 4) byAgent[b.source_agent].top.push(b);
  }

  // Single LLM summarize call
  const skill = await loadSkillPrompt('chief-of-staff-digest');
  const completion = await callAgentLLM(openrouter, {
    model: AGENT_MODEL,
    reasoningEffort: 'low',
    systemPrompt: skill,
    userPayload: { window_hours: 24, briefings: briefings?.slice(0, 50) ?? [], by_agent: byAgent },
  });
  await recordLLMUsage(supabase, null, completion);
  const parsed = DigestOutput.parse(JSON.parse(stripJsonFence(completion.choices[0]?.message?.content ?? '{}')));

  const { data: digestBriefing } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: pharmacyId,
      source_agent: 'chief_of_staff_digest',
      briefing_type: 'digest',
      title: parsed.title,
      summary: parsed.summary,
      rationale: parsed.takeaways.join('\n'),
      confidence: 1,
      urgency: 2,
      proposed_actions: [] as any,
      data_snapshot: { kind: 'daily_digest', window_hours: 24, by_agent: byAgent, takeaways: parsed.takeaways },
    })
    .select('id')
    .single();
  if (digestBriefing) {
    await supabase.from('inbox_items').insert({ pharmacy_id: pharmacyId, briefing_id: digestBriefing.id, state: 'pending' });
  }
  return { briefing_id: digestBriefing?.id, capped: false };
}
```

### `lib/executors/generate-purchase-order.ts`

```ts
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const Params = z.object({
  order_id: z.string().uuid(),
  product_id: z.string().uuid(),
  wholesaler: z.enum(['abc', 'mckesson', 'cardinal', 'parmed', 'ezrirx']),
  proposed_unit_price: z.number().positive(),
  proposed_quantity: z.number().int().positive(),
  proposed_eta: z.string().nullable().optional(),
  reasoning: z.string().max(2000).optional(),
});

export const generatePurchaseOrder: Executor = {
  kind: 'generate_purchase_order',
  async forward(params, ctx): Promise<ExecutorResult> {
    const v = Params.parse(params);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('pending_purchase_orders')
      .insert({
        pharmacy_id: ctx.pharmacyId,
        order_id: v.order_id,
        product_id: v.product_id,
        wholesaler: v.wholesaler,
        proposed_unit_price: v.proposed_unit_price,
        proposed_quantity: v.proposed_quantity,
        proposed_eta: v.proposed_eta ?? null,
        reasoning: v.reasoning ?? null,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`generate_purchase_order.forward: ${error?.message}`);
    console.log(`[STUB] would generate PO PDF and send EDI 850 to ${v.wholesaler} for product ${v.product_id} (qty ${v.proposed_quantity} @ $${v.proposed_unit_price})`);
    return { pending_purchase_order_id: data.id };
  },
  async reverse(_params, forwardResult): Promise<ExecutorResult> {
    const id = forwardResult.pending_purchase_order_id;
    if (typeof id !== 'string') return { reverted: false, reason: 'missing pending_purchase_order_id' };
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('pending_purchase_orders')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`generate_purchase_order.reverse: ${error.message}`);
    console.log(`[STUB] would send EDI 860 PO Change Request to wholesaler for cancellation`);
    return { reverted: true, pending_purchase_order_id: id };
  },
};
```

### Chat tools

**`lib/tools/batch_approve_briefings.ts`** — handler queries `inbox_items` joined with briefings, filters by source_agent / briefing_type / explicit IDs, then for each match calls `approveOne(supabase, inbox_item_id, action_index, ctx)` from `lib/kernel/approve.ts` (the Phase H extraction; same function used by `app/api/actions/approve/route.ts`). Returns JSON: `{approved: N, failed: M, audit_log_ids: [...]}`. Maximum batch size 50; clamp to avoid runaway.

```ts
// (excerpt)
const Input = z.object({
  source_agent: z.string().optional(),
  briefing_type: z.string().optional(),
  briefing_ids: z.array(z.string().uuid()).optional(),
  max: z.number().int().min(1).max(50).default(20),
  action_index: z.number().int().min(0).max(20).default(0),    // most briefings have action[0]=primary
});
// returns JSON.stringify({approved, failed, errors[], audit_log_ids[]})
```

**`lib/tools/dismiss_all_briefings.ts`** — same shape; loops through `inbox_items.update({state: 'dismissed'})` with no executor call.

**`lib/tools/summarize_inbox.ts`** — read-only. Returns `{by_agent: {bookkeeper: {count, top_urgency, examples}, ...}}`.

### Webhook route additions

```ts
// app/api/sp-api/webhook/route.ts — switch additions
case 'ORDER_CHANGE':
case 'ORDER_STATUS_CHANGE':
  await runFulfillmentOps(supabase, { event: env });
  break;
```

### Skill: `minicrew-config/skills/chief-of-staff-digest.md` (~80 lines)

```markdown
# Chief of Staff Daily Digest Skill

You are the Daily Digest writer for Kaleem's pharmacy automation. Your job runs once per day at 7am UTC. You read the last 24 hours of briefings from all 8 specialist agents and produce ONE concise digest briefing.

## Inputs
- `window_hours` — always 24
- `briefings` — array of last-24h briefings (id, source_agent, briefing_type, title, summary, urgency, confidence, created_at)
- `by_agent` — pre-computed { agent_name: { count, top: [high-urgency briefings] } }

## Your output (JSON, no fences, no commentary)
{
  "title": "Daily digest — <date>: <N> briefings across <M> agents",
  "summary": "One paragraph (≤300 chars). Lead with what's most urgent.",
  "takeaways": ["bullet 1", "bullet 2", "bullet 3", ...]
}

## Constraints
- 3–6 takeaways. One per agent if that agent had activity.
- Lead each takeaway with the agent name in brackets, e.g. "[Repricer] 2 propose-down decisions on Tinactin and Magnesium".
- High-urgency items (urgency ≥ 4) MUST be surfaced.
- No emoji.
- No proposed actions — Kaleem dismisses or replies in chat.

## Tool access: none. Single-pass LLM call.
```

### `.env.example` additions

```
# --- Wave 3: Voyage AI embeddings (Phase 1.5 fold-in) ---
# When unset, lib/voyage/embed.ts returns null and pg_trgm fallback covers retrieval.
VOYAGE_API_KEY=

# --- Wave 3: openFDA (free; key optional — raises rate limit from 1k/day to 120k/day) ---
FDA_API_KEY=

# --- Wave 3: Keepa ---
# When unset, lib/keepa/index.ts returns the fixture client.
KEEPA_API_KEY=

# --- Wave 3: EzriRx EDI ---
# When all three are unset, lib/edi/index.ts returns the fixture client (vendor/edi-fixtures).
EZRIRX_SFTP_HOST=
EZRIRX_SFTP_USER=
EZRIRX_SFTP_KEY=
```

### `render.yaml` — 2 new cron services + 6 new env vars

```yaml
  # --- Research Analyst (Phase 2 Wave 3 — daily 6:15am UTC; staggered after Account Health) ---
  - type: cron
    name: pharm1-research-analyst
    runtime: node
    plan: starter
    region: oregon
    buildCommand: npm ci
    schedule: "15 6 * * *"
    startCommand: npm run agent:research-analyst
    envVars:
      - fromGroup: pharm1-shared

  # --- Chief of Staff Digest (Phase 2 Wave 3 — daily 7am UTC; 45 min after Research Analyst) ---
  - type: cron
    name: pharm1-chief-of-staff-digest
    runtime: node
    plan: starter
    region: oregon
    buildCommand: npm ci
    schedule: "0 7 * * *"
    startCommand: npm run agent:chief-of-staff-digest
    envVars:
      - fromGroup: pharm1-shared

# --- envVarGroup additions ---
envVarGroups:
  - name: pharm1-shared
    envVars:
      # ... existing 30 vars from Waves 1+2 ...
      - key: VOYAGE_API_KEY
        sync: false
      - key: FDA_API_KEY
        sync: false
      - key: KEEPA_API_KEY
        sync: false
      - key: EZRIRX_SFTP_HOST
        sync: false
      - key: EZRIRX_SFTP_USER
        sync: false
      - key: EZRIRX_SFTP_KEY
        sync: false
```

### `package.json` additions

```jsonc
"scripts": {
  // ... existing ...
  "agent:research-analyst": "tsx scripts/research-analyst.ts",
  "agent:chief-of-staff-digest": "tsx scripts/chief-of-staff-digest.ts",
  "agent:fulfillment-ops-test": "tsx scripts/fulfillment-ops-test.ts",
  "embeddings:backfill": "tsx scripts/backfill-embeddings.ts",
  "fda:smoke": "tsx scripts/fda-smoke.ts",
  "keepa:token": "tsx scripts/keepa-token-probe.ts"
},
"dependencies": {
  // ... existing ...
  "node-x12": "^1.7.1"
}
```

### Cron schedule layout (UTC)

| Agent / Job | Schedule | Cadence | Notes |
|---|---|---|---|
| pharm1-listing-agent | `0 13 * * *` | Daily 13:00 UTC | Wave 1 |
| pharm1-repricer | `0 14,2 * * *` | Twice-daily 14:00 + 02:00 UTC | Wave 2 |
| pharm1-account-health | `0 6 * * *` | Daily 06:00 UTC | Wave 2 |
| **pharm1-research-analyst** | `15 6 * * *` | Daily 06:15 UTC (15 min after Account Health) | NEW Wave 3 |
| **pharm1-chief-of-staff-digest** | `0 7 * * *` | Daily 07:00 UTC | NEW Wave 3 |
| pharm1-bookkeeper | `0 23 * * *` | Daily 23:00 UTC | Wave 1 |
| pharm1-portfolio-manager | `0 7 * * 0` | Sun 07:00 UTC | Wave 1 — collides with new digest cron on Sundays only. **Render cron services are independent workers that run concurrently, not serially.** Both write to `briefings` / `inbox_items` / `memory` independently with no shared in-process state, and Postgres handles the row-level write contention. No collision. **If contention emerges in practice (e.g. they both contend for the daily-spend-cap row), stagger digest to `5 7 * * *` (07:05 UTC).** |
| pharm1-reflector | `30 23 * * 0` | Sun 23:30 UTC | Wave 1 |
| pharm1-backup-weekly | `0 9 * * 0` | Sun 09:00 UTC | Phase 1 |
| pharm1-backup-restore-test | `0 10 1 * *` | 1st-of-month 10:00 UTC | Phase 1 |

Sunday 7am collision: `pharm1-portfolio-manager` (Wave 1) and `pharm1-chief-of-staff-digest` (Wave 3) both run at 07:00 UTC. Render cron services run as independent concurrent workers (not serially), so they execute in parallel. Both write to memory / briefings / inbox_items independently; Postgres row-level locking handles any incidental contention. Acceptable. **If a future agent adds Sunday 07:00 contention or if we observe collisions on the daily-spend-cap row, shift digest to 07:05 UTC.**

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Render Cron:                Render Cron:                Render Cron:          │
│ pharm1-research-analyst     pharm1-chief-of-staff-digest pharm1-account-health│
│ daily 06:15 UTC             daily 07:00 UTC             daily 06:00 UTC      │
└────┬───────────────────────────┬─────────────────────────┬───────────────────┘
     │                           │                         │
     ▼                           ▼                         ▼
scripts/research-analyst.ts → runResearchAnalyst()
scripts/chief-of-staff-digest.ts → runChiefOfStaffDigest()
                              │
┌──────────────────────────────────────┐
│ POST /api/sp-api/webhook (Wave 2)    │  Wave 3 adds 2 NotificationType cases:
│ • ORDER_CHANGE → fulfillment_ops      │  • ORDER_CHANGE
│ • ORDER_STATUS_CHANGE → fulfillment_ops│  • ORDER_STATUS_CHANGE
└──────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ lib/agents/<name>.ts                                                          │
│  1. dailyBudgetGate                                                           │
│  2. External clients (cred-gated):                                            │
│     • Research Analyst:  lib/fda + lib/keepa                                  │
│     • Fulfillment Ops:   lib/edi (wholesaler 832 cross-source)               │
│     • CoS Digest:        no external — reads our own briefings + inbox_items │
│  3. callAgentLLM(skill, payload)                                              │
│  4. recordLLMUsage                                                             │
│  5. Zod-parse output → adapter → briefing+inbox insert                        │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Supabase: briefings + inbox_items + pending_* + audit_log + memory + orders  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ SSR
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Inbox UI (app/page.tsx → Timeline). Wave 3 agents render with proper labels:  │
│ • Fulfillment Ops:   actionable buttons per wholesaler (generate_purchase_order)│
│ • Research Analyst:  add_to_watchlist (Wave 1 executor) + Skip                │
│ • Daily Digest:      Acknowledge only (isReportOnly)                          │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Kaleem clicks Approve OR types in /chat
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Path A: POST /api/actions/approve (kernel — UNCHANGED)                       │
│   → getExecutor('generate_purchase_order' | 'add_to_watchlist').forward      │
│   → audit_log row with 30-min undo                                            │
│                                                                                │
│ Path B: POST /api/chat → tool call batch_approve_briefings({source_agent})  │
│   → tool-handler invokes shared approveOne(supabase, inbox_item_id, ...) loop │
│   → SAME executor.forward + audit_log path; same 30-min undo                  │
└──────────────────────────────────────────────────────────────────────────────┘

Memory writes (background):
┌──────────────────────────────────────────────────────────────────────────────┐
│ Reflector / Research Analyst / any agent → writeMemory(supabase, args)        │
│   → INSERT into memory                                                         │
│   → embed(content) via lib/voyage/embed.ts (cred-gated)                       │
│   → UPDATE memory SET embedding=$1, embedding_model='voyage-4-lite'         │
│   (best-effort; pg_trgm fallback covers retrieval if creds missing)           │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Tasks

Implementation order. Each task is one commit-shaped unit.

### Phase A — Cleanups
1. **Confirm working tree clean.** `git status` should show no uncommitted changes from Wave 2.
2. **Modify `.gitignore`** — append `vendor/keepa-fixtures/raw/` (only the parsed fixtures are committed; raw API responses for re-derivation stay local). The `vendor/edi-fixtures/`, `vendor/keepa-fixtures/`, and `vendor/fda-fixtures/` directories themselves ARE committed.

### Phase B — Schema migrations (sequenced)
3. **Create** `supabase/migrations/20260504000004_wave3_digest_enum.sql` (single ALTER TYPE statement — must be alone per Postgres limitation).
4. **Apply enum migration** to cloud Supabase (`rvirlhrssgnbkjqhqjao`) via Management API + curl + jq.
5. **Create** `supabase/migrations/20260504000005_wave3_pending_purchase_orders.sql` per Delta Design.
6. **Apply structural migration** to cloud Supabase.
7. **Regenerate types**: `supabase gen types typescript --local > lib/supabase/types.ts`. Commit.

### Phase C — Voyage embeddings (Phase 1.5 fold-in)
8. **Create** `lib/voyage/embed.ts` per Delta Design (~30 LOC).
9. **Modify** `lib/memory/write.ts` — call `embed()` after insert, UPDATE row with embedding + embedding_model. Best-effort (warn-and-continue on failure).
10. **Create** `scripts/backfill-embeddings.ts` — walks `memory WHERE embedding IS NULL` in batches of 100, calls `embed()` (batch up to 100 strings per call), UPDATEs each row. Idempotent.
    Error handling:
    - On embed() returning null mid-run: exit cleanly with `[backfill] Voyage creds missing; processed N rows before stop`.
    - On per-row UPDATE error: log `[backfill] row <id> update failed: <err>`; continue.
    - On embed() throwing (Voyage 5xx): catch, log batch number + first row id, sleep 5s, continue to next batch.
    - Re-run is safe (idempotent — failed rows stay NULL and get retried).
11. **Modify** `package.json` — add `embeddings:backfill` script.

### Phase D — FDA client
12. **Create** `lib/fda/client.ts`, `lib/fda/types.ts`, `lib/fda/shortage.ts`, `lib/fda/recall.ts`, `lib/fda/index.ts`.
13. **Create** `vendor/fda-fixtures/{shortage-empty.json,recall-empty.json}` (used only on 5xx).
14. **Create** `scripts/fda-smoke.ts` — calls `getActiveOtcShortages(3)` + `getRecentDrugRecalls({since: 7d ago, limit: 3})`, prints results. Verifies real fetch works.
15. **Modify** `package.json` — add `fda:smoke`.

### Phase E — Keepa client
16. **Create** `lib/keepa/client.ts` (token-bucket-aware fetch), `lib/keepa/types.ts`, `lib/keepa/deal.ts`, `lib/keepa/product.ts`, `lib/keepa/_fixtures.ts`, `lib/keepa/index.ts`.
17. **Create** `vendor/keepa-fixtures/{deal.json,product.json,token.json}` (synthesized from dossier shapes).
18. **Create** `scripts/keepa-token-probe.ts` — calls `/token`, prints `{tokensLeft, refillRate}`. Cred-gated; falls back to fixture.
19. **Modify** `package.json` — add `keepa:token`.

### Phase F — EDI client
20. **Install dependency**: `npm i node-x12`. Commit lockfile.
21. **Create** `lib/edi/x12.ts` (thin wrap of node-x12 parser).
22. **Create** `lib/edi/wholesaler-832.ts` (parse 832 → WholesalerSnapshot[] via path-based queries `ST/LIN/N4`, `ST/CTP[1]/CTP02`, `ST/PO4/PO403`).
23. **Create** `lib/edi/wholesaler-856.ts` (parse 856 → ASN shape; used by post-launch swap, fixture for now).
24. **Create** `lib/edi/_fixtures.ts` (loads `vendor/edi-fixtures/wholesaler-832-*.edi`, parses each via 832 parser, returns merged WholesalerSnapshot[]).
25. **Create** `lib/edi/_real.ts` (placeholder that throws — real SFTP poll lands post-launch swap).
26. **Create** `lib/edi/types.ts` + `lib/edi/index.ts` (cred-gated factory).
27. **Author** `vendor/edi-fixtures/wholesaler-832-{abc,mckesson,cardinal,parmed,ezrirx}.edi` (5 files, ~2KB each). **Implementer:** copy the 832 segment template (ISA/GS/ST/LIN/CTP/PO4 example) verbatim from `tmp/research/2026-05-04-ezrirx-sms.md` lines 50-160; vary unit_price per wholesaler per the rationale below. Use the dossier §1.4 shape; populate with NDCs matching the 5 seeded products from `scripts/seed-dev-data.ts` (Omega-3, Magnesium, Tinactin, etc.). Synthesize realistic prices: ABC cheapest, McKesson +5%, Cardinal +3%, Parmed +7%, EzriRx +1% — varies per product.
28. **Author** `vendor/edi-fixtures/wholesaler-856-sample.edi` (one ASN; parser test target).
29. **Author** `vendor/edi-fixtures/wholesaler-comparison-sample.json` (parsed-and-merged shape; used in tests + agent payloads).

### Phase G — New executor
30. **Create** `lib/executors/generate-purchase-order.ts` per Delta Design.
31. **Modify** `lib/executors/index.ts` — register `generate_purchase_order: generatePurchaseOrder`.

### Phase H — Kernel `approveOne()` extraction (refactor first, validate against shipped Wave 1+2 functionality, then layer new agents on top)
> **Rationale:** This refactor pulls existing approve logic out of the route into a reusable function. By doing it BEFORE the new agents land, we validate the extraction against already-shipped, click-tested briefings (Wave 1 listing-agent, Wave 2 repricer/cs/account-health). If the extraction breaks the kernel, we catch it immediately on existing fixtures rather than tangling the regression with new-agent debugging. The chat tools that consume `approveOne()` come in Phase L, after the new agents.
32. **Create** `lib/kernel/approve.ts` — exports `approveOne(supabase, inbox_item_id, action_index, ctx)`. Body is the kernel logic currently inlined in `app/api/actions/approve/route.ts`: atomic state flip → executor.forward → audit_log insert with executor result → return `{audit_log_id, undo_window_expires_at}`. Same race-window ordering as the route (executor-first, audit-log-second).
33. **Modify** `app/api/actions/approve/route.ts` — body shrinks to: parse input → `requireAuthenticatedUser` → `await approveOne(...)` → respond. Behavior unchanged. Verify with manual click on existing seeded briefings (Wave 1 listing or Wave 2 repricer fixture) that approve+undo round-trips cleanly.
34. **Smoke-test the extraction:** `curl -b cookies.txt -X POST $SITE/api/actions/approve -d '{...existing fixture...}'` returns same shape as before extraction. If a Wave 1/2 briefing is in the cloud DB, click-test approve → UndoBanner → Undo and confirm `pending_listings` (or whichever Wave-1/2 pending table) flips status correctly.

### Phase I — Research Analyst agent
35. **Create** `lib/agents/research-analyst-output-adapter.ts` — pick → briefing_type + proposed_actions mapper.
36. **Create** `lib/agents/research-analyst.ts` per Delta Design.
37. **Create** `scripts/research-analyst.ts` (cron entry).
38. **Modify** `package.json` — add `agent:research-analyst`.

### Phase J — Fulfillment Ops agent
39. **Create** `lib/agents/fulfillment-ops.ts` per Delta Design (webhook-invoked; signature `(supabase, { trigger: 'webhook', event })` — matches Wave 2 convention for webhook-triggered agents).
40. **Modify** `app/api/sp-api/webhook/route.ts` — add `case 'ORDER_CHANGE': case 'ORDER_STATUS_CHANGE':` switch arm dispatching to `runFulfillmentOps(supabase, { trigger: 'webhook', event: env })`.
41. **Create** `vendor/sp-api-fixtures/notification-order-change.json` — **Implementer:** copy the ORDER_CHANGE NotificationEnvelope JSON shape verbatim from `tmp/research/2026-05-04-sp-api-comprehensive.md` §5.5; replace ASIN with one seeded ASIN from cloud DB (e.g. Omega-3's `B001GKPASE`). (synthesized SP-API ORDER_CHANGE envelope; matches dossier §5 shape; references one seeded ASIN).
42. **Create** `scripts/fulfillment-ops-test.ts` (one-shot dry-run loading fixture order envelope, calling `runFulfillmentOps(supabase, { trigger: 'manual-test', event: <fixture> })` directly; prints briefing_id + candidates count).
43. **Modify** `package.json` — add `agent:fulfillment-ops-test`.

### Phase K — Chief of Staff Digest agent
44. **Author** `minicrew-config/skills/chief-of-staff-digest.md` per Delta Design (~80 lines).
45. **Create** `lib/agents/chief-of-staff-digest.ts` per Delta Design.
46. **Create** `scripts/chief-of-staff-digest.ts` (cron entry).
47. **Modify** `package.json` — add `agent:chief-of-staff-digest`.

### Phase L — Chat tool extensions (consume approveOne from Phase H)
48. **Create** `lib/tools/batch_approve_briefings.ts` per Delta Design — imports `approveOne` from `lib/kernel/approve.ts` (the Phase H extraction); for each filter-matched inbox_item, invokes `approveOne(supabase, inbox_item_id, action_index, ctx)`. Returns JSON `{approved, failed, errors[], audit_log_ids[]}`.
49. **Create** `lib/tools/dismiss_all_briefings.ts`.
50. **Create** `lib/tools/summarize_inbox.ts`.
51. **Modify** `lib/tools/index.ts` — register all 3 tools (`batch_approve_briefings`, `dismiss_all_briefings`, `summarize_inbox`).
52. **Modify** `lib/system-prompt.ts` — append a paragraph describing the new tools so the chat persona surfaces them.

### Phase M — Inbox UI
53. **Modify** `components/inbox/timeline.tsx:51-74` — add `case 'chief_of_staff_digest': return 'Daily Digest';`.
54. **Modify** `components/inbox/briefing-card.tsx:201-213` — extend `isReportOnly` disjunct to include `(item.source_agent === 'chief_of_staff_digest')`.

### Phase N — Render config + env vars
55. **Modify** `render.yaml` — add 2 new cron services (research-analyst 06:15 UTC, chief-of-staff-digest 07:00 UTC) + 6 new envVarGroup entries.
56. **Modify** `.env.example` — append 6 new vars per Delta Design.

### Phase O — Verify
57. `npm run typecheck` passes.
58. `npm run lint` passes.
59. `supabase db reset` applies all 11 migrations cleanly (or apply remotely via Management API).
60. **Local agent runs (against cloud Supabase, fixture mode default):**
    - **60a.** `npm run fda:smoke` — prints first 3 FDA shortages + 3 recalls. Verifies real fetch works without key.
    - **60b.** `npm run keepa:token` — without `KEEPA_API_KEY` set: prints fixture token shape `{tokensLeft: 1000, refillRate: 20}`. With key set: prints real balance.
    - **60c.** `npm run agent:research-analyst` — produces 1–10 briefings; each has `source_agent='research_analyst'`, `briefing_type ∈ {new_opportunity, rx_shortage_adjacency, fda_recall_triggered}`, valid `proposed_actions` (or empty for picks without internal product_id).
    - **60d.** `npm run agent:fulfillment-ops-test` — loads fixture ORDER_CHANGE envelope, produces 1 briefing with `briefing_type='order_to_fulfill'`, `proposed_actions` containing one entry per wholesaler.
    - **60e.** `npm run agent:chief-of-staff-digest` — produces 1 briefing with `briefing_type='digest'`, `proposed_actions=[]`.
    - **60f.** `npm run embeddings:backfill` — for each `memory` row with NULL embedding: writes via Voyage and updates row. With `VOYAGE_API_KEY` unset, exits cleanly with message "VOYAGE_API_KEY not set; skipping". With key set: backfills.
61. **Webhook smoke test:**
    - Build a curl that posts `vendor/sp-api-fixtures/notification-order-change.json` to `http://localhost:3000/api/sp-api/webhook` with HMAC signature header (`SP_API_WEBHOOK_SECRET` from `.env.local`). Confirm 200 OK + 1 new fulfillment_ops briefing.
62. **Manual UI test on cloud (post-deploy):**
    - Sign in via dev-login. Confirm Inbox shows new agent sections: Fulfillment Ops, Research Analyst, Daily Digest.
    - Click Approve on a Fulfillment Ops `generate_purchase_order` action → `pending_purchase_orders.status='pending'` row inserted; `audit_log` row written; UndoBanner appears; Undo flips row to `cancelled`.
    - Click Approve on a Research Analyst `add_to_watchlist` (Wave 1 executor) → `products.watchlist_status` flipped; UndoBanner appears.
    - Click Acknowledge on a Daily Digest briefing → state='dismissed'.
    - In `/chat`, type "approve all the bookkeeper anomaly briefings" → assistant calls `batch_approve_briefings({source_agent:'bookkeeper'})` → matching briefings flip to acted; per-briefing audit_log rows written.
    - In `/chat`, type "dismiss all the customer success briefings" → assistant calls `dismiss_all_briefings({source_agent:'customer_success'})` → matching inbox_items.state='dismissed'.
63. **Render deploy**: push commit, confirm 2 new cron services appear in Blueprint, manually trigger each cron from Render UI, verify briefing rows in Supabase Studio. Confirm `pharm1-shared` env group has the 6 new entries (sync:false; values empty).

### Phase P — E2E Test Plan deliverable (PER UPSTREAM BRIEF — out of scope for this plan)
64. **Author** `tmp/ready-plans/2026-05-XX-comprehensive-e2e-test.md` — documenting feature × {creds-present, creds-missing} matrix across all 9 agents + memory + chat tools + webhooks. **This is the next deliverable AFTER Wave 3 lands**, not part of the Wave 3 plan/implement cycle.

---

## Validation

### Automated
- `npm run typecheck` passes (TS strict).
- `npm run lint` passes.
- All 11 migrations apply cleanly.
- All Wave 1+2 cron scripts (`agent:listing`, `agent:bookkeeper`, `agent:reflector`, `agent:portfolio-manager`, `agent:repricer`, `agent:account-health`, `agent:cs-test`) still pass (regression).
- New scripts (`agent:research-analyst`, `agent:chief-of-staff-digest`, `agent:fulfillment-ops-test`, `embeddings:backfill`, `fda:smoke`, `keepa:token`) all exit 0.

### Manual (UI on cloud)
- Inbox sections exist for Fulfillment Ops / Research Analyst / Daily Digest.
- Fulfillment Ops card with 4 wholesaler candidates: 4 actionable buttons + Skip. Click "PO from ABC" → `pending_purchase_orders` row inserted, `audit_log` row, UndoBanner, Undo cancels.
- Research Analyst card (with internal product_id): "Add to watchlist" primary + "Skip". Click → `products.watchlist_status='watching'` (via Wave 1 executor); Undo restores.
- Research Analyst card (without internal product_id): "Acknowledge" only.
- Daily Digest card: "Acknowledge" only (isReportOnly).
- Chat: "approve all the bookkeeper anomalies" → tool call → batch approval succeeds.
- Chat: "what's in my inbox" → tool call summarize_inbox → assistant relays per-agent counts.

### SQL spot-checks
```sql
-- After Research Analyst run:
select source_agent, briefing_type, jsonb_array_length(proposed_actions) as actions, data_snapshot->>'kind' as kind
  from briefings where source_agent='research_analyst' order by created_at desc limit 10;
-- expect: briefing_type in ('new_opportunity','rx_shortage_adjacency','fda_recall_triggered'); kind='research_pick'

-- After Fulfillment Ops webhook:
select source_agent, briefing_type, urgency, jsonb_array_length(proposed_actions) as actions
  from briefings where source_agent='fulfillment_ops' order by created_at desc limit 5;
-- expect: briefing_type='order_to_fulfill', urgency=5, actions ≥2

-- After Daily Digest:
select briefing_type, source_agent, jsonb_array_length(proposed_actions) as actions
  from briefings where briefing_type='digest' order by created_at desc limit 1;
-- expect: source_agent='chief_of_staff_digest', actions=0

-- After approve generate_purchase_order:
select id, order_id, wholesaler, proposed_unit_price, proposed_quantity, status, audit_log_id
  from pending_purchase_orders order by created_at desc limit 1;
-- expect: status='pending', audit_log_id NOT NULL

-- After undo:
select id, status, cancelled_at from pending_purchase_orders order by created_at desc limit 1;
-- expect: status='cancelled', cancelled_at NOT NULL

-- After embeddings backfill:
select count(*) filter (where embedding is not null) as with_embed,
       count(*) filter (where embedding is null) as without_embed,
       count(distinct embedding_model) as model_count
  from memory;
-- expect (with VOYAGE_API_KEY set): without_embed=0, model_count=1, embedding_model='voyage-4-lite'

-- Cross-source comparison (held in-memory; persisted as briefing data_snapshot, not in wholesaler_stock_snapshots):
select id, briefing_type, jsonb_array_length(data_snapshot->'wholesaler_snapshots') as snapshot_count
  from briefings
  where source_agent = 'fulfillment_ops'
  order by created_at desc
  limit 1;
-- expect: snapshot_count >= 1 (5 wholesalers in fixture mode minus any policy-filtered)
```

> **NOTE:** Wave 3 does NOT write to `wholesaler_stock_snapshots`. The table has no `metadata` column; Fulfillment Ops carries comparisons inside `briefings.data_snapshot` jsonb instead. See Known Limitation "Wholesaler comparisons in-memory only".

### Cred-toggle matrix (the brief's "{creds-present, creds-missing}" deliverable — partial here; full E2E plan post-Wave-3)

| Path | Creds missing (default Wave 3) | Creds present (post-onboarding) |
|---|---|---|
| Voyage embed | `embed()` returns null; pg_trgm fallback covers retrieval | Real Voyage `voyage-4-lite` 1024-dim vectors |
| FDA shortage / recall | Real fetch (free, no key); 1k/day rate limit | Real fetch with `FDA_API_KEY`; 120k/day rate limit |
| Keepa | Fixture client returns synthesized deals/products | Real fetch with `KEEPA_API_KEY`; token-bucket aware |
| EzriRx EDI | Fixture client returns parsed `vendor/edi-fixtures/*.edi` | Real SFTP poll (post-launch swap) |
| Order webhook | Curl-driven test envelopes | Real SP-API NotificationType: `ORDER_CHANGE` push |
| `generate_purchase_order` executor forward | `[STUB] would generate PO PDF and send EDI 850` log + `pending_purchase_orders` row | Same in Wave 3 — executor stays stubbed; post-launch swap replaces log line with real `node-x12` 850 + SFTP send |
| Chat batch-approve | Real (not gated by external creds; gated by Supabase auth + budget) | Same |
| OPENROUTER_API_KEY | All 3 new agent crons (research-analyst, chief-of-staff-digest, fulfillment-ops via webhook) exit 2 immediately at the `dailyBudgetGate` step in `lib/agents/_shared.ts` (inherited Wave 1+2 behavior). Webhook handler errors at the `runFulfillmentOps` invocation. **Hard requirement** — distinct from cred-gated optional creds above. | Real Sonnet 4.6 calls succeed; cost recorded in `claude_usage`. |

---

## Pre-Existing Issues Surfaced

- **Sign-in error key map fix-later (Wave 1)** — still open per `CLAUDE.local.md` Seq 3. Wave 3 does not fix this; flagged in `Things to Fix Later`.
- **`requireAuthenticatedUser(req)` ignores its `req` arg** — code smell from Phase 1; not addressed in Wave 3.
- **Wave 2 `acknowledge_health_alert` undo gap** — system-actor-initiated audit_log rows have no UI undo path. Not addressed in Wave 3 (no system-actor PO generation in Wave 3).

---

## Known Limitations

- **Fulfillment Ops fixture mode synthesizes wholesaler prices.** Real EDI 832 cadence + actual price competitiveness across wholesalers cannot be validated until EzriRx onboarding lands. Acceptable: Wave 3 validates the *shape* of comparisons, not their *correctness*.
- **Wholesaler comparisons in-memory only.** Wave 3 Fulfillment Ops does not persist rows to `wholesaler_stock_snapshots`. The `wholesaler_stock_snapshots` table has no `metadata` column (real columns: `id, product_id, supplier, stock_qty, price, anticipated_restock_date, lot_number, expiration_date, captured_at`), so the originally-planned `metadata->>'source'='fixture'` tagging is structurally impossible. Comparisons live inside the briefing's `data_snapshot` jsonb. Wave 4 may add persistent snapshot rows when EzriRx onboarding lands and per-supplier writes become meaningful. Downstream agents that need historical wholesaler-price comparisons must query `briefings.data_snapshot` JSONB (filter by `kind='wholesaler_comparison'`) until Wave 4 lands persistent `wholesaler_stock_snapshots` writes.
- **Fulfillment Ops per-item fan-out cap.** An incoming order envelope with more than 10 line items has its tail truncated: `if (change.ItemSummaries.length > 10) { items = items.slice(0, 10); }` in the agent. Reason: avoid runaway LLM cost on bulk orders. Acceptable for Wave 3 — Kaleem's average OTC order is 1–3 items; bulk orders are rare and would be flagged for manual handling anyway.
- **Research Analyst LLM may hallucinate product_ids.** The LLM is constrained via skill prompt + payload to match candidates against the `watching_products` list passed in, but Sonnet 4.6 occasionally emits a uuid not in the set. Wave 3 adds a post-parse validation: `if (pick.product_id && !watchingIds.has(pick.product_id)) { pick.product_id = null; }`, dropping the briefing into the "no internal product row yet" branch. The pick is still emitted; only the `add_to_watchlist` action is suppressed.
- **Research Analyst skips Google Trends.** Documented in locked decision 6. Phase 2.5 may add SerpAPI integration.
- **Research Analyst does not perform LLM web search** despite the skill prompt mentioning it. Runtime skill addendum disables that step. Reason: Wave 3 single-pass mode keeps cost/runtime bounded.
- **Daily Digest covers a 24h window.** Briefings older than 24h are not summarized; if Kaleem misses a day, those briefings still appear in the inbox individually but not in any digest. Acceptable for Wave 3.
- **Chat batch-approve is bounded at 50 briefings/call.** Larger sets require multiple chat turns or direct UI interaction.
- **Chat tool calls bypass HTTP route auth** (use shared executor logic with the chat session's authenticated user). Risk: if `requireAuthenticatedUser` semantics drift, the in-process call could behave differently. Mitigation: locked decision 25 keeps both paths through the same kernel functions.
- **Embeddings backfill uses 1k-row batches.** For very large `memory` tables, run multiple times. Single-run safe up to ~1M rows on free Voyage tier (200M token allowance).
- **Voyage embedding update is a separate UPDATE, not a single INSERT...RETURNING.** If the UPDATE fails (network blip, Voyage 5xx), the row stays without an embedding; pg_trgm fallback covers retrieval. Backfill script can re-fill.
- **`pending_purchase_orders.wholesaler` is text not enum.** Reason: keeps schema flexible if Kaleem adds new wholesalers post-launch (Wave 4 may convert to enum once the set is stable).

---

## Open Questions

1. **`lib/voyage/embed.ts` vs `lib/memory/embed.ts`** — brief said the latter; we resolve to `lib/voyage/embed.ts` for symmetry with other vendor clients (`lib/sp-api/`, `lib/sms/`, `lib/edi/`, `lib/fda/`, `lib/keepa/`). **Default: `lib/voyage/embed.ts`. Reviewer may flip to `lib/memory/embed.ts` if symmetry-with-other-vendors is less important than co-locating with the consumer (`lib/memory/write.ts`).**
2. **Chat tool `batch_approve_briefings` action_index default** — Wave 3 defaults to `0` (the primary action). Most briefings have action[0]=primary (variant: 'primary'). Edge case: a briefing with no action[0] but with action[1]=primary (rare) would be skipped silently. Mitigation: tool returns `{approved, failed, skipped}` so Kaleem sees exactly what happened.
3. **Should the Daily Digest itself appear in the next day's digest?** Default: NO — the digest is filtered out of its own input set (filter on `source_agent != 'chief_of_staff_digest'`). Documented; reviewer can flip if a recursive view is desired.
4. **Voyage backfill batch size** — 100 rows × ~500 tokens = 50K tokens/request; well under Lite-tier 1M-tokens-per-request cap. Reviewer may bump to 500 if backfill is slow.
5. **Should `summarize_inbox` be exposed as a chat tool or only as a digest-internal helper?** Default: EXPOSED. Kaleem may want to ask "what's in my inbox" without triggering the full digest agent. Tool returns the same per-agent aggregation.
6. **What happens if both `KEEPA_API_KEY` and `EZRIRX_SFTP_HOST` are missing AND FDA returns 5xx?** Research Analyst runs with empty signals + watching products only. LLM may produce 0–2 picks instead of 5–10. Documented in known limitations.

All open questions are non-blocking; defaults documented.

---

## Deprecation

Nothing to remove. Wave 3 is purely additive aside from:
- The new EDI fixture directory `vendor/edi-fixtures/` (committed) and `vendor/keepa-fixtures/`, `vendor/fda-fixtures/`.
- One new executor (`generate_purchase_order`) registered alongside existing ones.
- Three new chat tools registered.
- One new migration enum value (`digest`) — additive.
- One refactor: extracting `approveOne()` from `app/api/actions/approve/route.ts` into `lib/kernel/approve.ts` (locked decision 25; Phase H of the Tasks order). Behavior preserved.

---

## Confidence

**8/10** for one-pass implementation success.

**What raises confidence:**
- Waves 1+2 shape is proven and live. Three new agents mirror the same cron entry + agent runtime + Zod parse + briefing+inbox insert pattern.
- Kernel (approve/reject/undo/audit) is unchanged — registers 1 more executor + 3 chat tools.
- All schema infrastructure exists; the migrations are ~30 LOC total (1 enum-add + 1 table).
- 2 of 3 skill prompts pre-authored; one new (digest) is only ~80 lines.
- openFDA is keyless and well-documented per dossier.
- Voyage embedding is a single 30-LOC fetch helper; cred-gated returns null cleanly.
- Cred-fallback pattern from Wave 2 (`lib/sp-api/index.ts`) directly mirrors into `lib/edi/`, `lib/keepa/`, `lib/fda/`.
- `node-x12` is mature; path-query syntax handles all our parse needs.
- The webhook route extension is two `case` statements.
- Output-adapter pattern reused.

**What lowers confidence:**
- EDI parsing is novel for this repo. Risk: real wholesaler 832s vary in segment ordering / qualifier semantics. Mitigation: fixtures are hand-synthesized to match the dossier's documented shapes; real-world variance lands at post-launch swap.
- `lib/kernel/approve.ts` extraction is a refactor of a route that's already shipped. Risk: behavior drift between the route and the tool path. Mitigation: extract first (Phase H), validate against Wave 1+2 fixtures via the smoke-test step, then layer chat tools on top in Phase L. Same function called from both sites.
- Voyage UPDATE-after-INSERT pattern doubles DB writes per memory row (one INSERT + one UPDATE). Acceptable: writes are infrequent (<100/day). No batching.
- Chat tool calls bypass HTTP-level rate limiting (the in-process invocation). Mitigation: chat route already has a 60-call/min rate limit; tool calls within a single chat turn count once.
- Three external clients in one wave (FDA, Keepa, EDI) is more surface area than Wave 2's single SP-API client. Mitigation: each is its own folder; no cross-coupling.
- Research Analyst's pick → product_id mapping requires the LLM to identify whether a candidate exists in our `products` table. If the LLM hallucinates a product_id, the briefing's `add_to_watchlist` fails on the executor's UUID validation. Mitigation: the agent passes the watching_products list into the payload; the LLM is constrained to match against that list (skill prompt addendum).

---
