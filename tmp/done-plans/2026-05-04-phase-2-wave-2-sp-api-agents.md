# Plan: Phase 2 Wave 2 — SP-API-Driven Agents (Repricer · Account Health · Customer Success)

> Reconciled from intent brief + research dossier (SP-API + Twilio).
> Implementation target: three new agents that consume SP-API-shaped inputs (cred-gated real-or-fixture), three new executors that stub external mutations as `pending_*` table writes, a real SP-API client library at `lib/sp-api/`, a Twilio SMS client at `lib/sms/twilio.ts`, an SP-API webhook ingest route at `app/api/sp-api/webhook/route.ts`, three new pending tables, two new agent crons, and a fixture extractor script.
>
> Wave 2 is the proof that the propose→approve→execute kernel works against external-shaped data with credential-gated fallback. Kernel itself is unchanged.

---

## Summary

Wire **three pre-authored skill prompts** (`repricer.md`, `account-health.md`, `customer-triage.md` + `customer-draft.md`) into the proven Wave 1 agent shape (`lib/agents/_shared.ts` + `lib/executors/*` + `pending_*` tables + Render cron). Each agent reads SP-API data through a shared facade at `lib/sp-api/*` that calls real Amazon endpoints when `SP_API_REFRESH_TOKEN` is set, and falls through to vendored fixtures otherwise. **Repricer** runs 2×/day cron + reacts to `ANY_OFFER_CHANGED` push events. **Account Health** runs daily at 6am UTC + reacts to `ACCOUNT_STATUS_CHANGED` realtime; on red status it auto-pauses listings AND fires Twilio SMS to Kaleem. **Customer Success** is webhook-driven only; it triages messages via the Triage skill (Haiku, fast classify) and drafts replies via the Draft skill (Sonnet 4.6, voice-matched). Repricer remains **propose-only forever** — every executor write is a `pending_*` row, never a real SP-API mutation.

The plan introduces:
- 3 new agent runtimes (`lib/agents/{repricer,account-health,customer-success}.ts`) and 2 cron entries (`scripts/{repricer,account-health}.ts`); Customer Success is webhook-only.
- 3 new executors (`lib/executors/{reprice-listing,pause-listing,send-reply}.ts`) + a tiny `acknowledge-health-alert` executor; registry update.
- 1 new shared SP-API facade tree (`lib/sp-api/{auth,client,listings,pricing,notifications,reports,messaging,_fixtures}.ts`) — credential-gated; fixtures vendored from `vendor/sp-api-fixtures/*.json`.
- 1 new Twilio SMS client (`lib/sms/twilio.ts`) — credential-gated; logs to console when missing.
- 1 new SP-API webhook handler (`app/api/sp-api/webhook/route.ts`) accepting either an SQS-relayed envelope or a directly-posted SP-API NotificationEnvelope.
- 1 new fixture-extractor script (`scripts/extract-sp-api-fixtures.ts`) that pulls `x-amzn-api-sandbox.static[]` examples from vendored OpenAPI models.
- 3 new pending tables (`pending_pricing_changes`, `pending_customer_messages`, `pending_health_actions`) — same shape as `pending_listings`.
- 1 migration file for the three pending tables + indexes.
- Render cron entries: Repricer twice daily (`0 14,2 * * *`), Account Health daily 6am (`0 6 * * *`).
- 11 new env vars in `pharm1-shared` envVarGroup + `.env.example`, all `sync: false`, all credential-gated (no plan-time seeding).
- Updated SP-API webhook `routeNotificationToAgent()` dispatcher inside the new webhook route — currently dispatches `ANY_OFFER_CHANGED` to repricer, `ACCOUNT_STATUS_CHANGED`/`LISTINGS_ITEM_ISSUES_CHANGE` to account-health.
- Inbox UI: `agentLabel()` mapping for the three new agents already exists in `timeline.tsx` (Wave 1 added them prospectively); confirms passes.

Scope: ~27 new code files, ~4 modified, 1 new migration, 1 modified `render.yaml`, 1 modified `package.json`, 1 modified `.env.example`. Net code addition ~1100–1450 LOC. **Confidence for one-pass implementation: 8/10.**

---

## Intent / Why

Phase 2 Wave 1 (Bookkeeper, Reflector, Portfolio Manager) is shipped: agents writing to memory + briefings against our own Supabase tables. Wave 2 is the next zoom-out — agents that consume **external** data (SP-API listings, pricing, notifications, reports, messaging) but never mutate external systems directly. Every external write goes to a `pending_*` table; Wave-3-and-beyond replaces the stub with real SP-API calls in the executor body, kernel unchanged.

Wave 2 also introduces the **first credential-gated client surface**: the fixture-fallback pattern lets us ship working agents and a working UI today, before Kaleem's SP-API app approval lands (1–4 wk Amazon gating). When the credentials arrive, no agent or executor logic changes — only the SP-API client flips from `getFixtureListingsClient()` to `getRealListingsClient()` based on env var presence.

**Must not be optimized away:**
- Human-in-loop on every executor write (Kaleem clicks every approve/reject/undo).
- 30-minute undo on every action.
- Repricer is **propose-only forever** — even at red status, even with autopilot bands, it never auto-changes prices. Locked decision; do not re-litigate.
- Account Health red status DOES auto-pause listings (per skill prompt) and DOES auto-SMS Kaleem — these two auto-actions are the only autonomous mutations in Wave 2; both write to `pending_*` tables and the SMS is informational, not transactional.
- Cred-gated everywhere: if `SP_API_REFRESH_TOKEN` missing, agents run against fixtures and produce real-shaped briefings; if `TWILIO_ACCOUNT_SID` missing, SMS path logs to console and skips. End-state: Kaleem enters credentials post-approval and the agents go live without code changes.
- OTC-only — two-POS isolation invariant.
- Skill prompts are pre-authored — wire, don't rewrite.

---

## Source Artifacts
- **Intent / why:** `tmp/plan-artifacts/2026-05-04-phase-2-wave-2-sp-api-agents-brief.md`
- **Research dossier (this wave):** `tmp/plan-artifacts/2026-05-04-phase-2-wave-2-sp-api-agents-research-dossier.md`
- **Discussion brief (upstream):** `tmp/briefs/2026-05-04-phase-2-waves-1-2-3-roadmap.md` (Wave 2 section)
- **Original Phase 2 brief (locked decisions):** `tmp/briefs/2026-05-01-phase-2-listing-automation.md`
- **Predecessor plan (mirror its shape):** `tmp/done-plans/2026-05-04-phase-2-wave-1-self-contained-agents.md`
- **Critical primary research:** `tmp/research/2026-05-04-sp-api-comprehensive.md` (1692 lines), `tmp/research/2026-05-04-ezrirx-sms.md` (335 lines)

---

## Verified Repo Truths

Each item is `Fact / Evidence / Implication`. Negative claims include `Search Evidence`.

### Kernel surface (carried from Wave 1)

- **Fact:** Executor registry is a literal `Record<string, Executor>` at `lib/executors/index.ts:11-17`. Adding executors = imports + map entries.
  **Evidence:** `lib/executors/index.ts:11-17`
  **Implication:** Three new Wave-2 executors slot in identically.

- **Fact:** `app/api/actions/approve/route.ts:96-100` reads `briefing.proposed_actions[action_index].kind` and dispatches via `getExecutor(kind)`. **No route changes needed for new executors.**
  **Evidence:** `app/api/actions/approve/route.ts:90-110`
  **Implication:** Wave 2 adds executors only — kernel unchanged.

- **Fact:** `app/api/actions/undo/route.ts:50-57` resolves the original action via `getExecutor(original.action)` and calls `.reverse(...)`.
  **Evidence:** `app/api/actions/undo/route.ts:50-57`
  **Implication:** Reverse implementations on the three new executors must be self-contained (no ambient state needed beyond `forwardResult`).

- **Fact:** `lib/agents/_shared.ts` exports `stripJsonFence`, `loadSkillPrompt`, `dailyBudgetGate`, `callAgentLLM`, `DEFAULT_PHARMACY_ID`, `AGENT_MODEL`. Already JSON-only suffix appended in `callAgentLLM` (lines 64-67).
  **Evidence:** `lib/agents/_shared.ts:1-87`
  **Implication:** Wave 2 agents reuse `_shared.ts` verbatim. No additions to `_shared.ts` required for SP-API-driven agents (SP-API client is its own facade).

- **Fact:** `lib/supabase/admin.ts:8` exports `createAdminClient()` — service-role, no `next/headers` cookie use.
  **Evidence:** `lib/supabase/admin.ts:8-19`
  **Implication:** Both Wave 2 cron scripts AND the SP-API webhook route (Node runtime, no auth dependency on Kaleem session) use this client.

- **Fact:** `requireAuthenticatedUser(req)` exists at `lib/auth.ts:16` and is the auth gate on all approve/reject/undo routes. SP-API webhook will NOT use it — the webhook is signed/IP-allowlisted at the SQS or HTTPS layer, not Supabase auth.
  **Evidence:** `lib/auth.ts:16`
  **Implication:** Wave 2 webhook route has its own gate (HMAC signature verification or AWS-account IP allowlist; documented in dossier §1).

### Schema reality

- **Fact:** `briefing_type` enum already includes `reprice_up`, `reprice_down`, `suspend`, `account_health`, `customer_message`. **No enum migration needed for Wave 2 briefing types.**
  **Evidence:** `supabase/migrations/20260419000004_briefings_schema.sql:6-11`
  **Implication:** Repricer emits `reprice_up | reprice_down | suspend`. Account Health emits `account_health`. Customer Success emits `customer_message`. All exist.

- **Fact:** `listings.status text not null check (status in ('active', 'paused', 'suspended', 'deleted'))` — `paused` is already a valid status.
  **Evidence:** `supabase/migrations/20260419000002_core_schema.sql:69`
  **Implication:** `pause_listing` executor's stub is a `pending_health_actions` insert (NOT a `listings.status` update — we don't write the real Amazon-pause until SP-API approval; we record intent). Reverse marks the pending row cancelled. When Wave 3 swap happens, forward becomes a real SP-API patch + flips `listings.status='paused'`; reverse flips back.

- **Fact:** `listings.platform_listing_id text` exists — this is where the Amazon SKU lives once a listing is real. Today seeded data has none.
  **Evidence:** `supabase/migrations/20260419000002_core_schema.sql:67`
  **Implication:** Repricer agent reads `listings.platform_listing_id` as the SP-API sku. Fixture mode synthesizes one when null.

- **Fact:** `briefings.proposed_actions jsonb` — free-form JSON. Variant + label + kind + params shape is convention, not constraint.
  **Evidence:** `supabase/migrations/20260419000004_briefings_schema.sql:28`
  **Implication:** Repricer emits `proposed_actions[].kind = 'reprice'` (single kind handles up/down/hold via params); separate `kind = 'pause_listing'` for suspend. Customer Success emits `proposed_actions[].kind = 'send_reply'` for draft replies + `proposed_actions[].kind = 'dismiss_briefing'` for the Skip button (already wired in Wave 1).

- **Fact:** `pending_listings` is the precedent shape (id, pharmacy_id, product_id, proposed_*, status enum, audit_log_id FK, sp_api_feed_id, published_at, cancelled_at, created_at).
  **Evidence:** `supabase/migrations/20260501000001_pending_listings_and_system_spend.sql:6-21`
  **Implication:** Three new tables mirror it: `pending_pricing_changes`, `pending_customer_messages`, `pending_health_actions`. Each has its own foreign-key shape (listing_id vs message_id vs listing_id) but otherwise identical pattern.

- **Fact:** `claude_usage.user_id` is nullable; partial index `claude_usage_system_day_idx` on `(created_at desc) where user_id is null`.
  **Evidence:** `supabase/migrations/20260501000001_pending_listings_and_system_spend.sql:25-28`
  **Implication:** All three Wave 2 agents record system spend identically to Wave 1.

- **Fact:** `wholesaler_stock_snapshots` and `signals` tables exist for Repricer's optional supplier-cost / Keepa context. Currently empty.
  **Evidence:** `supabase/migrations/20260419000002_core_schema.sql:106-129`
  **Implication:** Repricer reads them but tolerates empty results — fall back to fixture supplier-cost in fixture mode.

- **Fact:** `health_metrics` table exists with `(platform, metric, value, captured_at)`. Currently empty.
  **Evidence:** `supabase/migrations/20260419000002_core_schema.sql:131-138`
  **Implication:** Account Health writes parsed `GET_V1_SELLER_PERFORMANCE_REPORT` rows here on each run, then reads the trailing 30 days for trendline context. In fixture mode, the parser writes a synthetic snapshot.

### Inbox UI / `timeline.tsx`

- **Fact:** `components/inbox/timeline.tsx:51-74` — `agentLabel()` already maps `repricer`, `account_health`, `customer_success` (Wave 1 added these prospectively).
  **Evidence:** `components/inbox/timeline.tsx:51-74`
  **Implication:** No UI label change needed.

- **Fact:** `components/inbox/briefing-card.tsx:201-213` — reject-only button label adapts via `isReportOnly` flag for `bookkeeper`/`reflector`/`portfolio_manager` cases. Wave 2 does NOT need to extend this — Repricer/Account Health/Customer Success briefings always have proposed_actions (suspend → `pause_listing` button; account_health green → reject-only "Acknowledge"; customer message → `send_reply` + Skip).
  **Evidence:** `components/inbox/briefing-card.tsx:178-213`
  **Implication:** Account Health green-status briefings should ride the existing `isReportOnly` pattern. Plan extends that flag to include `account_health` source_agent IFF `proposed_actions` is empty (mirrors `portfolio_manager` rule).

### Render / cron

