# Phase 2 Handoff — What Shipped + What's Left to Configure

> Written 2026-05-05. Reading order: this doc → `CLAUDE.md` → `tmp/ready-plans/2026-05-05-comprehensive-e2e-test-plan.md`.
> System state: live at https://pharm1-web.onrender.com, all 9 agents shipped, awaiting API credentials for full real-mode operation.

---

## TL;DR

PharmaDash Phase 2 is **code-complete**. The autonomous build delivered all 9 agents in 3 sequenced waves, plus the kernel, webhook ingest, chat tool extensions, memory embeddings, and a comprehensive E2E test plan. The system runs end-to-end **today** in fixture mode against the live cloud deployment. To light up real-data paths, Kaleem populates 6 batches of API credentials over 4 weeks (SP-API is the long pole at 1–4 weeks). Code does not change as creds arrive — the credential-gate facade pattern guarantees fixtures fall through cleanly when a key is missing and real APIs activate when it's set.

---

## Build summary

| Wave | Commit | Agents | Status |
|---|---|---|---|
| Phase 1 MVP | `e61ea77` | (foundation: chatbot + 9 skill prompts authored) | shipped |
| Phase 2 Layers 1+2 | `6b65eed` | Listing Agent + kernel (propose/approve/undo) | shipped |
| Phase 2 Wave 1 | `98ec1dd` | Bookkeeper, Reflector, Portfolio Manager | shipped |
| Phase 2 Wave 2 | `8533ced` | Repricer, Account Health, Customer Success | shipped |
| Phase 2 Wave 3 | `96af10c` | Fulfillment Ops, Research Analyst, Daily Digest | shipped |
| E2E test plan | `ac2378a` | Comprehensive 802-line validation document | shipped |

**Total Phase 2 code added (Waves 1–3):** ~16,700 LOC across 152 files.

All 9 agents live:

```
                          ┌──────────────────────────────────┐
                          │          KALEEM                  │
                          │  /chat + /inbox UI               │
                          └────────────────┬─────────────────┘
                                           │
                                           ▼
                          ┌──────────────────────────────────┐
                          │      CHIEF OF STAFF              │
                          │  Chat persona + Daily Digest     │
                          │  3 chat tools (batch_approve,    │
                          │   dismiss_all, summarize_inbox)  │
                          └────────────────┬─────────────────┘
                                           │ coordinates
                                           ▼
            ┌──────────────────────────────────────────────────────┐
            │  Listing  Bookkeeper  Reflector  PortfolioManager     │
            │  Repricer  AccountHealth  CustomerSuccess             │
            │  FulfillmentOps  ResearchAnalyst                      │
            └──────────────────────────────┬───────────────────────┘
                                           │ all share one memory
                                           ▼
                          ┌──────────────────────────────────┐
                          │   SUPABASE (rvirlhrssgnbkjqhqjao)│
                          │  briefings + inbox_items +       │
                          │  audit_log + memory + pending_*  │
                          └──────────────────────────────────┘
```

---

## What's running on Render right now

**Web service** (`pharm1-web` at `srv-d7qo2977f7vs73cdja6g`)
- Public URL: https://pharm1-web.onrender.com
- Health: `/api/health` — returns `{ok:true, db:{ok:true}, llm:{ok:true, provider:'openrouter'}}`
- Routes:
  - `/` — Inbox (grouped by source_agent → day)
  - `/sign-in` — Magic-link + dev-login (DEV_LOGIN_ENABLED=true)
  - `/chat` — Claude API chatbot with 9 tools
  - `/api/actions/{approve,reject,undo}` — kernel
  - `/api/sp-api/webhook` — HMAC-verified SP-API ingress
  - `/api/chat`, `/api/health`, `/api/auth/*`

**Cron services** (8 agent crons + 2 backup crons)