- **Fact:** `render.yaml` has 6 services (web, listing-agent cron, bookkeeper cron, portfolio-manager cron, reflector cron, 2 backup crons). EnvVarGroup `pharm1-shared` has 19 vars (per current render.yaml after Wave 1's DEV_LOGIN_ENABLED + NEXT_PUBLIC_DEV_LOGIN_ENABLED additions).
  **Evidence:** `render.yaml:1-157`
  **Implication:** Wave 2 adds 2 more cron services (Repricer twice/day, Account Health daily). Customer Success has no cron (webhook-only). Eleven new env vars get added to `pharm1-shared`.

- **Fact:** `package.json:14-17` has `agent:listing`, `agent:bookkeeper`, `agent:reflector`, `agent:portfolio-manager` scripts. `tsx` is a dependency (line 33).
  **Evidence:** `package.json:14-17, 33`
  **Implication:** Wave 2 adds `agent:repricer` and `agent:account-health` scripts. Customer Success has no `agent:*` script — it's invoked through the webhook route (and a one-shot `scripts/customer-success-test.ts` for local dry-runs).

### SP-API client surface (NEW)

- **Fact:** `lib/sp-api/` directory does NOT exist.
  **Search Evidence:** `find lib/sp-api 2>&1 | grep -v "No such"` — empty.
  **Implication:** All paths under `lib/sp-api/*` are NEW.

- **Fact:** No `twilio` package dependency.
  **Search Evidence:** `grep '"twilio"' package.json` — zero matches.
  **Implication:** `npm i twilio` adds a dependency. Per dossier §2.2, `twilio-node` ships TS types built-in.

- **Fact:** No `@sp-api-sdk/*` packages installed.
  **Search Evidence:** `grep '@sp-api-sdk' package.json` — zero matches.
  **Implication:** **Decision (locked, see below):** rather than pull `~10` per-API SDK packages from `@sp-api-sdk/*`, ship a thin hand-rolled fetch-based client per the dossier's TypeScript interfaces. Reasons: (a) we use ~6 endpoints across all three agents; (b) keeps Render image lean; (c) auth layer (LWA refresh) is ~50 LOC; (d) easier fixture override surface; (e) we already control the JSON shapes via Zod schemas the agents consume. Trade-off: when SP-API model changes, we update by hand instead of `npm update`. Acceptable risk — schema changes for our 6 endpoints are rare.

- **Fact:** No vendored OpenAPI model files in `node_modules/@sp-api-models/` or anywhere else in repo.
  **Search Evidence:** `find . -name "*.json" -path "*selling-partner-api-models*" 2>&1 | head` — empty.
  **Implication:** Plan downloads the OpenAPI specs into `vendor/sp-api-models/` (or fetches via raw GitHub URL in `scripts/extract-sp-api-fixtures.ts`) at fixture-extraction time. Vendored JSONs are gitignored; the *extracted fixtures* (small files) get committed.

### Negative checks

- **Fact:** No file under `lib/sp-api/`, `lib/sms/`, `lib/agents/{repricer,account-health,customer-success,customer-success-triage,customer-success-draft}.ts`, `lib/executors/{reprice-listing,pause-listing,send-reply,acknowledge-health-alert}.ts`, `scripts/{repricer,account-health,customer-success-test,extract-sp-api-fixtures}.ts`, or `app/api/sp-api/webhook/route.ts` exists today.
  **Search Evidence:** `find lib/sp-api lib/sms scripts/repricer.ts scripts/account-health.ts scripts/extract-sp-api-fixtures.ts app/api/sp-api 2>&1 | grep -v "No such"` — empty.
  **Implication:** All those paths are NEW.

- **Fact:** `briefings.briefing_type` enum has no `reprice` value (only `reprice_up`, `reprice_down`, `suspend`).
  **Search Evidence:** `grep "create type briefing_type" -A 8 supabase/migrations/20260419000004_briefings_schema.sql`
  **Implication:** Repricer maps decision → briefing_type as: `match_bb`/`drop` → `reprice_down`, `raise` → `reprice_up`, `pause`/`suspend` → `suspend`, `hold` → emits a low-urgency `reprice_down` briefing with rationale "hold within band, no change proposed" and `proposed_actions = [dismiss_briefing only]` (informational; Wave-3-onwards may decide to skip emitting briefings for hold).

- **Fact:** No SQS-consumer code exists.
  **Search Evidence:** `grep "@aws-sdk/client-sqs" package.json` — zero.
  **Implication:** Wave 2 does NOT install the SQS client. The webhook route assumes either (a) a directly-posted SP-API NotificationEnvelope from a future small relay (Lambda or other), or (b) a manually-crafted POST during local testing. **The route accepts the SP-API NotificationEnvelope JSON shape directly** — agnostic to whether the producer is SQS, EventBridge, or a curl test. SQS-polling worker is deferred to Wave 3 (which has more budget for AWS infra). Documented as a fix-later in the plan.

---

## Locked Decisions

1. **Three agents only.** Repricer, Account Health, Customer Success. No others in this wave.
2. **Skill prompts are pre-authored** — wire `repricer.md`, `account-health.md`, `customer-triage.md`, `customer-draft.md`. Don't rewrite. Customer Success is two skill calls (Triage Haiku → Draft Sonnet 4.6) inside one webhook handler.
3. **Repricer is propose-only forever.** Even at red urgency, even within autopilot bands, every reprice goes through Kaleem's click. Locked.
4. **Account Health is the only agent that fires auto-actions on red.** Auto-action #1: insert `pending_health_actions` rows for each contributing listing (status='pending', kind='auto_pause') — this models the auto-pause as a pending intent, not as a `listings.status='paused'` mutation. Auto-action #2: send Twilio SMS to `KALEEM_SMS_NUMBER` (cred-gated; logs to console if Twilio creds missing). Both auto-actions are recorded in `audit_log` with `actor='system:account_health'`. Kaleem still has to **acknowledge** the alert through the kernel — the briefing carries an `acknowledge_health_alert` proposed action. Until acknowledged, the listing is in stub-paused state; if Kaleem acks within the 30-min undo window, undo cancels the pending pause; otherwise it's "live" (still stubbed in Wave 2 — no real SP-API mutation).
5. **Customer Success runs in two stages on each webhook.** Stage 1: Triage (Haiku, `reasoning: 'low'`, classifies into `medical_question`/`shipping`/`refund`/`general`/`spam`). Stage 2 (skipped for `medical_question` and `spam`): Draft (Sonnet 4.6, `reasoning: 'medium'`, voice-matched). Stage 1 always emits a briefing (or audit-only for spam). Stage 2 (when run) attaches `proposed_actions = [{ kind: 'send_reply', ... }, { kind: 'dismiss_briefing', ... }]` to the same briefing. **Single briefing per inbound message.**
6. **Three new pending tables.** Mirror `pending_listings` shape. Each gets its own audit_log_id FK and its own `external_id` slot (sp_api_feed_id, sp_api_message_id, sp_api_action_id) for post-Wave-3 swap.
7. **SP-API client is hand-rolled** (not `@sp-api-sdk/*`). Reasons in §Verified Repo Truths. Net: ~400 LOC across `lib/sp-api/*`.
8. **Fixture-fallback is automatic.** Every `getXxxClient()` factory tests `process.env.SP_API_REFRESH_TOKEN`. If unset, returns the fixture client. Same logic for Twilio: `process.env.TWILIO_ACCOUNT_SID` decides real vs console-log. **No flag, no toggle** — credentials drive everything.
9. **Twilio SMS is one-way only.** No inbound Twilio webhook. No 10DLC registration code path. Plan documents the 10DLC kaleem-todo (per dossier §2.2) but does not gate Wave 2 on it.
10. **Webhook route accepts the SP-API NotificationEnvelope shape directly.** No SQS polling in Wave 2. Authentication: HMAC verification using `SP_API_WEBHOOK_SECRET` env var (any non-matching POST returns 401). When SQS is wired in Wave 3, the SQS-consumer worker forwards messages to this route; no route signature change.
11. **Repricer "hold" decisions emit a low-urgency briefing** rather than no-op. Rationale: visibility — Kaleem wants to see "Repricer evaluated and decided no change" so he can build trust in the agent. Reject-only "Acknowledge" button.
12. **Same daily spend cap (`MAX_DAILY_CLAUDE_SPEND_USD = 50`) applies system-wide.** Triage's Haiku cost is small (~$0.001/call) but counts. Repricer's twice-daily cron with up to 30 listings × Sonnet 4.6 is bigger (~$0.30/run); two runs/day = $0.60/day. Account Health daily Sonnet 4.6 ~$0.05/run. Total estimated Wave 2 daily spend ~$0.65/day with no Customer Success traffic. Plan documents the budget envelope.
13. **Single tenant** — `pharmacy_id = 00000000-0000-0000-0000-000000000001`. Same as Wave 1.
14. **Cron-safe Supabase admin client** for both cron scripts and the webhook route. (Webhook route does NOT use `next/headers` cookies.)
15. **Approve-flow ordering carried from Wave 1:** executor first, audit_log second.
16. **No automated tests.** Wave 2 mirrors Wave 1's "manual click-through + cron-trigger" validation. Tests deferred to a later sweep.
17. **Repricer reasoning effort = `'medium'`. Account Health = `'medium'`. Triage = `'low'`. Draft = `'medium'`.** Reflector still uses `'high'` per Wave 1 (unchanged).
18. **Customer Success draft tone profile lookup is best-effort.** If `memory.kind='preferences'` row exists for tone, use it; else fall back to "warm, brief, signs off — Kaleem". Skill prompt already says this.
19. **The `acknowledge_health_alert` executor is a no-op forward + no-op reverse.** It's the kernel-level "Kaleem saw the alert" record. Useful for audit log granularity. Same pattern as `dismiss_briefing`.
20. **No SQS / `@aws-sdk/client-sqs` install in Wave 2.** Webhook route is fetch-driven. Documented as Wave 3 work item.
21. **Account Health auto-pause is capped at N=5 contributing listings per run.** If `parsed.contributing_listing_ids.length > 5`, agent SKIPS the pause loop, sends an SMS with `'PHARMADASH ALERT: Red status, ${N} listings affected — too many for auto-pause. Open inbox.'`, and emits the briefing with `proposed_actions = [acknowledge_health_alert, dismiss_briefing]`. Rationale: a misclassified red status with 30+ listings would auto-pause every active listing with no recovery path in Wave 2. Cap means worst case is 5 paused listings, still recoverable via Supabase write.
22. **ExecutorContext.userId of form `system:<agent_name>` indicates a non-Kaleem actor.** Executors that join against `auth.users` MUST treat such values as non-UUID and skip the join. Convention only — no type refactor in Wave 2. Wave 3 may discriminated-union the context type if needed.

---

## Known Mismatches / Assumptions

| # | Item | Brief said | Repo / dossier reality | Resolution |
|---|---|---|---|---|
| 1 | Repricer executor `kind` | "STUB writes to pending_pricing_changes" with `kind: 'reprice'` from skill | Skill emits `kind: 'reprice'` for reprice and `kind: 'pause_listing'` for suspend | Two executors: `reprice_listing` (kind: `reprice`) and `pause_listing` (kind: `pause_listing`). Repricer briefings emit one or the other. |
| 2 | Account Health auto-pause + SMS | "Red → auto-pause listing + SMS Kaleem" | Repo `listings.status='paused'` would be a real mutation; we want stub | Auto-action models the pause as a `pending_health_actions` row + audit_log entry; SMS via Twilio (cred-gated). Real `listings.status` mutation deferred to post-Wave-3 swap. |
| 3 | Customer Success webhook source | "Real SP-API Customer Messaging webhook in Wave 3 polish; for now, accept fixture or simulated webhook payload" | SP-API has no inbound-message push (per dossier §10 — Solicitations API is one-way OUTbound) | Customer Success's "webhook" in Wave 2 is **the same `app/api/sp-api/webhook/route.ts` route**, accepting a synthetic `NotificationType: 'CUSTOMER_MESSAGE_RECEIVED'` envelope shape (NOT a real SP-API type — it's our own convention). Wave 3 wires real Buyer-Seller Messaging API polling. |
| 4 | "Read SP-API health metrics via GET_V1_SELLER_PERFORMANCE_REPORT" | Real-or-fixture | Reports flow is async (createReport → poll → getReportDocument → fetch presigned URL → parse) | In real mode: agent runs the full async flow, with budget for ~5 min of polling. In fixture mode: read pre-extracted JSON fixture. Either way, parsed metrics persist to `health_metrics` table for trend lens. |
| 5 | "Real SP-API client at lib/sp-api/" with `@sp-api-sdk/*` per dossier | "If too heavy, write thin fetch-based clients per the dossier's TypeScript interfaces" | We use ~6 endpoints across 3 agents | Hand-rolled fetch-based clients. ~400 LOC. Documented as "preferred over per-API SDK packages for footprint reasons". |
| 6 | "ANY_OFFER_CHANGED" trigger | Real-time push | No SQS consumer in Wave 2 | Webhook route accepts directly-posted NotificationEnvelope. SQS-polling worker is Wave 3. Plan documents fix-later. |
| 7 | Wave 1 plan's already-shipped bullet about agentLabel mapping | "Add agentLabel mapping for repricer, account_health, customer_success (currently fall back to source_agent text)" | Wave 1's `timeline.tsx:51-74` already maps all three. No change needed. | Plan validates and notes "carried from Wave 1". |
| 8 | "Briefing types: reprice_up, reprice_down, suspend (all already in enum)" | Already in enum | Confirmed `supabase/migrations/20260419000004_briefings_schema.sql:6-11` | No enum migration needed. |
| 9 | Sandbox spec extraction script | "extracts fixtures from selling-partner-api-models GitHub repo into vendor/sp-api-fixtures/" | Models are JSON-only, ~50MB total; we want only `x-amzn-api-sandbox.static[]` — small | `scripts/extract-sp-api-fixtures.ts` fetches per-model JSON via raw.githubusercontent.com URLs into `vendor/sp-api-models/` (gitignored), filters to relevant operations, writes `vendor/sp-api-fixtures/<operationId>.json` (committed). |
| 10 | `npm i twilio` | Has built-in TS types | Confirmed via dossier §2.2 + npm page | Add `twilio` to dependencies. ~30 LOC for the wrapper. |
| 11 | "Customer Success — STUB writes to pending_customer_messages" | Same shape as pending_listings | Reverse undoes the pending row | Mirror pattern. status enum: `pending | sent | cancelled`. |
| 12 | "Two new executors: pause_listing (auto-fires on red), acknowledge_health_alert (Kaleem clicks)" | Already named | `pause_listing` is shared between Repricer's `suspend` and Account Health's red branch. Both write to `pending_health_actions` (yes — even Repricer's suspend uses pending_health_actions, since "pause a listing" is the same conceptual action regardless of trigger). | Single `pause_listing` executor. Account Health uses it autonomously on red; Repricer proposes it for Kaleem's click. Both end up as `pending_health_actions` rows. |

---

## Critical Codebase Anchors

Keep open while implementing.

- `lib/executors/index.ts:11-17` — registry to extend
- `lib/executors/types.ts:1-30` — Executor interface + UnknownExecutorError
- `lib/executors/list-on-amazon.ts:1-77` — canonical executor shape (forward + reverse + Zod schema + `console.log('[STUB] ...')` SP-API call site)
- `lib/agents/_shared.ts:1-87` — shared helpers (use as-is, no extensions for Wave 2)
- `lib/agents/listing-agent.ts:1-262` — canonical agent shape (skill load, candidate query, LLM call with reasoning effort cast, JSON parse + fence-strip + Zod, briefing+inbox insert)
- `lib/agents/bookkeeper.ts` — Wave 1 example of an agent that pulls multiple Supabase tables before LLM call
- `lib/agents/portfolio-manager-output-adapter.ts` — Zod discriminated-union adapter pattern (Wave 2 will mirror for Repricer's `reprice_up | reprice_down | suspend` mapping)
- `lib/supabase/admin.ts:8-19` — cron-safe client factory (used by both cron scripts and webhook route)
- `lib/budget.ts:7-66` — recordLLMUsage / getTodaySpendUsd patterns
- `lib/llm.ts:1-13` — OpenRouter singleton
- `app/api/actions/approve/route.ts:90-148` — kernel approve route (no changes; uses getExecutor(kind))
- `app/api/actions/undo/route.ts:33-73` — kernel undo route (no changes)
- `scripts/listing-agent.ts:1-19` — canonical cron entry shape
- `render.yaml:33-82` — cron service pattern + envVarGroup ref
- `supabase/migrations/20260501000001_pending_listings_and_system_spend.sql` — pending_listings schema (mirror for three new tables)
- `tmp/research/2026-05-04-sp-api-comprehensive.md:520-619` — Repricer's killer API: getFeaturedOfferExpectedPriceBatch (§4.2)
- `tmp/research/2026-05-04-sp-api-comprehensive.md:619-833` — Notifications API + envelope shape (§5)
- `tmp/research/2026-05-04-sp-api-comprehensive.md:1100-1170` — Reports API: GET_V1_SELLER_PERFORMANCE_REPORT (§7)
- `tmp/research/2026-05-04-sp-api-comprehensive.md:1366-1400` — Solicitations API (§10) — informational; not used in Wave 2 (deferred)
- `tmp/research/2026-05-04-sp-api-comprehensive.md:1486-1580` — Fixture-fallback strategy (§13)
- `tmp/research/2026-05-04-ezrirx-sms.md:194-260` — Twilio TS SDK + 10DLC requirements
- `minicrew-config/skills/repricer.md` — skill prompt to wire as system message
- `minicrew-config/skills/account-health.md` — skill prompt
- `minicrew-config/skills/customer-triage.md` + `customer-draft.md` — two-stage Customer Success skills

---

## Files Being Changed

```
pharm1/
├── supabase/
│   └── migrations/
│       └── 20260504000003_wave2_pending_tables.sql            ← NEW (3 tables, indexes)
│
├── vendor/
│   ├── sp-api-models/                                         ← NEW (downloaded by scripts/extract-sp-api-fixtures.ts; gitignored)
│   └── sp-api-fixtures/                                        ← NEW (committed)
│       ├── getFeaturedOfferExpectedPriceBatch.json
│       ├── getCompetitiveSummary.json
│       ├── getListingsItem.json
│       ├── createReport.json
│       ├── getReport.json
│       ├── getReportDocument.json
│       ├── createSubscription.json
│       ├── notification-any-offer-changed.json           (synthesized from §5.5 dossier)
│       ├── notification-account-status-changed.json
│       ├── notification-customer-message-received.json   (our own convention, see §3)
│       └── seller-performance-report-sample.json         (synthesized; matches GET_V1_SELLER_PERFORMANCE_REPORT shape)
│
├── lib/
│   ├── sp-api/                                                ← NEW dir (~400 LOC)
│   │   ├── auth.ts                                            ← LWA refresh + bearer cache (per-process mutex)
│   │   ├── client.ts                                          ← fetch wrapper with retry/backoff (4xx no retry, 429+5xx exp-backoff up to 5 retries)
│   │   ├── listings.ts                                        ← getListingsItem, putListingsItem, patchListingsItem
│   │   ├── pricing.ts                                         ← getCompetitiveSummary, getFeaturedOfferExpectedPriceBatch
│   │   ├── notifications.ts                                   ← createSubscription, createDestination (used in setup script, not at runtime)
│   │   ├── reports.ts                                         ← createReport, getReport, getReportDocument, fetchAndParseReport
│   │   ├── messaging.ts                                       ← createConfirmDeliveryDetails (used by Customer Success real mode), createSolicitation
│   │   ├── _fixtures.ts                                       ← fixture loader; reads from vendor/sp-api-fixtures/*.json
│   │   ├── types.ts                                           ← shared TS interfaces matching dossier shapes
│   │   └── index.ts                                           ← public surface: getListingsClient(), getPricingClient(), getNotificationsClient(), getReportsClient(), getMessagingClient(); each chooses real vs fixture by SP_API_REFRESH_TOKEN presence
│   ├── sms/
│   │   └── twilio.ts                                          ← NEW (~40 LOC); cred-gated wrapper
│   ├── agents/
│   │   ├── repricer.ts                                        ← NEW
│   │   ├── repricer-output-adapter.ts                         ← NEW (decision → briefing_type + proposed_actions)
│   │   ├── account-health.ts                                  ← NEW
│   │   ├── account-health-status-classifier.ts               ← NEW (thresholds → status; pure logic, testable)
│   │   ├── customer-success.ts                                ← NEW (orchestrates Triage + Draft)
│   │   └── customer-success-output-schemas.ts                 ← NEW (Triage output Zod, Draft output Zod)
│   ├── executors/
│   │   ├── reprice-listing.ts                                 ← NEW (kind: 'reprice')
│   │   ├── pause-listing.ts                                   ← NEW (kind: 'pause_listing')
│   │   ├── send-reply.ts                                      ← NEW (kind: 'send_reply')
│   │   ├── acknowledge-health-alert.ts                        ← NEW (kind: 'acknowledge_health_alert')
│   │   └── index.ts                                           ← MODIFIED (register 4 new executors)
│   ├── supabase/
│   │   └── types.ts                                            ← MODIFIED (regenerated after migration)
│   └── llm-pricing.ts                                          ← MODIFIED (register Haiku 4.5 + Sonnet date-stamped pricing entries)
│
├── components/
│   └── inbox/
│       └── briefing-card.tsx                                   ← MODIFIED (extend isReportOnly to include account_health-with-empty-actions)
│
├── app/
│   └── api/
│       └── sp-api/
│           └── webhook/
│               └── route.ts                                    ← NEW (HMAC-verified; dispatches to agent runners)
│
├── scripts/
│   ├── repricer.ts                                            ← NEW (cron entry)
│   ├── account-health.ts                                       ← NEW (cron entry)
│   ├── customer-success-test.ts                               ← NEW (one-shot dry-run; loads fixture envelope and invokes runCustomerSuccess)
│   └── extract-sp-api-fixtures.ts                             ← NEW (fetches OpenAPI models, extracts x-amzn-api-sandbox.static[])
│
├── .env.example                                                ← MODIFIED (11 new vars: LWA_*, SP_API_*, TWILIO_*, KALEEM_SMS_NUMBER, SP_API_WEBHOOK_SECRET)
├── .gitignore                                                  ← MODIFIED (add vendor/sp-api-models/)
├── package.json                                                ← MODIFIED (add `twilio` dep + agent:repricer, agent:account-health, agent:cs-test, fixtures:extract scripts)
└── render.yaml                                                 ← MODIFIED (2 new cron services + 11 new envVars in pharm1-shared)
```

Total: **~27 NEW files, 4 MODIFIED files, 1 new migration, 1 new fixture directory committed (~10 small JSON files), 1 new vendor dir (gitignored)**. Net code addition ~1100–1450 LOC including the SP-API client and fixtures glue.

---

## Reconciliation Notes

Imported from dossier:
- LWA refresh-token auth (no Sigv4 since Oct 2023). Plan implements LWA-only.
- `https://sellingpartnerapi-na.amazon.com` for production, `sandbox.sellingpartnerapi-na.amazon.com` for sandbox. Configurable via `SP_API_REGION` (default `na`).
- `getFeaturedOfferExpectedPriceBatch` is the killer API for Repricer (per §4.2). Plan uses it as primary input; falls back to `getCompetitiveSummary` per-batch if FOEP returns `NOT_ELIGIBLE_TO_COMPETE`.
- `ANY_OFFER_CHANGED` envelope shape in §5.5 matches our `pending_pricing_changes.proposed_*` columns directly.
- `GET_V1_SELLER_PERFORMANCE_REPORT` is JSON; parsed into our `health_metrics` table.
- Fixture extraction from `x-amzn-api-sandbox.static[]` per §13.3.
- HMAC verification on webhook ingress (informed by general SQS-relay or EventBridge-relay safety practice; Amazon doesn't sign SQS messages but our route is the relay's downstream so we sign at our boundary).
- Twilio: `twilio-node` SDK with built-in TS types per §2.2; 10DLC registration is Kaleem's todo, not gated by code.

Dropped from dossier (low value at this scope):
- `@sp-api-sdk/*` per-API package install — replaced with hand-rolled clients.
- SQS consumer (worker service) — deferred to Wave 3.
- RDT (restricted data token) flow — Customer Success in Wave 2 doesn't need PII (uses synthesized message from webhook payload, doesn't fetch buyer info). Real RDT flow lands when Wave 3 wires real Messaging API polling.
- EventBridge destination — deferred to Wave 3.
- Solicitations API (review-request flow) — deferred (not in Wave 2 brief).

Conflicts surfaced:
- Brief said "real SP-API Customer Messaging webhook in Wave 3 polish; for now, accept fixture or simulated webhook payload" — dossier §10 confirms Customer Messaging is OUTbound only (Solicitations + Messaging APIs both send-only). Inbound buyer messages reach sellers via the **Buyer-Seller Messaging API** (separate from Solicitations) which requires polling, not push. Wave 2 plan synthesizes the inbound webhook as our own internal convention; documents this in the dossier and the plan §3 (mismatch table item 3).
- Brief said "Wave 3 polish" — Wave 2 plan accepts this; doesn't try to wire real polling now.

Non-goals preserved:
- No SQS-polling worker.
- No EventBridge.
- No real LISTINGS PATCH writes (Repricer is propose-only forever; even post-Wave-3, the executor branches stay).
- No Solicitations send (review-request flow).
- No automated tests.
- No coupling to minicrew.
- No RLS changes.

---

## Delta Design

### Migration

```sql
-- supabase/migrations/20260504000003_wave2_pending_tables.sql
-- Phase 2 Wave 2 — pending_* tables for SP-API-driven executors.
-- All three mirror pending_listings (id, pharmacy_id, *_id, proposed_*, status,
-- audit_log_id FK, sp_api_*_id, *_at, created_at). Status enums kept simple:
-- pending → sent/published/applied → cancelled.

-- 1. pending_pricing_changes — Repricer's reprice_listing executor + Account Health's auto-pause via Repricer-shared executor.
create table pending_pricing_changes (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  decision text not null check (decision in ('match_bb', 'raise', 'drop', 'pause')),
  -- 'hold' is reserved for Wave 3 if Repricer ever proposes hold-with-undo.
  from_price numeric(10,2),
  to_price numeric(10,2),
  reasoning text,
  trigger text not null check (trigger in ('scheduled', 'event', 'manual')),
  status text not null check (status in ('pending', 'applied', 'cancelled')) default 'pending',
  audit_log_id uuid references audit_log(id),
  sp_api_submission_id text,                      -- null while stubbed; populated when SP-API patch lands
  applied_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index pending_pricing_changes_pharmacy_status_idx on pending_pricing_changes (pharmacy_id, status, created_at desc);
create index pending_pricing_changes_listing_idx on pending_pricing_changes (listing_id);

-- 2. pending_customer_messages — Customer Success's send_reply executor.
create table pending_customer_messages (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  amazon_order_id text,                            -- nullable until we wire real Messaging
  customer_message_id text,                        -- our internal id from the webhook payload
  channel text not null check (channel in ('amazon', 'ebay')) default 'amazon',
  proposed_text text not null,
  classification text not null check (classification in ('shipping', 'refund', 'general', 'medical_question', 'spam')),
  reasoning text,
  status text not null check (status in ('pending', 'sent', 'cancelled')) default 'pending',
  audit_log_id uuid references audit_log(id),
  sp_api_message_id text,                         -- null while stubbed
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index pending_customer_messages_pharmacy_status_idx on pending_customer_messages (pharmacy_id, status, created_at desc);

-- 3. pending_health_actions — Account Health's pause_listing + acknowledge_health_alert executors.
-- Note: pause_listing executor is shared with Repricer's `suspend` decision (both write here).
create table pending_health_actions (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  listing_id uuid references listings(id) on delete cascade,    -- nullable for non-listing-targeted health alerts
  action_kind text not null check (action_kind in ('pause_listing')),
  -- 'tighten_ship_buffer' and 'acknowledge' may be added in Wave 3 when corresponding executors land.
  triggered_by text not null check (triggered_by in ('account_health_red_auto', 'kaleem_click', 'repricer_suspend')),
  reasoning text,
  status text not null check (status in ('pending', 'applied', 'cancelled')) default 'pending',
  audit_log_id uuid references audit_log(id),
  sp_api_submission_id text,
  applied_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index pending_health_actions_pharmacy_status_idx on pending_health_actions (pharmacy_id, status, created_at desc);
create index pending_health_actions_listing_idx on pending_health_actions (listing_id) where listing_id is not null;
```

Notes:
- `sp_api_submission_id` is the post-Wave-3 swap slot: the real `putListingsItem` / `patchListingsItem` response includes a `submissionId` we'll persist.
- `pending_pricing_changes.decision = 'hold'` is **NOT** persisted — `hold` decisions emit a low-urgency briefing (per locked decision 11) with `proposed_actions = [dismiss_briefing only]` so no `pending_pricing_changes` row is ever written for `hold`. The check constraint enforces this; `hold` is reserved for Wave 3 if a hold-with-undo flow lands.
- `pending_health_actions.triggered_by = 'account_health_red_auto'` distinguishes Kaleem-clicked pause from agent-initiated pause for the audit trail.

### SP-API client surface

`lib/sp-api/index.ts` exposes typed factory functions:

```ts
// lib/sp-api/index.ts
import { getRealListingsClient, getRealPricingClient, /* ... */ } from './_real';
import { getFixtureListingsClient, getFixturePricingClient, /* ... */ } from './_fixtures';

const credsPresent = (): boolean =>
  !!process.env.SP_API_REFRESH_TOKEN &&
  !!process.env.LWA_CLIENT_ID &&
  !!process.env.LWA_CLIENT_SECRET;

export const getListingsClient = () => credsPresent() ? getRealListingsClient() : getFixtureListingsClient();
export const getPricingClient = () => credsPresent() ? getRealPricingClient() : getFixturePricingClient();
export const getReportsClient = () => credsPresent() ? getRealReportsClient() : getFixtureReportsClient();
export const getNotificationsClient = () => credsPresent() ? getRealNotificationsClient() : getFixtureNotificationsClient();
export const getMessagingClient = () => credsPresent() ? getRealMessagingClient() : getFixtureMessagingClient();
```

`lib/sp-api/auth.ts`:

```ts
// LWA refresh-token flow with single-process bearer cache.
import { logger } from '@/lib/logger'; // optional Sentry
let cached: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

export async function getLwaAccessToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.token; // 60s safety
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: process.env.SP_API_REFRESH_TOKEN!,
        client_id: process.env.LWA_CLIENT_ID!,
        client_secret: process.env.LWA_CLIENT_SECRET!,
      }).toString(),
    });
    if (!res.ok) throw new Error(`LWA refresh failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    inFlight = null;
    return body.access_token;
  })();
  return inFlight;
}
```

`lib/sp-api/client.ts`:

```ts
// Fetch wrapper with retry/backoff. 4xx (except 429) → throw immediately. 429/5xx → exp-backoff, max 5 retries.
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
      if (attempt >= 5) throw new Error(`SP-API ${path} ${res.status} after 5 retries`);
      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 200, 30_000);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
      continue;
    }
    throw new Error(`SP-API ${path} ${res.status}: ${await res.text()}`);
  }
}
```

`lib/sp-api/pricing.ts` (excerpt — the killer API):

```ts
import { spFetch } from './client';
import type { FoepBatchRequest, FoepBatchResponse } from './types';