| Service | Schedule (UTC) | Purpose |
|---|---|---|
| pharm1-listing-agent | `0 13 * * *` | Daily 13:00 — discovers listing opportunities |
| pharm1-repricer | `0 14,2 * * *` | Twice-daily — Buy Box reactions (propose-only) |
| pharm1-account-health | `0 6 * * *` | Daily 06:00 — ODR/VTR/cancellation monitoring |
| pharm1-research-analyst | `15 6 * * *` | Daily 06:15 — FDA + Keepa opportunity scoring |
| pharm1-chief-of-staff-digest | `0 7 * * *` | Daily 07:00 — 24h cross-agent summary |
| pharm1-portfolio-manager | `0 7 * * 0` | Sunday 07:00 — weekly strategic moves |
| pharm1-bookkeeper | `0 23 * * *` | Daily 23:00 — daily P&L |
| pharm1-reflector | `30 23 * * 0` | Sunday 23:30 — weekly pattern extraction |
| pharm1-backup-weekly | `0 9 * * 0` | Sunday 09:00 — encrypted Supabase dump → B2 (currently broken; see config below) |
| pharm1-backup-restore-test | `0 10 1 * *` | 1st of month 10:00 — restore verification (currently broken) |

**Customer Success is webhook-only** (no cron) — fires when `/api/sp-api/webhook` receives `CUSTOMER_MESSAGE_RECEIVED`.
**Fulfillment Ops is webhook-only** — fires on `ORDER_CHANGE` / `ORDER_STATUS_CHANGE`.

---

## What's left to configure

The system runs **today** in fixture mode. To activate real data flows, Kaleem populates the env vars below. Each step is independent — you can configure them in any order, though Section 15 of the E2E test plan recommends the sequence below for fastest time-to-real-value.

### Day 0 — already runnable (no creds needed)
- Sign in via dev-login at https://pharm1-web.onrender.com/sign-in (email `zomid777@gmail.com`, password `000000`)
- Click through seeded briefings to verify kernel UI (Approve / Reject / Undo / 30-min countdown)

### Day 1 — free integrations (instant)

**`FDA_API_KEY`** (optional but recommended)
- Sign up: https://open.fda.gov/apis/authentication/
- Free, instant. Raises rate limit from 1k/day to 120k/day.
- **What activates:** Research Analyst pulls real FDA Drug Shortage + Drug Recall data daily.
- **Where to set:** Render env group `pharm1-shared`.

**`VOYAGE_API_KEY`**
- Sign up: https://voyageai.com/
- Free 200M-token allowance/month on `voyage-4-lite` family covers our usage indefinitely.
- **What activates:** Memory writes get 1024-dim embeddings; semantic memory search works.
- **Where to set:** Render env group `pharm1-shared`.
- **After setting:** run `npm run embeddings:backfill` to embed any pre-existing memory rows.

### Day 2–3 — Backblaze B2 + Sentry

**Backblaze B2** (encrypted weekly backups)
- Sign up: https://www.backblaze.com/b2/sign-up.html
- Create bucket `pharm1-backups` with **Object Lock enabled at creation** (this is irreversible — must be set on creation).
- Create application key with **write-only** permission (no list, no delete) — per CLAUDE.md immutability invariant.
- Set 5 env vars in `pharm1-shared`:
  - `B2_KEY_ID`
  - `B2_APPLICATION_KEY`
  - `B2_BUCKET=pharm1-backups`
  - `B2_ENDPOINT_URL=https://s3.us-west-002.backblazeb2.com` (adjust region)
  - `BACKUP_PASSPHRASE=$(openssl rand -hex 32)` — store this somewhere safe; you need it to decrypt restores
  - `SUPABASE_DB_URL` — from Supabase dashboard → Settings → Database → Connection string (use direct connection, not pgbouncer)
- **What activates:** Sunday 09:00 UTC backup cron writes encrypted dump to B2.
- **Verify:** trigger `pharm1-backup-weekly` manually from Render UI; check B2 bucket for new file.

**Sentry**
- Sign up: https://sentry.io
- Create project (Node.js).
- Copy DSN.
- Set in `pharm1-shared`:
  - `SENTRY_DSN=https://...@...ingest.sentry.io/...`
  - `REDACT_ENV=SUPABASE_SERVICE_ROLE_KEY,OPENROUTER_API_KEY,LWA_CLIENT_SECRET,SP_API_REFRESH_TOKEN,TWILIO_AUTH_TOKEN,EZRIRX_SFTP_KEY,VOYAGE_API_KEY,KEEPA_API_KEY,B2_APPLICATION_KEY,BACKUP_PASSPHRASE`