export interface PricingClient {
  getFeaturedOfferExpectedPriceBatch(req: FoepBatchRequest): Promise<FoepBatchResponse>;
  getCompetitiveSummary(req: CompetitiveSummaryBatchRequest): Promise<CompetitiveSummaryBatchResponse>;
}

export const getRealPricingClient = (): PricingClient => ({
  async getFeaturedOfferExpectedPriceBatch(req) {
    // Pricing client handles 20-SKU chunking + 30s inter-chunk sleep automatically.
    const CHUNK_SIZE = 20;
    const SLEEP_MS = 30_000;
    const chunks: typeof req.requests[] = [];
    for (let i = 0; i < req.requests.length; i += CHUNK_SIZE) {
      chunks.push(req.requests.slice(i, i + CHUNK_SIZE));
    }
    const responses = [];
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, SLEEP_MS));
      const chunkResp = await spFetch<FoepBatchResponse>('/batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice', {
        method: 'POST',
        body: JSON.stringify({ requests: chunks[i] }),
      });
      responses.push(...chunkResp.responses);
    }
    return { responses };
  },
  async getCompetitiveSummary(req) {
    return spFetch<CompetitiveSummaryBatchResponse>('/batches/products/pricing/2022-05-01/items/competitiveSummary', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },
});
```

`lib/sp-api/_fixtures.ts` (loader):

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function loadFixture<T>(operationId: string): T {
  const p = path.resolve(process.cwd(), 'vendor/sp-api-fixtures', `${operationId}.json`);
  const raw = JSON.parse(readFileSync(p, 'utf8')) as { examples: Array<{ response: { body: T } }> };
  return raw.examples[0].response.body;
}

export const getFixturePricingClient = (): PricingClient => ({
  async getFeaturedOfferExpectedPriceBatch(req) {
    // Fixture is a single static example; per-listing variation gets synthesized below.
    const base = loadFixture<FoepBatchResponse>('getFeaturedOfferExpectedPriceBatch');
    // Echo back requests with synthesized prices so each per-listing run has unique data.
    return {
      responses: req.requests.map((r, i) => ({
        ...base.responses[0],
        body: {
          ...base.responses[0].body,
          offerIdentifier: { marketplaceId: r.marketplaceId, sku: r.sku },
          featuredOfferExpectedPriceResults: [{
            featuredOfferExpectedPrice: { listingPrice: { currencyCode: 'USD', amount: 19.99 - i * 0.5 } },
            resultStatus: 'VALID_FOEP',
          }],
        },
      })),
    };
  },
  // ...
});
```

### Twilio SMS client

```ts
// lib/sms/twilio.ts
import twilio from 'twilio';

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  if (!client) client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client;
}

export async function sendSms(body: string): Promise<{ sent: boolean; sid?: string; reason?: string }> {
  const c = getClient();
  if (!c) {
    console.log(`[sms-stub] would send: ${body}`);
    return { sent: false, reason: 'twilio-creds-missing' };
  }
  if (!process.env.KALEEM_SMS_NUMBER || !process.env.TWILIO_FROM_NUMBER) {
    console.log(`[sms-stub] would send (missing TO/FROM): ${body}`);
    return { sent: false, reason: 'phone-numbers-missing' };
  }
  try {
    const msg = await c.messages.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to: process.env.KALEEM_SMS_NUMBER,
      body,
    });
    return { sent: true, sid: msg.sid };
  } catch (err) {
    console.warn('[sms] Twilio send failed:', err instanceof Error ? err.message : err);
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
```

### Webhook route

```ts
// app/api/sp-api/webhook/route.ts
// Accepts SP-API NotificationEnvelope JSON shape (per dossier §5.5) — agnostic to
// upstream relay (SQS, EventBridge, or direct curl test). HMAC-verified via
// SP_API_WEBHOOK_SECRET. Routes to the right agent runner.

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { runRepricer } from '@/lib/agents/repricer';
import { runAccountHealth } from '@/lib/agents/account-health';
import { runCustomerSuccess } from '@/lib/agents/customer-success';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type NotificationEnvelope = {
  NotificationVersion: '1.0';
  NotificationType: string;
  PayloadVersion: '1.0';
  EventTime: string;
  Payload: Record<string, unknown>;
  NotificationMetadata: { ApplicationId: string; SubscriptionId: string; PublishTime: string; NotificationId: string };
};

function verifyHmac(rawBody: string, signature: string | null): boolean {
  if (!signature || !process.env.SP_API_WEBHOOK_SECRET) return false;
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', process.env.SP_API_WEBHOOK_SECRET).update(rawBody).digest('hex');
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig = req.headers.get('x-pharm1-signature');
  if (!verifyHmac(rawBody, sig)) {
    return NextResponse.json({ error: 'invalid-signature' }, { status: 401 });
  }

  let env: NotificationEnvelope;
  try { env = JSON.parse(rawBody) as NotificationEnvelope; }
  catch { return NextResponse.json({ error: 'invalid-json' }, { status: 400 }); }

  const supabase = createAdminClient();

  try {
    switch (env.NotificationType) {
      case 'ANY_OFFER_CHANGED':
      case 'LISTINGS_ITEM_MFN_QUANTITY_CHANGE':
        await runRepricer(supabase, { trigger: 'event', event: env });
        break;
      case 'ACCOUNT_STATUS_CHANGED':
      case 'LISTINGS_ITEM_ISSUES_CHANGE':
      case 'LISTINGS_ITEM_STATUS_CHANGE':
        await runAccountHealth(supabase, { trigger: 'event', event: env });
        break;
      case 'CUSTOMER_MESSAGE_RECEIVED': // our own convention; see §3 mismatch table
        await runCustomerSuccess(supabase, { trigger: 'webhook', event: env });
        break;
      default:
        console.warn('[sp-api-webhook] unrouted NotificationType:', env.NotificationType);
    }
  } catch (err) {
    console.error('[sp-api-webhook] handler failed:', err);
    return NextResponse.json({ error: 'handler-failed', detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, notification_id: env.NotificationMetadata.NotificationId });
}
```

### Executors

#### `reprice_listing` (kind: `reprice`)

```ts
// lib/executors/reprice-listing.ts
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const Params = z.object({
  listing_id: z.string().uuid(),
  decision: z.enum(['match_bb', 'raise', 'drop']),
  from_price: z.number().nonnegative().nullable(),
  to_price: z.number().nonnegative().nullable(),
  reasoning: z.string().max(2000).optional(),
  trigger: z.enum(['scheduled', 'event', 'manual']).default('manual'),
});

export const repriceListing: Executor = {
  kind: 'reprice',
  async forward(params, ctx): Promise<ExecutorResult> {
    const v = Params.parse(params);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('pending_pricing_changes')
      .insert({
        pharmacy_id: ctx.pharmacyId,
        listing_id: v.listing_id,
        decision: v.decision,
        from_price: v.from_price,
        to_price: v.to_price,
        reasoning: v.reasoning ?? null,
        trigger: v.trigger,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`reprice.forward: ${error?.message}`);
    console.log(`[STUB] would call SP-API patchListingsItem for listing ${v.listing_id} -> $${v.to_price}`);
    return { pending_pricing_change_id: data.id };
  },
  async reverse(_params, forwardResult): Promise<ExecutorResult> {
    const id = forwardResult.pending_pricing_change_id;
    if (typeof id !== 'string') return { reverted: false, reason: 'missing pending_pricing_change_id' };
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('pending_pricing_changes')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`reprice.reverse: ${error.message}`);
    return { reverted: true, pending_pricing_change_id: id };
  },
};
```

#### `pause_listing` (kind: `pause_listing`)

```ts
// lib/executors/pause-listing.ts
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const Params = z.object({
  listing_id: z.string().uuid(),
  triggered_by: z.enum(['account_health_red_auto', 'kaleem_click', 'repricer_suspend']),
  reasoning: z.string().max(2000).optional(),
});

export const pauseListing: Executor = {
  kind: 'pause_listing',
  async forward(params, ctx): Promise<ExecutorResult> {
    const v = Params.parse(params);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('pending_health_actions')
      .insert({
        pharmacy_id: ctx.pharmacyId,
        listing_id: v.listing_id,
        action_kind: 'pause_listing',
        triggered_by: v.triggered_by,
        reasoning: v.reasoning ?? null,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`pause_listing.forward: ${error?.message}`);
    console.log(`[STUB] would call SP-API patchListingsItem (pause) for listing ${v.listing_id}`);
    return { pending_health_action_id: data.id };
  },
  async reverse(_params, forwardResult): Promise<ExecutorResult> {
    const id = forwardResult.pending_health_action_id;
    if (typeof id !== 'string') return { reverted: false, reason: 'missing pending_health_action_id' };
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('pending_health_actions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`pause_listing.reverse: ${error.message}`);
    return { reverted: true, pending_health_action_id: id };
  },
};
```

#### `send_reply` (kind: `send_reply`)

```ts
// lib/executors/send-reply.ts
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const Params = z.object({
  customer_message_id: z.string(),                       // our internal id
  amazon_order_id: z.string().nullable(),
  channel: z.enum(['amazon', 'ebay']).default('amazon'),
  proposed_text: z.string().min(1).max(4000),
  classification: z.enum(['shipping', 'refund', 'general']),
  reasoning: z.string().max(2000).optional(),
});

export const sendReply: Executor = {
  kind: 'send_reply',
  async forward(params, ctx): Promise<ExecutorResult> {
    const v = Params.parse(params);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('pending_customer_messages')
      .insert({
        pharmacy_id: ctx.pharmacyId,
        amazon_order_id: v.amazon_order_id,
        customer_message_id: v.customer_message_id,
        channel: v.channel,
        proposed_text: v.proposed_text,
        classification: v.classification,
        reasoning: v.reasoning ?? null,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`send_reply.forward: ${error?.message}`);
    console.log(`[STUB] would call SP-API createConfirmDeliveryDetails (or appropriate Messaging endpoint) for order ${v.amazon_order_id}`);
    return { pending_customer_message_id: data.id };
  },
  async reverse(_params, forwardResult): Promise<ExecutorResult> {
    const id = forwardResult.pending_customer_message_id;
    if (typeof id !== 'string') return { reverted: false, reason: 'missing pending_customer_message_id' };
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('pending_customer_messages')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`send_reply.reverse: ${error.message}`);
    return { reverted: true, pending_customer_message_id: id };
  },
};
```

#### `acknowledge_health_alert` (kind: `acknowledge_health_alert`)

```ts
// lib/executors/acknowledge-health-alert.ts
// No-op forward + reverse. Records that Kaleem saw the alert. Useful for audit
// trail granularity (the kernel writes the audit_log row regardless).
import type { Executor } from './types';
export const acknowledgeHealthAlert: Executor = {
  kind: 'acknowledge_health_alert',
  async forward() { return { acknowledged: true }; },
  async reverse() { return { restored: true }; },
};
```

#### Registry update

```ts
// lib/executors/index.ts (modified)
import { listOnAmazon } from './list-on-amazon';
import { addToWatchlist } from './add-to-watchlist';
import { pauseBrand } from './pause-brand';
import { flagAnomaly } from './flag-anomaly';
import { dismissBriefing } from './dismiss-briefing';
import { repriceListing } from './reprice-listing';
import { pauseListing } from './pause-listing';
import { sendReply } from './send-reply';
import { acknowledgeHealthAlert } from './acknowledge-health-alert';
import { type Executor, UnknownExecutorError } from './types';

const registry: Record<string, Executor> = {
  list_on_amazon: listOnAmazon,
  add_to_watchlist: addToWatchlist,
  pause_brand: pauseBrand,
  flag_anomaly: flagAnomaly,
  dismiss_briefing: dismissBriefing,
  reprice: repriceListing,
  pause_listing: pauseListing,
  send_reply: sendReply,
  acknowledge_health_alert: acknowledgeHealthAlert,
};

export function getExecutor(kind: string): Executor {
  const ex = registry[kind];
  if (!ex) throw new UnknownExecutorError(kind);
  return ex;
}
export type { Executor, ExecutorContext, ExecutorResult } from './types';
export { UnknownExecutorError } from './types';
```

### Repricer agent