- **What activates:** server errors (Render logs would otherwise be only place) emit to Sentry; PII scrubbed.

### Day 5–7 — Keepa

**`KEEPA_API_KEY`**
- Sign up: https://keepa.com → API tab → Subscribe to Starter plan ($54/mo or €49/mo)
- Copy API key from your account page.
- Set in `pharm1-shared`:
  - `KEEPA_API_KEY=...`
- **What activates:** Research Analyst reads real Buy Box / FBA-stockout data on watching products. Repricer (Phase 2.5+) can use Keepa for in-event triggers.
- **Verify:** `npm run keepa:token` (locally with cloud env) — should print `{tokensLeft, refillRate, refillIn}`.

### Day 7–10 — Twilio + 10DLC

**Twilio SMS** (Account Health red-status alerts)
- Sign up: https://twilio.com
- Buy a US long-code or toll-free number (~$1.15/mo).
- **Submit 10DLC SMB registration** — required for US A2P SMS since 2023. 5–7 day approval. ~$50 one-time.
  - https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-direct
- Set in `pharm1-shared`:
  - `TWILIO_ACCOUNT_SID=AC...`
  - `TWILIO_AUTH_TOKEN=...`
  - `TWILIO_FROM_NUMBER=+1...`
  - `KALEEM_SMS_NUMBER=+1...` (Kaleem's phone)
- **What activates:** Account Health red status fires real SMS to Kaleem.
- **Verify:** force a red-status briefing via fixture edit; SMS should land in <30s.

### Day 10–14 — EzriRx EDI

**EzriRx** (wholesaler price + ASN data for Fulfillment Ops)
- Email: `edi@ezrirx.com` (use the draft at `docs/emails/`-NEW; create one if it doesn't exist yet, modeled on the ABC + McKesson templates already in there)
- Onboarding takes ~1 week.
- They provide SFTP host + user + private key.
- Set in `pharm1-shared`:
  - `EZRIRX_SFTP_HOST=...`
  - `EZRIRX_SFTP_USER=...`
  - `EZRIRX_SFTP_KEY=...` (PEM with `\n` literal newlines preserved)
- **What activates:** Fulfillment Ops cross-source comparison shows real wholesaler prices from latest 832 EDI files (vs synthesized fixture prices). Note: real-time inventory (846) is not supported by EzriRx — comparisons are "most-recent-832" with timestamps.
- **Verify:** trigger an `ORDER_CHANGE` webhook; briefing should show real wholesaler data with real `captured_at` from the 832.

### Day 14–28 — SP-API approval lands

This is the long pole. **Start it on Day 1** so the clock runs in parallel.

**Amazon SP-API**
- Follow `docs/amazon-sp-api-setup.md` exactly.
- Submit SP-API app registration (Amazon takes 1–4 weeks).
- After approval: complete LWA self-authorization to capture refresh token.
- Set 6 env vars in `pharm1-shared`:
  - `LWA_CLIENT_ID=amzn1.application-oa2-client.xxx`
  - `LWA_CLIENT_SECRET=...`
  - `SP_API_REFRESH_TOKEN=Atzr|...` (long-lived; capture during self-authorization)
  - `SP_API_REGION=na`
  - `SP_API_MARKETPLACE_ID=ATVPDKIKX0DER` (US — already default)
  - `SP_API_SELLER_ID=A...` (your merchant token)
  - `SP_API_WEBHOOK_SECRET=$(openssl rand -hex 32)` — used by `/api/sp-api/webhook` HMAC verification
- **What activates:** Listing Agent, Repricer, Account Health, Customer Success, Fulfillment Ops all switch from fixtures to real Amazon data. Webhook endpoint accepts real SP-API push notifications.
- **Setup script:** after env vars are set, you'll need to register webhook subscriptions with Amazon. The notifications API dance is documented in `tmp/research/2026-05-04-sp-api-comprehensive.md` §5. (May write a one-shot `scripts/sp-api-create-subscriptions.ts` later — for now, follow the dossier.)

### Day 28+ — operational steady-state

All 9 agents producing real data. Real Sentry monitoring. Real backups. This is the "ready for production" line.

---

## Repository state

| Aspect | Value |
|---|---|
| GitHub remote | `https://github.com/omdiidi/pharmacy.git` |
| Branch | `main` |
| HEAD | `ac2378a` (E2E test plan) |
| Working tree | clean |
| Last 4 ship commits | `98ec1dd` (W1) → `8533ced` (W2) → `96af10c` (W3) → `ac2378a` (E2E plan) |

All Phase 2 code, plans, briefs, research dossiers, and the E2E test plan are pushed to origin/main. Nothing is locally pending. **Tmp directories `tmp/plan-artifacts/` are gitignored** so brief + dossier files are local-only by design (per repo convention from earlier in the project).

---

## What documentation exists

### Top-level entry points
- **`CLAUDE.md`** — repo-root handoff. Architecture, agent fleet, decisions, never-dos.
- **`PLAN.md`** — 30,000-foot project view + decisions log.
- **`docs/phase-2-handoff.md`** (this file) — what shipped + what's left to configure.
- **`docs/how-this-works.md`** — Kaleem-facing one-page system overview.

### Plans (in `tmp/ready-plans/`, `tmp/done-plans/`)
- `tmp/done-plans/2026-04-19-phase-1-mvp.md` — Phase 1 MVP build (44 tasks, shipped).
- `tmp/done-plans/2026-05-01-phase-2-layer-1-2-kernel-listing-agent.md` — kernel + Listing Agent (shipped).
- `tmp/done-plans/2026-05-04-phase-2-wave-1-self-contained-agents.md` — Wave 1 (shipped).
- `tmp/done-plans/2026-05-04-phase-2-wave-2-sp-api-agents.md` — Wave 2 (shipped).
- `tmp/done-plans/2026-05-04-phase-2-wave-3-fulfillment-research-cos.md` — Wave 3 (shipped).
- **`tmp/ready-plans/2026-05-05-comprehensive-e2e-test-plan.md`** — final test plan (the deliverable).

### Briefs (decision history)
- `tmp/briefs/2026-04-19-pharmacy-otc-platform.md` — original platform brief.
- `tmp/briefs/2026-04-30-agent-runtime-comparison.md` — runtime decision (Claude Agent SDK vs alternatives).
- `tmp/briefs/2026-05-01-phase-2-listing-automation.md` — Phase 2 product reframe (listing-automation, not arbitrage).
- `tmp/briefs/2026-05-04-phase-2-waves-1-2-3-roadmap.md` — Wave 1-3 sequencing.

### Research dossiers
- `tmp/research/2026-04-30-agent-runtime-recommendation.md` — Agent SDK runtime choice.
- `tmp/research/2026-05-04-sp-api-comprehensive.md` — Amazon SP-API (1692 lines).
- `tmp/research/2026-05-04-keepa-api.md` — Keepa API.
- `tmp/research/2026-05-04-fda-google-trends.md` — FDA + Google Trends.
- `tmp/research/2026-05-04-ezrirx-sms.md` — EzriRx EDI + Twilio SMS.
- `tmp/research/2026-05-04-voyage-embeddings.md` — Voyage AI embeddings.

### Operational docs (in `docs/`)
- `docs/amazon-sp-api-setup.md` — exact SP-API onboarding procedure for Kaleem.
- `docs/kaleem-onboarding.md` — Dev-facing 12-step onboarding playbook.
- `docs/kaleem-todos.md` — running checklist.
- `docs/wholesaler-connections.md` + `docs/wholesaler-questions.md` — supplier integration plans.
- `docs/emails/` — 5 supplier email drafts (ABC, McKesson, Cardinal, Parmed, IPC).
- `docs/render-deploy-runbook.md` — click-by-click Render deploy.
- `docs/render-setup.md` — original Blueprint deploy doc.
- `docs/architecture.md`, `docs/integrations.md`, `docs/chatbot.md`, `docs/mvp-scope.md` — Phase 1 reference docs.
- `docs/agents/` — per-agent skill prompts (Markdown files at `minicrew-config/skills/*.md` are the runtime ones; `docs/agents/` may have additional notes).

---

## Code review starting points

If you want to do code reviews of the Phase 2 build, suggested order:

1. **Kernel** (`lib/executors/`, `lib/kernel/approve.ts`, `app/api/actions/{approve,reject,undo}/route.ts`) — the propose/approve/undo machinery. Keep `app/api/actions/undo/route.ts:33-73` open for the 30-min window logic. After Wave 3, `lib/kernel/approve.ts` is the shared approve-flow function used by both the HTTP route and the chat tools.

2. **Shared agent helpers** (`lib/agents/_shared.ts`) — fence-strip, skill-prompt loader, daily budget gate, OpenRouter LLM call wrapper. Used by every agent.

3. **One agent of each shape:**
   - Self-contained: `lib/agents/bookkeeper.ts` (Wave 1)
   - SP-API-driven: `lib/agents/repricer.ts` (Wave 2)
   - Webhook-driven: `lib/agents/fulfillment-ops.ts` (Wave 3)
   - Two-stage: `lib/agents/customer-success.ts` (Triage Haiku → Draft Sonnet)

4. **Cred-gate facade** (`lib/sp-api/index.ts`, `lib/edi/index.ts`, `lib/keepa/index.ts`, `lib/fda/index.ts`, `lib/voyage/embed.ts`) — the pattern that enables fixture-vs-real switching with no agent code change.

5. **Webhook ingress** (`app/api/sp-api/webhook/route.ts`) — HMAC verification + NotificationType dispatch.

6. **Chat tools** (`lib/tools/index.ts` + `lib/tools/{batch_approve_briefings,dismiss_all_briefings,summarize_inbox}.ts`) — Wave 3 additions sharing kernel logic.

7. **Migrations** (`supabase/migrations/`) — schema evolution. Wave 1+2+3 added 5 migrations: enum-add, brand_paused_enum, wave1_agents, pending tables for waves 2+3, digest enum.

---

## Known limitations and open issues

These are documented in detail in the wave plans + E2E test plan. Quick list:

1. **Magic-link auth on Render is broken** (cookie domain issue from prior session). Dev-login bypass is the workaround. Fix is deferred — not Wave 2/3 scope.
2. **Backup crons broken at runtime** until B2 + passphrase + SUPABASE_DB_URL are set (Day 2–3 above).
3. **`pharm1-listing-agent` cron has not been manually triggered** in production (only the `npm run agent:listing` from a local terminal). Once you hit "Trigger Run" in Render UI, it'll produce real briefings.
4. **Real PO PDF generation is stubbed** — `generate_purchase_order` executor logs `[STUB] would generate PO PDF and send 850 EDI`. Real EDI 850 send lands in a post-Wave-3 swap pass when `pdf-lib` or similar is added.
5. **Buyer-Seller Messaging API polling is deferred** to Wave 4. Wave 3 Customer Success ingests via the synthetic `CUSTOMER_MESSAGE_RECEIVED` webhook envelope; real polling lands later.
6. **SQS consumer worker is deferred** to Wave 4. SP-API webhook accepts directly-posted envelopes (curl-driven testing now; SQS-relay later).
7. **Google Trends signal deferred** to Phase 2.5 (per FDA dossier — pytrends unsafe, paid options out of budget).
8. **Test listings seeded ad-hoc on cloud** (PHARM-OMG3-1000, PHARM-MAG-400 — for Wave 2 Repricer testing). Either fold them into `scripts/seed-dev-data.ts` or delete before real SKUs land.
9. **Two-POS isolation invariant is preserved.** No code touches Pioneer / Heartland / Rx data.
10. **Voyage backfill** must be run manually once after `VOYAGE_API_KEY` is set: `npm run embeddings:backfill`. Idempotent and safe to re-run.

---

## Final notes

- The **E2E test plan** at `tmp/ready-plans/2026-05-05-comprehensive-e2e-test-plan.md` is the single source of truth for what to test and how. It has 50+ test cases, a master cred-toggle matrix, and Section 15's day-by-day onboarding sequence.
- The **autonomous build** is complete. No more user check-ins required for Phase 2 features. Future work is real-data activation (configure creds → re-run tests) and any new feature waves you decide on.
- **Code reviews** are a separate workstream — see "Code review starting points" above.
- **Push policy** still applies for any new work: never push without explicit approval (per `CLAUDE.md` global rule).