```ts
// lib/agents/repricer.ts
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import { openrouter } from '@/lib/llm';
import { recordLLMUsage } from '@/lib/budget';
import { AGENT_MODEL, DEFAULT_PHARMACY_ID, callAgentLLM, dailyBudgetGate, loadSkillPrompt, stripJsonFence } from './_shared';
import { getPricingClient } from '@/lib/sp-api';

const Decision = z.enum(['match_bb', 'hold', 'raise', 'drop', 'pause']);
const Output = z.object({
  listing_id: z.string().uuid(),
  decision: Decision,
  current_price: z.number().nullable(),
  proposed_price: z.number().nullable(),
  margin_pct: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  signals_used: z.array(z.string()).optional(),
});

type RunOpts = { pharmacyId?: string; trigger?: 'scheduled' | 'event'; event?: unknown };

export async function runRepricer(supabase: SupabaseClient<Database>, opts: RunOpts = {}) {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;
  const trigger = opts.trigger ?? 'scheduled';

  const gate = await dailyBudgetGate(supabase, 'repricer');
  if (gate.capped) return { proposed: 0, capped: true };

  // 1. Pull active listings on watching products.
  let listingsQuery = supabase
    .from('listings')
    .select('id, product_id, platform, platform_listing_id, status, current_price, current_source_supplier, current_source_cost, products!inner(id, name, asin, upc, ndc, brand, watchlist_status, pharmacy_id)')
    .eq('status', 'active')
    .eq('platform', 'amazon')
    .eq('products.watchlist_status', 'watching')
    .eq('products.pharmacy_id', pharmacyId);

  // Event-driven: scope to the ASIN in the envelope.
  if (trigger === 'event' && opts.event) {
    const env = opts.event as { Payload?: { AnyOfferChangedNotification?: { OfferChangeTrigger?: { ASIN?: string } } } };
    const asin = env.Payload?.AnyOfferChangedNotification?.OfferChangeTrigger?.ASIN;
    if (asin) {
      // We need to scope listings filter via the products.asin relationship.
      // Postgrest doesn't allow joined filter on a related table column AND root-level eq simultaneously
      // for non-inner; the !inner above does. Add the asin filter:
      listingsQuery = listingsQuery.eq('products.asin', asin);
    }
  }

  const { data: listings, error: lErr } = await listingsQuery.limit(30);
  if (lErr) throw new Error(`[repricer] listings query failed: ${lErr.message}`);
  if (!listings || listings.length === 0) {
    console.log('[repricer] no listings to evaluate');
    return { proposed: 0, capped: false };
  }

  // 2. Pull FOEP / competitive summary in batches of 20.
  // Pricing client handles 20-SKU chunking + 30s inter-chunk sleep automatically.
  const pricingClient = getPricingClient();
  const skuList = listings.map((l) => ({ sku: l.platform_listing_id ?? `synthetic-${l.id}`, marketplaceId: process.env.SP_API_MARKETPLACE_ID ?? 'ATVPDKIKX0DER' }));
  const foepReq = {
    requests: skuList.map((s) => ({ method: 'POST' as const, uri: '/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice', marketplaceId: s.marketplaceId, sku: s.sku })),
  };
  const foepResp = await pricingClient.getFeaturedOfferExpectedPriceBatch(foepReq);

  // 3. Pull preferences.
  const { data: prefMem } = await supabase
    .from('memory')
    .select('metadata')
    .eq('pharmacy_id', pharmacyId)
    .eq('kind', 'preferences')
    .eq('source', 'kaleem')
    .limit(1)
    .maybeSingle();
  const preferences = (prefMem?.metadata as Record<string, unknown> | null) ?? {
    min_margin_floor_pct: 25,
    max_scarcity_premium_pct: 300,
    risk_tolerance: 'conservative',
  };

  const skill = await loadSkillPrompt('repricer');
  let proposed = 0;

  // 4. Per-listing LLM call.
  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    const foepEntry = foepResp.responses[i]?.body;

    // Stock snapshots (best-effort).
    const { data: stockSnaps } = await supabase
      .from('wholesaler_stock_snapshots')
      .select('supplier, stock_qty, price, captured_at')
      .eq('product_id', (listing as any).products.id)
      .order('captured_at', { ascending: false })
      .limit(10);

    const userPayload = {
      listing: {
        id: listing.id,
        platform: listing.platform,
        sku: listing.platform_listing_id,
        current_price: listing.current_price,
        current_source_supplier: listing.current_source_supplier,
        current_source_cost: listing.current_source_cost,
      },
      product: (listing as any).products,
      foep: foepEntry,
      stock_snapshots: stockSnaps ?? [],
      preferences,
      trigger,
    };

    let completion;
    try {
      completion = await callAgentLLM(openrouter, {
        model: AGENT_MODEL,
        reasoningEffort: 'medium',
        systemPrompt: skill,
        userPayload,
      });
    } catch (err) {
      console.warn(`[repricer] LLM call failed for listing ${listing.id}:`, err instanceof Error ? err.message : err);
      continue;
    }
    await recordLLMUsage(supabase, null, completion);

    let parsed;
    try {
      parsed = Output.parse(JSON.parse(stripJsonFence(completion.choices[0]?.message?.content ?? '{}')));
    } catch (err) {
      console.warn(`[repricer] could not parse output for listing ${listing.id}:`, err instanceof Error ? err.message : err);
      continue;
    }

    // 5. Map decision → briefing_type + proposed_actions (output adapter).
    const { briefing_type, proposed_actions } = mapDecisionToBriefing(parsed, listing.id, listing.platform);

    const summary = parsed.decision === 'hold'
      ? `Hold ${listing.platform_listing_id}: ${parsed.rationale.slice(0, 120)}`
      : parsed.decision === 'pause'
        ? `Suspend ${listing.platform_listing_id}: margin would drop below floor`
        : `${parsed.decision === 'match_bb' || parsed.decision === 'drop' ? 'Drop' : 'Raise'} ${listing.platform_listing_id} from $${parsed.current_price ?? '—'} to $${parsed.proposed_price ?? '—'}`;

    const { data: briefing, error: bErr } = await supabase
      .from('briefings')
      .insert({
        pharmacy_id: pharmacyId,
        source_agent: 'repricer',
        briefing_type,
        title: summary,
        summary,
        rationale: parsed.rationale,
        confidence: parsed.confidence,
        urgency: parsed.decision === 'pause' ? 4 : 3,
        related_entity_type: 'listings',
        related_entity_id: listing.id,
        proposed_actions: proposed_actions as Json,
        data_snapshot: {
          kind: 'reprice_decision',
          decision: parsed.decision,
          foep: foepEntry ?? null,
          stock_snapshots: stockSnaps ?? [],
          trigger,
        } as Json,
      })
      .select('id')
      .single();
    if (bErr || !briefing) {
      console.warn(`[repricer] briefing insert failed for listing ${listing.id}:`, bErr?.message);
      continue;
    }

    await supabase.from('inbox_items').insert({
      pharmacy_id: pharmacyId,
      briefing_id: briefing.id,
      state: 'pending',
    });
    proposed++;
  }

  return { proposed, capped: false };
}

// see lib/agents/repricer-output-adapter.ts
function mapDecisionToBriefing(parsed: z.infer<typeof Output>, listingId: string, platform: string) {
  // implementation in repricer-output-adapter.ts
  // returns { briefing_type, proposed_actions: Json }
  // ...
  return { briefing_type: 'reprice_down' as const, proposed_actions: [] as Json };
}
```

`lib/agents/repricer-output-adapter.ts` returns the right `briefing_type` and `proposed_actions`:
- `match_bb` / `drop` → `briefing_type='reprice_down'`, action `{ kind: 'reprice', label: \`Drop to $${to}\`, params }`.
- `raise` → `briefing_type='reprice_up'`, action `{ kind: 'reprice', label: \`Raise to $${to}\`, params }`.
- `hold` → `briefing_type='reprice_down'` (closest enum match), `proposed_actions = [{ kind: 'dismiss_briefing', label: 'Acknowledge', variant: 'secondary' }]`. Urgency 1.
- `pause` → `briefing_type='suspend'`, action `{ kind: 'pause_listing', label: 'Suspend listing', variant: 'primary', params: { listing_id, triggered_by: 'repricer_suspend', reasoning: parsed.rationale } }`. Plus a secondary `dismiss_briefing` "Skip" action.

### Account Health agent

```ts
// lib/agents/account-health.ts
// Daily 6am UTC + on-event from ACCOUNT_STATUS_CHANGED.
// Reads GET_V1_SELLER_PERFORMANCE_REPORT (real or fixture), parses metrics,
// classifies status, branches on green/yellow/red. Red branch auto-fires
// pause_listing executor for contributing listings + sends Twilio SMS.

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import { openrouter } from '@/lib/llm';
import { recordLLMUsage } from '@/lib/budget';
import { AGENT_MODEL, DEFAULT_PHARMACY_ID, callAgentLLM, dailyBudgetGate, loadSkillPrompt, stripJsonFence } from './_shared';
import { getReportsClient } from '@/lib/sp-api';
import { sendSms } from '@/lib/sms/twilio';
import { pauseListing } from '@/lib/executors/pause-listing';
import { classifyStatus, type HealthMetricsSnapshot } from './account-health-status-classifier';

const Output = z.object({
  status: z.enum(['green', 'yellow', 'red']),
  metrics: z.record(z.number()),
  contributing_listing_ids: z.array(z.string().uuid()).optional(),
  proposed_corrective_actions: z.array(z.object({
    kind: z.string(),
    label: z.string(),
    params: z.record(z.unknown()),
  })).optional(),
  reasoning: z.string(),
});

export async function runAccountHealth(supabase: SupabaseClient<Database>, opts: { pharmacyId?: string; trigger?: 'scheduled' | 'event'; event?: unknown } = {}) {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;
  const trigger = opts.trigger ?? 'scheduled';

  const gate = await dailyBudgetGate(supabase, 'account-health');
  if (gate.capped) return { briefing_id: null, capped: true };

  // 1. Fetch latest performance report (real or fixture).
  const reports = getReportsClient();
  const performanceReport = await reports.fetchLatestSellerPerformance(pharmacyId);
  // Returns shape: { odr: number, late_ship_rate: number, cancellation_rate: number, vtr: number, buybox_pct: number, captured_at: string }

  // 2. Persist parsed metrics into health_metrics for trendline.
  const snap: HealthMetricsSnapshot = performanceReport;
  for (const [metric, value] of Object.entries({
    odr: snap.odr, late_ship: snap.late_ship_rate, cancellation: snap.cancellation_rate, vtr: snap.vtr, buybox_pct: snap.buybox_pct,
  })) {
    await supabase.from('health_metrics').insert({ pharmacy_id: pharmacyId, platform: 'amazon', metric, value });
  }

  // 3. Classify (deterministic — pure logic, no LLM).
  const status = classifyStatus(snap);

  // 4. Pull trailing 30-day trendline.
  const thirtyAgo = new Date(); thirtyAgo.setUTCDate(thirtyAgo.getUTCDate() - 30);
  const { data: trendline } = await supabase
    .from('health_metrics')
    .select('metric, value, captured_at')
    .eq('pharmacy_id', pharmacyId)
    .gte('captured_at', thirtyAgo.toISOString())
    .order('captured_at', { ascending: true });

  // 5. LLM call for narrative + proposed corrective actions (yellow only).
  const skill = await loadSkillPrompt('account-health');
  const userPayload = {
    pharmacy_id: pharmacyId,
    status,
    metrics: snap,
    trendline_30d: trendline ?? [],
    trigger,
    event: opts.event ?? null,
    note: status === 'green' ? 'Emit a no-op briefing only if trendline shows degradation.' : status === 'yellow' ? 'Propose corrective actions.' : 'Red — auto-pause path will fire after this LLM call.',
  };
  const completion = await callAgentLLM(openrouter, {
    model: AGENT_MODEL,
    reasoningEffort: 'medium',
    systemPrompt: skill,
    userPayload,
  });
  await recordLLMUsage(supabase, null, completion);
  const parsed = Output.parse(JSON.parse(stripJsonFence(completion.choices[0]?.message?.content ?? '{}')));

  // 6. Branch on status.
  let proposed_actions: Json = [];
  let urgency = 2;
  let autoPaused: string[] = [];
  let smsSent: { sent: boolean; sid?: string; reason?: string } | null = null;

  const MAX_AUTO_PAUSE = 5;
  if (status === 'red' && (parsed.contributing_listing_ids ?? []).length > MAX_AUTO_PAUSE) {
    urgency = 5;
    smsSent = await sendSms(`PHARMADASH ALERT: Red status, ${parsed.contributing_listing_ids?.length} listings affected — too many for auto-pause. Open inbox.`);
    autoPaused = []; // skip the loop per locked decision 21
    proposed_actions = [
      { kind: 'acknowledge_health_alert', label: 'Acknowledge alert', variant: 'primary', params: { skipped_auto_pause: true, contributing_count: parsed.contributing_listing_ids?.length ?? 0 } },
      { kind: 'dismiss_briefing', label: 'Dismiss', variant: 'secondary', params: {} },
    ] as Json;
  } else if (status === 'red') {
    urgency = 5;
    // 6a. Auto-pause contributing listings via the kernel-executor (system actor).
    const contributingIds = parsed.contributing_listing_ids ?? [];
    for (const lid of contributingIds) {
      try {
        const result = await pauseListing.forward({
          listing_id: lid,
          triggered_by: 'account_health_red_auto',
          reasoning: parsed.reasoning,
        }, { pharmacyId, userId: 'system:account_health' });
        // Write audit_log row marking the auto-action.
        const undoExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await supabase.from('audit_log').insert({
          pharmacy_id: pharmacyId,
          actor: 'system:account_health',
          action: 'pause_listing',
          target_entity_type: 'listings',
          target_entity_id: lid,
          params: { listing_id: lid, triggered_by: 'account_health_red_auto', reasoning: parsed.reasoning } as Json,
          result: result as Json,
          undo_window_expires_at: undoExpiry,
        });
        autoPaused.push(lid);
      } catch (err) {
        console.warn(`[account-health] auto-pause failed for ${lid}:`, err instanceof Error ? err.message : err);
      }
    }
    // 6b. Twilio SMS.
    smsSent = await sendSms(`PHARMADASH ALERT: Account health RED. ${autoPaused.length} listings auto-paused. Open inbox to acknowledge.`);
    // 6c. Briefing has acknowledge_health_alert proposed action.
    proposed_actions = [
      { kind: 'acknowledge_health_alert', label: 'Acknowledge alert', variant: 'primary', params: { auto_paused_ids: autoPaused } },
      { kind: 'dismiss_briefing', label: 'Dismiss', variant: 'secondary', params: {} },
    ] as Json;
  } else if (status === 'yellow') {
    urgency = 3;
    // Propose corrective actions; map to executor kinds the runtime knows.
    const mapped = (parsed.proposed_corrective_actions ?? []).map((a, i) => {
      // Only `pause_listing` is a real kernel kind for Wave 2. Others are informational (no executor).
      if (a.kind === 'pause_listing') {
        return { kind: 'pause_listing', label: a.label, variant: i === 0 ? 'primary' : 'secondary', params: { ...a.params, triggered_by: 'kaleem_click', reasoning: parsed.reasoning } };
      }
      return null; // informational only, captured in data_snapshot
    }).filter(Boolean);
    proposed_actions = (mapped.length > 0 ? mapped : [{ kind: 'dismiss_briefing', label: 'Acknowledge', variant: 'secondary', params: {} }]) as Json;
  } else {
    // Green: reject-only briefing (Acknowledge).
    urgency = 2;
    proposed_actions = [] as Json;
  }

  const { data: briefing, error } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: pharmacyId,
      source_agent: 'account_health',
      briefing_type: 'account_health',
      title: `Account health: ${status.toUpperCase()}`,
      summary: `${status.toUpperCase()} — ODR ${snap.odr.toFixed(3)}, Late ship ${(snap.late_ship_rate * 100).toFixed(1)}%, Cancel ${(snap.cancellation_rate * 100).toFixed(1)}%, VTR ${(snap.vtr * 100).toFixed(0)}%, BuyBox ${(snap.buybox_pct * 100).toFixed(0)}%.`,
      rationale: parsed.reasoning,
      confidence: 0.9,
      urgency,
      proposed_actions,
      data_snapshot: {
        kind: 'account_health_snapshot',
        status,
        metrics: snap,
        trigger,
        auto_paused_listings: autoPaused,
        sms: smsSent,
        unmapped_corrective_actions: (parsed.proposed_corrective_actions ?? []).filter((a) => a.kind !== 'pause_listing'),
      } as Json,
    })
    .select('id')
    .single();
  if (error || !briefing) throw new Error(`account-health briefing insert failed: ${error?.message}`);

  await supabase.from('inbox_items').insert({
    pharmacy_id: pharmacyId,
    briefing_id: briefing.id,
    state: 'pending',
  });

  return { briefing_id: briefing.id, capped: false, status, auto_paused_count: autoPaused.length, sms_sent: smsSent?.sent ?? false };
}
```

`lib/agents/account-health-status-classifier.ts`:

```ts
export type HealthMetricsSnapshot = {
  odr: number; late_ship_rate: number; cancellation_rate: number; vtr: number; buybox_pct: number; captured_at: string;
};
export function classifyStatus(s: HealthMetricsSnapshot): 'green' | 'yellow' | 'red' {
  // Per skill prompt thresholds:
  const odr = s.odr >= 0.02 ? 'red' : s.odr >= 0.01 ? 'yellow' : 'green';
  const late = s.late_ship_rate >= 0.10 ? 'red' : s.late_ship_rate >= 0.04 ? 'yellow' : 'green';
  const cancel = s.cancellation_rate >= 0.05 ? 'red' : s.cancellation_rate >= 0.025 ? 'yellow' : 'green';
  const vtr = s.vtr < 0.90 ? 'red' : s.vtr < 0.95 ? 'yellow' : 'green';
  const worst = [odr, late, cancel, vtr];
  if (worst.includes('red')) return 'red';
  if (worst.includes('yellow')) return 'yellow';
  return 'green';
}
```

### Customer Success agent

```ts
// lib/agents/customer-success.ts
// Webhook-driven (no cron). Two-stage: Triage (Haiku, fast classify) → Draft
// (Sonnet 4.6, voice-matched). Single briefing per inbound message.

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import { openrouter } from '@/lib/llm';
import { recordLLMUsage } from '@/lib/budget';
import { AGENT_MODEL, DEFAULT_PHARMACY_ID, callAgentLLM, dailyBudgetGate, loadSkillPrompt, stripJsonFence } from './_shared';
import { TriageOutputSchema, DraftOutputSchema } from './customer-success-output-schemas';

const HAIKU_MODEL = 'anthropic/claude-haiku-4.5';

type RunArgs = { trigger: 'webhook'; event: { Payload: { CustomerMessageReceivedNotification?: { Message?: { customer_message_id: string; amazon_order_id?: string | null; customer_text: string; channel: 'amazon' | 'ebay' } } } } };

export async function runCustomerSuccess(supabase: SupabaseClient<Database>, opts: { pharmacyId?: string } & RunArgs) {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;

  const gate = await dailyBudgetGate(supabase, 'customer-success');
  if (gate.capped) return { briefing_id: null, capped: true };

  const msg = opts.event.Payload.CustomerMessageReceivedNotification?.Message;
  if (!msg) return { briefing_id: null, capped: false, error: 'no message in payload' };

  // Stage 1 — Triage.
  const triageSkill = await loadSkillPrompt('customer-triage');
  const triagePayload = {
    message_id: msg.customer_message_id,
    customer_text: msg.customer_text,
    order_id: msg.amazon_order_id ?? null,
    pharmacy_id: pharmacyId,
  };
  const triageCompletion = await callAgentLLM(openrouter, {
    model: HAIKU_MODEL,
    reasoningEffort: 'low',
    systemPrompt: triageSkill,
    userPayload: triagePayload,
  });
  await recordLLMUsage(supabase, null, triageCompletion);
  const triage = TriageOutputSchema.parse(JSON.parse(stripJsonFence(triageCompletion.choices[0]?.message?.content ?? '{}')));

  // Spam → audit-only, no briefing.
  if (triage.classification === 'spam') {
    await supabase.from('audit_log').insert({
      pharmacy_id: pharmacyId,
      actor: 'system:customer_success',
      action: 'classify_spam',
      target_entity_type: 'customer_messages',
      target_entity_id: null,
      params: { customer_message_id: msg.customer_message_id, customer_text: msg.customer_text } as Json,
      result: { classification: 'spam' } as Json,
    });
    return { briefing_id: null, capped: false, classification: 'spam' };
  }

  // Stage 2 — Draft (skipped for medical_question).
  let draftText: string | null = null;
  let draftConfidence = 0.5;
  let draftReasoning = triage.reasoning;
  let proposed_actions: Json = [];

  if (triage.classification === 'medical_question') {
    proposed_actions = [
      { kind: 'dismiss_briefing', label: 'Acknowledge — I will reply personally', variant: 'primary', params: {} },
    ] as Json;
  } else {
    const draftSkill = await loadSkillPrompt('customer-draft');

    // Best-effort tone preference lookup. Wave 2 has no automated path that
    // writes memory rows with source='kaleem' kind='preferences', so the
    // fallback is the live default until Kaleem manually saves preferences
    // (Wave 3 may add a UI surface for this).
    const { data: prefMem } = await supabase
      .from('memory')
      .select('metadata')
      .eq('pharmacy_id', pharmacyId)
      .eq('kind', 'preferences')
      .eq('source', 'kaleem')
      .limit(1)
      .maybeSingle();
    const tonePrefs = (prefMem?.metadata as Record<string, unknown> | null) ?? {
      tone: 'warm-brief',
      sign_off: '— Kaleem',
    };

    const draftPayload = {
      message_id: msg.customer_message_id,
      classification: triage.classification,
      customer_text: msg.customer_text,
      order_context: null, // Wave 2: synthesize as null when amazon_order_id missing
      pharmacy_id: pharmacyId,
      tone_preferences: tonePrefs,
    };
    const draftCompletion = await callAgentLLM(openrouter, {
      model: AGENT_MODEL,
      reasoningEffort: 'medium',
      systemPrompt: draftSkill,
      userPayload: draftPayload,
    });
    await recordLLMUsage(supabase, null, draftCompletion);
    const draft = DraftOutputSchema.parse(JSON.parse(stripJsonFence(draftCompletion.choices[0]?.message?.content ?? '{}')));
    draftText = draft.draft;
    draftConfidence = draft.confidence;
    draftReasoning = draft.reasoning;

    proposed_actions = [
      {
        kind: 'send_reply',
        label: 'Send reply',
        variant: 'primary',
        params: {
          customer_message_id: msg.customer_message_id,
          amazon_order_id: msg.amazon_order_id ?? null,
          channel: msg.channel,
          proposed_text: draftText,
          classification: triage.classification,
          reasoning: draft.reasoning,
        },
      },
      { kind: 'dismiss_briefing', label: 'Skip', variant: 'secondary', params: {} },
    ] as Json;
  }

  // 3. Insert single briefing.
  const urgency = triage.classification === 'medical_question' ? 5 : triage.classification === 'refund' ? 4 : 3;
  const summaryPrefix = triage.classification === 'medical_question' ? 'Medical question — reply personally' : `Customer ${triage.classification}`;

  const { data: briefing, error } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: pharmacyId,
      source_agent: 'customer_success',
      briefing_type: 'customer_message',
      title: summaryPrefix,
      summary: msg.customer_text.slice(0, 200),
      rationale: draftReasoning,
      confidence: draftConfidence,
      urgency,
      proposed_actions,
      data_snapshot: {
        kind: 'customer_message',
        classification: triage.classification,
        customer_text: msg.customer_text,
        order_id: msg.amazon_order_id ?? null,
        channel: msg.channel,
        triage_reasoning: triage.reasoning,
        draft: draftText,
      } as Json,
    })
    .select('id')
    .single();
  if (error || !briefing) throw new Error(`customer-success briefing insert failed: ${error?.message}`);

  await supabase.from('inbox_items').insert({
    pharmacy_id: pharmacyId,
    briefing_id: briefing.id,
    state: 'pending',
  });

  return { briefing_id: briefing.id, capped: false, classification: triage.classification, draft: !!draftText };
}
```

### Customer Success Output Schemas

```ts
// lib/agents/customer-success-output-schemas.ts
import { z } from 'zod';

export const TriageOutputSchema = z.object({
  classification: z.enum(['shipping', 'refund', 'general', 'medical_question', 'spam']),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});
export type TriageOutput = z.infer<typeof TriageOutputSchema>;

export const DraftOutputSchema = z.object({
  draft: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
export type DraftOutput = z.infer<typeof DraftOutputSchema>;
```

### Cron entries

```ts
// scripts/repricer.ts
import { createAdminClient } from '@/lib/supabase/admin';
import { runRepricer } from '@/lib/agents/repricer';
async function main() {
  const supabase = createAdminClient();
  const r = await runRepricer(supabase, { trigger: 'scheduled' });
  console.log(`[repricer] done — proposed=${r.proposed} capped=${r.capped}`);
}
main().catch((e) => { console.error('[repricer] fatal:', e); process.exit(1); });

// scripts/account-health.ts (analogous shape)
import { createAdminClient } from '@/lib/supabase/admin';
import { runAccountHealth } from '@/lib/agents/account-health';
async function main() {
  const supabase = createAdminClient();
  const r = await runAccountHealth(supabase, { trigger: 'scheduled' });
  console.log(`[account-health] done — briefing_id=${r.briefing_id} status=${r.status} auto_paused=${r.auto_paused_count} sms=${r.sms_sent} capped=${r.capped}`);
}
main().catch((e) => { console.error('[account-health] fatal:', e); process.exit(1); });
```

`scripts/customer-success-test.ts` is a one-shot dry-run: loads `vendor/sp-api-fixtures/notification-customer-message-received.json`, posts to `runCustomerSuccess` directly, prints result.

`scripts/extract-sp-api-fixtures.ts` walks a curated list of OpenAPI model URLs (raw GitHub), downloads each, scans for `x-amzn-api-sandbox.static[]`, writes per-operation files into `vendor/sp-api-fixtures/`. For Notification envelopes (which aren't in the OpenAPI specs), it synthesizes from the dossier's §5.5 example. List of operations to extract:
- `getListingsItem`, `putListingsItem`, `patchListingsItem`
- `getCompetitiveSummary`, `getFeaturedOfferExpectedPriceBatch`
- `createSubscription`, `createDestination`
- `createReport`, `getReport`, `getReportDocument`
- `createConfirmDeliveryDetails` (Solicitations API)

### `.env.example` additions

```
# --- Wave 2: Amazon SP-API ---
# Login With Amazon (LWA) credentials from Seller Central → Develop Apps.
LWA_CLIENT_ID=
LWA_CLIENT_SECRET=

# Long-lived refresh token captured during self-authorization or OAuth.
# When unset, lib/sp-api falls back to fixture data in vendor/sp-api-fixtures/.
SP_API_REFRESH_TOKEN=

# Region: na | eu | fe | sandbox_na (default na).
SP_API_REGION=na

# US marketplace by default. Kaleem currently sells US only.
SP_API_MARKETPLACE_ID=ATVPDKIKX0DER

# Amazon merchant token (the seller_id in URL paths).
SP_API_SELLER_ID=

# HMAC secret used to verify inbound /api/sp-api/webhook POSTs.
# Generate locally with: openssl rand -hex 32
SP_API_WEBHOOK_SECRET=

# --- Wave 2: Twilio SMS (Account Health red-alert) ---
# When unset, sendSms() logs to console instead of dialing.
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
KALEEM_SMS_NUMBER=
```

### `render.yaml` — 2 new cron services + 11 new env vars

```yaml
  # --- Repricer (Phase 2 Wave 2 — twice-daily reprice sweep) ---
  - type: cron
    name: pharm1-repricer
    runtime: node
    plan: starter
    region: oregon
    buildCommand: npm ci
    schedule: "0 14,2 * * *"   # 14:00 UTC + 02:00 UTC; staggered 1 hour from listing-agent's 13:00 UTC slot to avoid back-to-back serial execution on Render
    startCommand: npm run agent:repricer
    envVars:
      - fromGroup: pharm1-shared

  # --- Account Health (Phase 2 Wave 2 — daily 6am UTC; auto-pause on red) ---
  - type: cron
    name: pharm1-account-health
    runtime: node
    plan: starter
    region: oregon
    buildCommand: npm ci
    schedule: "0 6 * * *"
    startCommand: npm run agent:account-health
    envVars:
      - fromGroup: pharm1-shared

# --- envVarGroup additions ---
envVarGroups:
  - name: pharm1-shared
    envVars:
      # ... existing 19 vars ...
      - key: LWA_CLIENT_ID
        sync: false
      - key: LWA_CLIENT_SECRET
        sync: false
      - key: SP_API_REFRESH_TOKEN
        sync: false
      - key: SP_API_REGION
        value: "na"
      - key: SP_API_MARKETPLACE_ID
        value: "ATVPDKIKX0DER"
      - key: SP_API_SELLER_ID
        sync: false
      - key: SP_API_WEBHOOK_SECRET
        sync: false
      - key: TWILIO_ACCOUNT_SID
        sync: false
      - key: TWILIO_AUTH_TOKEN
        sync: false
      - key: TWILIO_FROM_NUMBER
        sync: false
      - key: KALEEM_SMS_NUMBER
        sync: false
```

### `package.json` additions

```jsonc
"scripts": {
  ...
  "agent:repricer": "tsx scripts/repricer.ts",
  "agent:account-health": "tsx scripts/account-health.ts",
  "agent:cs-test": "tsx scripts/customer-success-test.ts",
  "fixtures:extract": "tsx scripts/extract-sp-api-fixtures.ts"
},
"dependencies": {
  ...
  "twilio": "^5.x"
}
```

### `.gitignore` addition

```
# Vendored SP-API OpenAPI models (downloaded by scripts/extract-sp-api-fixtures.ts).
# Only the *extracted fixtures* under vendor/sp-api-fixtures/ are committed.
vendor/sp-api-models/
```

### Cron schedule layout (UTC)

| Agent / Job | Schedule | Cadence | Notes |
|---|---|---|---|
| pharm1-listing-agent | `0 13 * * *` | Daily 13:00 UTC | Wave 1 carryover |
| **pharm1-repricer** | `0 14,2 * * *` | Twice-daily 14:00 + 02:00 UTC (staggered 1h after listing-agent) | NEW Wave 2 |
| **pharm1-account-health** | `0 6 * * *` | Daily 06:00 UTC | NEW Wave 2 |
| pharm1-bookkeeper | `0 23 * * *` | Daily 23:00 UTC | Wave 1 |
| pharm1-portfolio-manager | `0 7 * * 0` | Sun 07:00 UTC | Wave 1 |
| pharm1-reflector | `30 23 * * 0` | Sun 23:30 UTC | Wave 1 |
| pharm1-backup-weekly | `0 9 * * 0` | Sun 09:00 UTC | Phase 1 |
| pharm1-backup-restore-test | `0 10 1 * *` | 1st-of-month 10:00 | Phase 1 |

Repricer's 14:00 UTC slot is staggered 1 hour after Listing Agent (13:00 UTC) to avoid back-to-back serial execution on Render. Repricer's 02:00 UTC slot is uncontended.

---

## Architecture Overview

```
┌────────────────────────────────────┐    ┌────────────────────────────────────┐
│ Render Cron:                       │    │ Render Cron:                       │
│ pharm1-repricer                    │    │ pharm1-account-health              │
│ 2x daily (13 + 01 UTC)             │    │ daily 06 UTC                       │
└────────────┬───────────────────────┘    └─────────────────┬──────────────────┘
             │                                              │
             ▼                                              ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ scripts/{repricer,account-health}.ts → run<Agent>(supabase, {trigger:'scheduled'})│
└─────────────────────────────────────────┬────────────────────────────────────┘
                                          │
                                          │  also entered from:
                                          │
┌──────────────────────────────────────┐  │  ┌────────────────────────────────┐
│ POST /api/sp-api/webhook             │──┴─▶│ runCustomerSuccess /          │
│ (HMAC-verified NotificationEnvelope) │     │ runRepricer / runAccountHealth │
│ • ANY_OFFER_CHANGED → repricer        │     │ depending on NotificationType  │
│ • ACCOUNT_STATUS_CHANGED → health     │     └────────────────────────────────┘
│ • CUSTOMER_MESSAGE_RECEIVED → cs      │
└──────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ lib/agents/<name>.ts                                                          │
│  1. dailyBudgetGate (system spend)                                            │
│  2. lib/sp-api facade (real-or-fixture by SP_API_REFRESH_TOKEN)               │
│     • Repricer:        getPricingClient().getFeaturedOfferExpectedPriceBatch  │
│     • Account Health:  getReportsClient().fetchLatestSellerPerformance       │
│     • Customer Success: (no SP-API client; reads webhook payload directly)   │
│  3. callAgentLLM(skill, payload, reasoningEffort)                             │
│  4. recordLLMUsage                                                             │
│  5. Zod-parse output                                                           │
│  6. Output adapter → briefing_type + proposed_actions                         │
│  7. (Account Health red branch) auto-pause executor + Twilio SMS              │
│  8. INSERT briefings + inbox_items                                             │
└──────────────────────────────────────────┬───────────────────────────────────┘
                                           │
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Supabase: briefings + inbox_items + pending_* + audit_log + health_metrics    │
└──────────────────────────────────────────┬───────────────────────────────────┘
                                           │ SSR
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Inbox UI (app/page.tsx → Timeline). Wave 1 grouping by source_agent works    │
│ as-is; Repricer/Account Health/Customer Success cards render with correct    │
│ labels and reject-only / actionable buttons via existing isReportOnly flag.   │
└──────────────────────────────────────────┬───────────────────────────────────┘
                                           │ click Approve
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ POST /api/actions/approve (UNCHANGED)                                        │
│  → getExecutor(kind).forward(params, ctx)                                    │
│  Four new executors:                                                          │
│    • reprice_listing → pending_pricing_changes row (status='pending')         │
│    • pause_listing → pending_health_actions row                              │
│    • send_reply → pending_customer_messages row                              │
│    • acknowledge_health_alert → no-op (audit_log only)                       │
│  Audit_log row with 30-min undo window.                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Tasks

Implementation order. Each task is one commit-shaped unit.

### Phase A — Cleanups
1. **Confirm working tree clean.** `git status` should show no uncommitted changes from Wave 1. (If anything dangles, commit it as a separate hygiene commit before starting Wave 2.)
2. **Modify `.gitignore`** — append `vendor/sp-api-models/` (the OpenAPI source models, gitignored). The `vendor/sp-api-fixtures/` directory IS committed (extracted fixtures live there).

### Phase B — Schema migration
3. **Create** `supabase/migrations/20260504000003_wave2_pending_tables.sql` per Delta Design (3 tables + indexes).
4. **Apply migration** to cloud Supabase project `rvirlhrssgnbkjqhqjao` via Management API + curl + jq (per CLAUDE.local.md Seq 3 pattern).
5. **Regenerate types**: `supabase gen types typescript --local > lib/supabase/types.ts`. Commit.

### Phase C — Fixture extractor
6. **Create** `scripts/extract-sp-api-fixtures.ts`. Curates the ~10 operations listed in Delta Design. Downloads each model JSON from raw.githubusercontent.com into `vendor/sp-api-models/`. Extracts `x-amzn-api-sandbox.static[]` blocks. Synthesizes notification-envelope fixtures (`notification-any-offer-changed.json`, `notification-account-status-changed.json`, `notification-customer-message-received.json`, `seller-performance-report-sample.json`) from the dossier's documented shapes. Writes outputs to `vendor/sp-api-fixtures/`. Idempotent — running twice produces identical files.
7. **Run** `npm run fixtures:extract` once. Commit the resulting `vendor/sp-api-fixtures/*.json` files (~10 small files).
8. **Modify `package.json`** — add `fixtures:extract` script.

### Synthesized fixture shapes

Three notification envelopes don't exist in the OpenAPI sandbox blocks because they're either non-canonical or report-shaped. The fixture extractor must hand-write these from the shapes below.

**`vendor/sp-api-fixtures/notification-any-offer-changed.json`** (canonical SP-API shape):
```json
{
  "NotificationVersion": "1.0",
  "NotificationType": "ANY_OFFER_CHANGED",
  "PayloadVersion": "1.0",
  "EventTime": "2026-05-04T13:00:00.000Z",
  "Payload": {
    "AnyOfferChangedNotification": {
      "SellerId": "A1B2C3D4E5F6G7",
      "OfferChangeTrigger": {
        "MarketplaceId": "ATVPDKIKX0DER",
        "ASIN": "B00FIXTUREASIN",
        "ItemCondition": "new",
        "TimeOfOfferChange": "2026-05-04T12:59:50.000Z"
      },
      "Summary": {
        "NumberOfOffers": [{"OfferCount": 3, "condition": "new", "fulfillmentChannel": "Amazon"}],
        "BuyBoxPrices": [{"condition": "new", "LandedPrice": {"Amount": 19.99, "CurrencyCode": "USD"}, "ListingPrice": {"Amount": 19.99, "CurrencyCode": "USD"}, "Shipping": {"Amount": 0, "CurrencyCode": "USD"}}]
      }
    }
  },
  "NotificationMetadata": {
    "ApplicationId": "amzn1.sp.solution.fixture",
    "SubscriptionId": "fixture-subscription-id",
    "PublishTime": "2026-05-04T13:00:00.000Z",
    "NotificationId": "fixture-notif-aoc-001"
  }
}
```

**`vendor/sp-api-fixtures/notification-account-status-changed.json`** (canonical SP-API shape):
```json
{
  "NotificationVersion": "1.0",
  "NotificationType": "ACCOUNT_STATUS_CHANGED",
  "PayloadVersion": "1.0",
  "EventTime": "2026-05-04T06:00:00.000Z",
  "Payload": {
    "AccountStatusChangedNotification": {
      "AccountId": "A1B2C3D4E5F6G7",
      "MarketplaceId": "ATVPDKIKX0DER",
      "PreviousStatus": "NORMAL",
      "CurrentStatus": "AT_RISK",
      "ChangeTime": "2026-05-04T05:59:00.000Z"
    }
  },
  "NotificationMetadata": {
    "ApplicationId": "amzn1.sp.solution.fixture",
    "SubscriptionId": "fixture-subscription-id",
    "PublishTime": "2026-05-04T06:00:00.000Z",
    "NotificationId": "fixture-notif-asc-001"
  }
}
```

**`vendor/sp-api-fixtures/notification-customer-message-received.json`** (our convention; not canonical SP-API):
```json
{
  "NotificationVersion": "1.0",
  "NotificationType": "CUSTOMER_MESSAGE_RECEIVED",
  "PayloadVersion": "1.0",
  "EventTime": "2026-05-04T15:30:00.000Z",
  "Payload": {
    "CustomerMessageReceivedNotification": {
      "Message": {
        "customer_message_id": "fixture-msg-001",
        "amazon_order_id": "111-1234567-1234567",
        "customer_text": "Hi, when will my order ship? It's been 3 days.",
        "channel": "amazon"
      }
    }
  },
  "NotificationMetadata": {
    "ApplicationId": "pharm1.internal",
    "SubscriptionId": "fixture-subscription-id",
    "PublishTime": "2026-05-04T15:30:00.000Z",
    "NotificationId": "fixture-notif-cmr-001"
  }
}
```

**`vendor/sp-api-fixtures/seller-performance-report-sample.json`** (parsed shape returned by `fetchLatestSellerPerformance`):
```json
{
  "odr": 0.005,
  "late_ship_rate": 0.02,
  "cancellation_rate": 0.01,
  "vtr": 0.97,
  "buybox_pct": 0.75,
  "captured_at": "2026-05-04T05:00:00.000Z"
}
```

This is the green-status default. To force-test yellow: set `odr` to `0.015` (between 0.01 yellow threshold and 0.02 red). To force-test red: set `odr` to `0.025` and `contributing_listing_ids` would be populated by the agent's data_snapshot output (not by this fixture — it's the report parse target, not the LLM output).

### Phase D — SP-API client
9. **Create** `lib/sp-api/types.ts` with shared TS interfaces matching dossier shapes (FoepBatchRequest, FoepBatchResponse, CompetitiveSummaryBatchRequest/Response, ListingsItem, NotificationEnvelope, etc.). TypeScript shape for `NotificationEnvelope`: `NotificationType: string` (NOT a string-literal union — must accept both real SP-API types AND our convention `CUSTOMER_MESSAGE_RECEIVED`).
9b. **Modify** `lib/llm-pricing.ts` — register `anthropic/claude-haiku-4.5` (and any date-stamped echoes from OpenRouter response) with current per-million-token pricing. Run a probe call to verify the actual model slug OpenRouter returns; if the echo differs, add both entries.
10. **Create** `lib/sp-api/auth.ts` — LWA refresh-token cache + per-process mutex per Delta Design.
11. **Create** `lib/sp-api/client.ts` — fetch wrapper with retry/backoff per Delta Design.
12. **Create** `lib/sp-api/listings.ts` (real-mode getListingsItem/put/patch) + fixture-mode equivalents.
13. **Create** `lib/sp-api/pricing.ts` (real-mode getCompetitiveSummary + getFeaturedOfferExpectedPriceBatch) + fixture-mode (synthesizes per-SKU price variation from a single fixture base).
14. **Create** `lib/sp-api/notifications.ts` (createSubscription, createDestination — used in setup script not at runtime; fixture mode is a no-op).
15. **Create** `lib/sp-api/reports.ts` — exposes `fetchLatestSellerPerformance(pharmacyId)` which in real mode runs the full createReport→poll→getReportDocument→fetch presigned URL→parse cycle, in fixture mode loads the pre-synthesized fixture. Polling interval = 30s with exponential backoff capped at 2 min; max wait 12 min total; on FATAL/CANCELLED throw; if a prior report with status=DONE exists for this report_type within the last 6 hours, reuse it instead of calling createReport. ~80 LOC.
16. **Create** `lib/sp-api/messaging.ts` — fixture-only in Wave 2 (real mode is post-approval); exposes a stub for future wiring.
17. **Create** `lib/sp-api/_fixtures.ts` — `loadFixture<T>(operationId)` helper.
18. **Create** `lib/sp-api/index.ts` — public surface: `getListingsClient()`, `getPricingClient()`, `getReportsClient()`, `getNotificationsClient()`, `getMessagingClient()`.

### Phase E — Twilio SMS
19. **Install dependency**: `npm i twilio`. Commit lockfile.
20. **Create** `lib/sms/twilio.ts` per Delta Design.

### Phase F — Four new executors
21. **Create** `lib/executors/reprice-listing.ts` (kind: `reprice`).
22. **Create** `lib/executors/pause-listing.ts` (kind: `pause_listing`).
23. **Create** `lib/executors/send-reply.ts` (kind: `send_reply`).
24. **Create** `lib/executors/acknowledge-health-alert.ts` (kind: `acknowledge_health_alert`).
25. **Modify** `lib/executors/index.ts` — register all 4 new executors.

### Phase G — Repricer agent
26. **Create** `lib/agents/repricer-output-adapter.ts` — decision → briefing_type + proposed_actions mapper.
27. **Create** `lib/agents/repricer.ts` per Delta Design.
28. **Create** `scripts/repricer.ts` (cron entry).
29. **Modify** `package.json` — add `agent:repricer` script.

### Phase H — Account Health agent
30. **Create** `lib/agents/account-health-status-classifier.ts` (pure logic; classifies green/yellow/red per skill thresholds).
31. **Create** `lib/agents/account-health.ts` per Delta Design. Integrates SP-API reports client + status classifier + Twilio SMS + auto-pause via executor's forward (system actor).
32. **Create** `scripts/account-health.ts` (cron entry).
33. **Modify** `package.json` — add `agent:account-health` script.

### Phase I — Customer Success agent
34. **Create** `lib/agents/customer-success-output-schemas.ts` — Triage + Draft Zod schemas.
35. **Create** `lib/agents/customer-success.ts` per Delta Design — two-stage Triage→Draft.
36. **Create** `scripts/customer-success-test.ts` (one-shot dry-run loading fixture envelope).
37. **Modify** `package.json` — add `agent:cs-test` script.

### Phase J — Webhook route
38. **Create** `app/api/sp-api/webhook/route.ts` per Delta Design. HMAC verification + dispatch by NotificationType.

### Phase K — Inbox UI tweak
39. **Modify** `components/inbox/briefing-card.tsx:201-213` — extend `isReportOnly` flag to include `account_health` source_agent when `proposed_actions` is empty (green branch). Plus add label "Acknowledge alert" specifically for `account_health` red branch where the primary action is `acknowledge_health_alert` — but that's already a `proposed_action` with its own label. No additional change needed.

### Phase L — Render config + env vars
40. **Modify** `render.yaml` — add 2 new cron services (repricer twice-daily, account-health daily 6am) + 11 new envVarGroup entries (SP_API_*, LWA_*, TWILIO_*, KALEEM_SMS_NUMBER, SP_API_WEBHOOK_SECRET).
41. **Modify** `.env.example` — append the 11 new vars per Delta Design.

### Phase M — Verify
42. `npm run typecheck` passes.
43. `npm run lint` passes.
44. `npm run fixtures:extract` runs idempotently (no diff on second run).
45. **Local agent runs (against cloud Supabase, fixture mode):**
    - **45a.** `npm run agent:repricer` — produces ≥1 briefing (more if seed data has watching listings); each briefing has `source_agent='repricer'`, `briefing_type` in `{reprice_up, reprice_down, suspend}`, valid `proposed_actions`.
    - **45b.** `npm run agent:account-health` — produces 1 briefing with `data_snapshot.kind='account_health_snapshot'`, `status` ∈ {green, yellow, red}. In fixture mode the synthesized GET_V1_SELLER_PERFORMANCE_REPORT should yield green by default; force-red by editing the fixture for the manual click-through test.
    - **45c.** `npm run agent:cs-test` — loads fixture customer-message envelope, produces 1 briefing with `briefing_type='customer_message'`, `proposed_actions = [send_reply, dismiss_briefing]`.
    - **45d.** Repricer event-mode probe: with `SP_API_REFRESH_TOKEN` unset (fixture mode), invoke `runRepricer(supabase, { trigger: 'event', event: { Payload: { AnyOfferChangedNotification: { OfferChangeTrigger: { ASIN: '<seeded ASIN>' } } } } })` directly via `npx tsx -e '...'` and confirm exactly 1 listing returns from the inner-joined query. Drop the inline TODO comment in `lib/agents/repricer.ts` once verified.
    - **45e.** Set `SP_API_WEBHOOK_SECRET=$(openssl rand -hex 32)` in `.env.local` before running webhook smoke tests.
    - **45f. Haiku 4.5 reasoning support probe.** Before relying on Triage in production, run a one-shot probe via `npx tsx -e`:

      ```bash
      npx tsx -e '
      import { openrouter } from "./lib/llm";
      import { callAgentLLM } from "./lib/agents/_shared";
      (async () => {
        try {
          const c = await callAgentLLM(openrouter, {
            model: "anthropic/claude-haiku-4.5",
            reasoningEffort: "low",
            systemPrompt: "Reply with JSON: {\"ok\": true}",
            userPayload: {},
          });
          console.log("OK:", c.choices[0]?.message?.content);
        } catch (err) {
          console.error("FAIL:", err instanceof Error ? err.message : err);
          process.exit(1);
        }
      })();
      '
      ```

      If this returns `OK: {"ok": true}`, Haiku 4.5 supports the `reasoning` extension on OpenRouter — proceed.

      If it 4xx-rejects on the `reasoning` field, modify `lib/agents/_shared.ts.callAgentLLM` to skip the field when `args.model?.includes('haiku')`:

      ```ts
      const callBody: any = {
        model: args.model ?? AGENT_MODEL,
        messages: [...],
        response_format: { type: 'json_object' },
      };
      if (!args.model?.includes('haiku')) {
        callBody.reasoning = { effort: args.reasoningEffort ?? 'medium' };
      }
      return await openrouter.chat.completions.create(callBody as ChatCompletionCreateParamsNonStreaming);
      ```

      Document the probe outcome in CLAUDE.local.md's "Recent Activity" section.
46. **Webhook smoke test:**
    - Build a curl that posts a fixture `notification-any-offer-changed.json` envelope to `http://localhost:3000/api/sp-api/webhook` with HMAC signature header set via the local `SP_API_WEBHOOK_SECRET`. Confirm 200 OK + 1 new repricer briefing.
    - Repeat with `notification-account-status-changed.json` (force `status: 'AT_RISK'` for red path) — confirm 200 OK + 1 new account_health briefing + auto-paused listings rows in `pending_health_actions` + console log of Twilio stub send (or real SMS if creds set).
    - Repeat with `notification-customer-message-received.json` — confirm 200 OK + 1 new customer_success briefing.
    - Confirm 401 on a request with bad HMAC signature.
47. **Manual UI test on cloud (post-deploy):**
    - Sign in via dev-login. Confirm Inbox shows new agent sections.
    - Click Approve on a Repricer `match_bb` action → `pending_pricing_changes.status='pending'` row inserted; `audit_log` row written; UndoBanner appears; Undo flips row to `cancelled`.
    - Click Approve on an Account Health red-branch `acknowledge_health_alert` → no-op forward; audit_log written; Undo restores.
    - Click Approve on a Customer Success `send_reply` → `pending_customer_messages.status='pending'` inserted; Undo flips to cancelled.
    - Force yellow status by editing the seller-performance fixture (set ODR to 0.015); run `agent:account-health`; confirm `proposed_actions` contain `pause_listing`; click Approve on a yellow-branch `pause_listing`; confirm `pending_health_actions` row written with `triggered_by='kaleem_click'`.
48. **Render deploy**: push commit, confirm 2 new cron services appear in Blueprint, manually trigger each cron from Render UI, verify briefing rows in Supabase Studio. Confirm `pharm1-shared` env group has the 11 new entries (sync:false; values empty by design).

### Phase N — E2E Test Plan deliverable (per brief)

49. **Author** `tmp/ready-plans/2026-05-XX-comprehensive-e2e-test.md` (or as part of Wave 3 plan) — **out of scope for Wave 2 plan/implement**. The brief specifies this lands after Wave 3.

---

## Validation

### Automated
- `npm run typecheck` passes (TS strict).
- `npm run lint` passes.
- `supabase db reset` applies all 9 migrations cleanly.
- `npm run agent:repricer`, `agent:account-health`, `agent:cs-test` each exit 0.
- `npm run fixtures:extract` is idempotent.
- Existing `npm run agent:listing`, `agent:bookkeeper`, `agent:reflector`, `agent:portfolio-manager` still pass (regression).

### Manual (UI on cloud)
- Inbox sections exist for Repricer / Account Health / Customer Success.
- Repricer card with `decision='match_bb'`: primary "Drop to $X.XX" button + "Skip" secondary. Click Drop → pending_pricing_changes row, audit_log, UndoBanner, Undo cancels row.
- Repricer card with `decision='hold'`: no primary button; "Acknowledge" secondary only. Click → state='dismissed'.
- Repricer card with `decision='pause'`: primary "Suspend listing" → pending_health_actions row.
- Account Health green: "Acknowledge" only.
- Account Health red (forced via fixture edit): primary "Acknowledge alert" + "Dismiss". Status banner shows auto-pause count.
- Customer Success card (medical_question): primary "Acknowledge — I will reply personally"; no draft.
- Customer Success card (shipping/refund/general): primary "Send reply" (with draft text shown via tooltip on rationale hover) + "Skip". Click Send → pending_customer_messages row + audit_log + UndoBanner.
- Bad-HMAC POST to webhook returns 401.

### SQL spot-checks
```sql
-- After Repricer run:
select source_agent, briefing_type, jsonb_array_length(proposed_actions) as actions, data_snapshot->>'kind' as kind
  from briefings where source_agent = 'repricer' order by created_at desc limit 5;
-- expect: briefing_type in ('reprice_up','reprice_down','suspend'); actions ≥1; kind='reprice_decision'

-- After approve reprice:
select id, listing_id, decision, from_price, to_price, status, audit_log_id
  from pending_pricing_changes order by created_at desc limit 1;
-- expect: status='pending', audit_log_id NOT NULL

-- After Account Health red:
select id, listing_id, action_kind, triggered_by, status
  from pending_health_actions where triggered_by='account_health_red_auto'
  order by created_at desc limit 5;
-- expect: action_kind='pause_listing', status='pending', several rows

-- After Customer Success run:
select source_agent, briefing_type, data_snapshot->>'classification' as cls
  from briefings where source_agent = 'customer_success' order by created_at desc limit 1;
-- expect: cls in ('shipping','refund','general','medical_question')

-- After approve send_reply:
select id, customer_message_id, classification, status from pending_customer_messages order by created_at desc limit 1;
-- expect: status='pending'

-- Account Health metrics persisted:
select metric, value, captured_at from health_metrics where pharmacy_id=$pid order by captured_at desc limit 10;
-- expect: 5 rows per agent run (odr/late_ship/cancellation/vtr/buybox_pct)
```

### Cred-toggle matrix (the brief's "{creds-present, creds-missing}" deliverable)

| Path | Creds missing (default Wave 2) | Creds present (post-approval) |
|---|---|---|
| Repricer reads pricing | Fixture FOEP echoed per SKU | Real `POST /batches/.../featuredOfferExpectedPrice` |
| Account Health reads report | Fixture seller-performance JSON | Real createReport→getReport→getReportDocument flow |
| Account Health red SMS | Console log `[sms-stub] would send: ...` | Real Twilio API call to KALEEM_SMS_NUMBER |
| Customer Success draft | Sonnet 4.6 voice-matched draft (works either way — LLM not gated) | Same |
| Webhook ingress | Curl-driven test envelopes | Future SQS-relay (Wave 3) |
| Executor forward (all 3 stubs) | `[STUB] would call SP-API ...` log + `pending_*` row | Same in Wave 2 — executor stays stubbed; post-Wave-3 swap pass replaces the log line with the real SP-API call. |
| Webhook ingress | All POSTs return 401 (`SP_API_WEBHOOK_SECRET` empty) | HMAC-verified pass |
| Account Health real seller-id calls | Falls back to fixture report | Real createReport with `SP_API_SELLER_ID` |
| Twilio SMS dial-out | Console-log only when `KALEEM_SMS_NUMBER` or `TWILIO_FROM_NUMBER` empty | Real dial |

---

## Pre-Existing Issues Surfaced

- **None new.** Wave 1 surfaced and fixed `dismiss_briefing` registry gap. No Wave-2-prerequisite cleanup required.
- **Webhook ingress without SQS** is a documented limitation, not a bug. Wave 3 plan adds the SQS consumer worker (per dossier §5.6).

---

## Known Limitations

- **Repricer fixture mode produces synthetic prices** that don't reflect real Buy Box dynamics. UI testing cannot validate "the right price was proposed for the real market" until creds land. Acceptable: Wave 2 validates the *shape* of proposals, not their *correctness*.
- **Account Health fixture mode synthesizes a green-status report** by default. Force-red testing requires editing the fixture JSON manually. Plan documents this in §M.45.
- **Customer Success has no real inbound channel.** The webhook accepts our own `CUSTOMER_MESSAGE_RECEIVED` convention envelope. When Wave 3 wires real Buyer-Seller Messaging API polling, the polling worker will POST envelopes to this same route — no agent or executor change.
- **SP-API report polling can take 1–10 minutes** (createReport → DONE). Account Health's daily cron must allow up to 10 min wall-time; budget the Render cron timeout accordingly. Default Render cron timeout is 30 min — comfortable. Fixture mode is instant.
- **Twilio 10DLC registration is Kaleem's todo** (per dossier §2.2). SMS sends will work pre-registration but get filtered/throttled by carriers. Plan documents the 10DLC step in `docs/kaleem-onboarding.md` (no code change needed for that doc edit; it's a Kaleem-side step).
- **Repricer `hold` briefings** add inbox noise. If Kaleem finds them annoying, Wave 3 can add a preference toggle to suppress them. For now the locked decision is "emit for visibility".
- **HMAC secret rotation** is not in scope. Wave 3 may add a rotation-aware verifier (accept current + previous secret for a grace window).
- **Auto-pause cap of N=5** prevents runaway false-positive red. If 5 listings are auto-paused incorrectly, recovery requires either (a) waiting 30 min and clicking Undo on each `audit_log` row through a Wave 3 audit-history UI, or (b) manual Supabase update. See locked decision 21.

---

## Open Questions

All resolved before implementation.

1. **Repricer event-trigger envelope payload shape** — RESOLVED: matches `ANY_OFFER_CHANGED` per dossier §5.5; agent extracts `Payload.AnyOfferChangedNotification.OfferChangeTrigger.ASIN` and scopes the listings query.
2. **Should Account Health auto-write to `listings.status='paused'`?** — RESOLVED: NO. Models the pause as a `pending_health_actions` row only. Real listing-status mutation is post-Wave-3.
3. **Should Account Health auto-acknowledge the briefing on Kaleem's behalf?** — RESOLVED: NO. Auto-pause + SMS are autonomous; the `acknowledge_health_alert` click is still required.
4. **Customer Success: one briefing per message, or two (triage + draft)?** — RESOLVED: ONE. Two-stage internally, single briefing externally.
5. **Is the SP-API webhook route HMAC-verified?** — RESOLVED: YES. `SP_API_WEBHOOK_SECRET` env var. Verifier in route.
6. **Should Repricer skip 'hold' decisions?** — RESOLVED: NO. Emit low-urgency briefing for visibility.
7. **Where does the Customer Success "tone profile memory" come from?** — RESOLVED: same `memory.kind='preferences'` row Listing Agent reads (`source='kaleem'`). Best-effort with neutral fallback.
8. **Does Account Health need a separate Reports cron?** — RESOLVED: NO. The agent's daily 6am run includes the report-fetch flow inline. (10-min cron window is fine.)
9. **Is the SQS consumer in Wave 2 or Wave 3?** — RESOLVED: Wave 3.
10. **What happens if the SP-API webhook receives an unknown NotificationType?** — RESOLVED: log a warning, return 200 OK (don't 4xx — SP-API will retry, which would amplify noise).

---

## Deprecation

Nothing to remove. Wave 2 is purely additive aside from:
- The fixture extractor adds `vendor/sp-api-fixtures/` (committed) and `vendor/sp-api-models/` (gitignored).
- The four new executors are registered alongside existing ones.

---

## Confidence

**8/10** for one-pass implementation success.

**What raises confidence:**
- Wave 1 shape is proven and live. Three new agents mirror it exactly (cron entry + agent runtime + Zod parse + briefing+inbox insert).
- Kernel (approve/reject/undo/audit) is unchanged — just registers 4 more executors.
- All schema infrastructure exists; the one migration is ~50 LOC of CREATE TABLE.
- Skill prompts pre-authored.
- Twilio TS SDK is mature, single-call surface.
- Fixture-fallback is automatic (cred presence drives everything, no toggle).
- `_shared.ts` helpers (Wave 1) eliminate ~200 LOC of boilerplate per agent.
- Output adapter pattern from Portfolio Manager (Wave 1) reused for Repricer's decision→briefing-type mapping.

**What lowers confidence:**
- SP-API client is hand-rolled — small surface (~6 endpoints) but more code than Wave 1 had.
- Two-stage Customer Success (Triage Haiku → Draft Sonnet) is novel for this repo. Risk: token-budget / response-format / retry handling for Haiku calls might surface quirks not seen with Sonnet.
- Webhook HMAC verifier is new code; getting timing-safe-equal right matters.
- Account Health red-branch's "auto-fire executor" pattern bypasses the kernel's approve route. Care needed: the audit_log entry the agent writes must match the shape that undo expects (`action='pause_listing'`, `target_entity_type='listings'` — wait, actually the kernel's undo expects `target_entity_type='inbox_items'` because that's what `approve` writes; a system-actor pause_listing has no inbox_item, so the audit row points at `listings`. Undo would not work through the inbox UI for this row. **Resolution: design said the briefing carries `acknowledge_health_alert` as the Kaleem-clickable action; the auto-pause audit_log row has no undo-via-UI; if Kaleem wants to "un-pause", he clicks the `acknowledge_health_alert` Acknowledge → that doesn't undo the pause; the only path to un-pause in Wave 2 is Kaleem clicks Undo on the auto-pause audit_log row through a future "audit history" UI**. THIS IS A KNOWN LIMITATION — document explicitly.)
- Fixture extraction depends on stable raw.githubusercontent.com URLs for the OpenAPI models. If GitHub changes the raw URL pattern, the script breaks. Plan documents that extracted fixtures are committed so re-extraction is only needed when adding new endpoints.
- Render cron timing: Repricer staggered to 14:00 / 02:00 UTC to avoid the 13:00 UTC slot held by Listing Agent. Reduces serial-queue contention. Minor; document.

---
