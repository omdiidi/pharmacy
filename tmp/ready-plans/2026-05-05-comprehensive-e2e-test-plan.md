# Comprehensive E2E Test Plan — PharmaDash Phase 2 Final

> Authored 2026-05-05. Final deliverable of Phase 2 autonomous build.
> HEAD on `origin/main` is `96af10c` (Wave 3 ship commit) at the time of writing.
> This plan tells Kaleem (and Dev) exactly which features to test, how, and what
> success/failure looks like — covering every feature × {creds-present,
> creds-missing} matrix across all 9 agents + the kernel + chat tools + webhook
> + memory + embeddings + backups + auth + Sentry.

## Overview

PharmaDash Phase 2 is shipped end-to-end. All 9 agents (Listing, Bookkeeper,
Reflector, Portfolio Manager, Repricer, Account Health, Customer Success,
Fulfillment Ops, Research Analyst, Chief of Staff Digest), the kernel
(propose/approve/reject/undo + 30-min undo window), the SP-API webhook
ingest, the chat-tool extension surface, the memory + embeddings pipeline,
and the backup crons are all live on Render against cloud Supabase
`rvirlhrssgnbkjqhqjao`.

This plan is for validating the system in **three modes**:

| Mode | Description | Coverage |
|---|---|---|
| **Fixture** | No external credentials. All agents and clients fall through to vendored fixtures. | Sections 1-12 plus the "creds-missing" column of Section 13. Runnable today on the live cloud deployment. |
| **Partial creds** | Some creds set (e.g. only `FDA_API_KEY` and `VOYAGE_API_KEY`), others still falling back. | Each section is self-contained — toggle one var at a time and re-run only the affected sections. |
| **Full real** | Every credential populated (SP-API, Twilio, Keepa, EzriRx, FDA, Voyage, B2, Sentry). | Sections 4-12 in real mode. End-state of the build. |

The fundamental invariants this plan verifies:

1. **Propose-only kernel** — every executor action requires Kaleem's click. The
   only autonomous mutations are (a) Account Health's auto-pause on red status
   (capped at N=5 listings) and (b) Account Health's auto-SMS on red. Both
   write to `pending_*` tables only — neither directly mutates Amazon listings
   or sends real customer messages without a click.
2. **30-minute undo window** on every executor action.
3. **Cred-gated everywhere** — when an env var is missing, the corresponding
   client falls through to a fixture or no-op. Code path doesn't change.
4. **Two-POS isolation** — the system never touches Pioneer / Heartland / Rx data.
5. **Single tenant** — `pharmacy_id = 00000000-0000-0000-0000-000000000001`.

## Pre-flight checklist

Run this section once at the start of any test run. If any item fails, stop
and remediate before running other sections.

| # | Check | Command / Action | Pass criteria |
|---|---|---|---|
| 0.1 | Sign-in to https://pharm1-web.onrender.com works (dev-login or magic link) | Open `/sign-in`, click "Quick dev sign-in" with `zomid777@gmail.com` / `000000` | Lands on inbox |
| 0.2 | Cloud Supabase project is `rvirlhrssgnbkjqhqjao` (NOT the wrong one) | `curl https://pharm1-web.onrender.com/api/health` and inspect response | `db.ok === true` and the project ref in any error message matches `rvirlhrssgnbkjqhqjao` |
| 0.3 | Render Blueprint shows all 8 cron services + 1 web service alive | https://dashboard.render.com/blueprint/exs-d7qo21bbc2fs73frhfe0 | 9 services listed: web, listing-agent, bookkeeper, portfolio-manager, reflector, repricer, account-health, research-analyst, chief-of-staff-digest, plus 2 backup crons (currently broken) |
| 0.4 | All env-var slots in `pharm1-shared` env group exist (whether populated or not) | https://dashboard.render.com/env-group/evg-d7qo2977f7vs73cdja2g | 28+ entries: 5 backup-related (SUPABASE_DB_URL, BACKUP_PASSPHRASE, B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, B2_ENDPOINT_URL) + 11 SP-API/Twilio (LWA_CLIENT_ID, LWA_CLIENT_SECRET, SP_API_REFRESH_TOKEN, SP_API_REGION, SP_API_MARKETPLACE_ID, SP_API_SELLER_ID, SP_API_WEBHOOK_SECRET, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, KALEEM_SMS_NUMBER) + 6 Wave 3 (VOYAGE_API_KEY, FDA_API_KEY, KEEPA_API_KEY, EZRIRX_SFTP_HOST, EZRIRX_SFTP_USER, EZRIRX_SFTP_KEY) + 11 always-on (OPENROUTER_API_KEY, OPENROUTER_APP_NAME, OPENROUTER_APP_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_USER_EMAILS, NEXT_PUBLIC_SITE_URL, MAX_DAILY_CLAUDE_SPEND_USD, DEV_LOGIN_ENABLED, NEXT_PUBLIC_DEV_LOGIN_ENABLED, SENTRY_DSN, REDACT_ENV, DEV_PASSWORD) = 28 main slots |
| 0.5 | `git rev-parse HEAD` on `origin/main` is `96af10c` or later | `git ls-remote origin main` | SHA matches or descends from `96af10c` |
| 0.6 | At least one Render build for the current SHA has succeeded | Latest deploy on https://dashboard.render.com/web/srv-d7qo2977f7vs73cdja6g shows "Live" | Status: Live, log shows `Build successful` |
| 0.7 | `/api/health` returns `{ok:true, db:{ok:true}, llm:{ok:true, provider:'openrouter'}}` | `curl https://pharm1-web.onrender.com/api/health` | All three `ok:true` |

If 0.1-0.7 all pass: the platform is ready for full E2E testing.

## Test matrix overview

- **9 agents × {creds-missing, creds-present} = 18 row-pairs** (Listing,
  Bookkeeper, Reflector, Portfolio Manager, Repricer, Account Health,
  Customer Success, Fulfillment Ops, Research Analyst, Chief of Staff Digest)
  — note: the kernel and Chief of Staff Digest don't have a creds-present
  variant per se, but they have specific multi-condition cases.
- **Plus:** kernel approve/reject/undo (5 tests in Section 2), webhook ingest
  (3 NotificationTypes × HMAC verification = 7 tests in Section 6), chat tools
  (3 tools in Section 7), memory + embeddings (3 paths in Section 8), backups
  (manual trigger in Section 10), middleware + auth (3 cases in Section 11),
  Sentry (2 cases in Section 12).
- **Total: ~50 distinct test cases** plus the master cred-toggle table in
  Section 13.

---

## Section 1: Pre-flight & smoke

### 1.1 Health endpoint
- **ID:** SMOKE-001
- **Prereq:** None (creds-missing path is fine — endpoint just probes)
- **Steps:** `curl https://pharm1-web.onrender.com/api/health`
- **Expected:** HTTP 200; body `{ok:true, db:{ok:true}, llm:{ok:true, provider:'openrouter'}}`
- **Failure mode:** `db.ok=false` → Supabase service-role key wrong or project unreachable. Re-check `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` in Render env group; ensure Supabase project is not paused.
- **Failure mode:** `llm.ok=false` → OpenRouter key invalid or quota exhausted. Check `OPENROUTER_API_KEY`; visit openrouter.ai dashboard to verify balance.

### 1.2 Sign-in
- **ID:** SMOKE-002
- **Prereq:** `DEV_LOGIN_ENABLED=true`, `NEXT_PUBLIC_DEV_LOGIN_ENABLED=true`, `DEV_PASSWORD=000000`, `ALLOWED_USER_EMAILS` includes `zomid777@gmail.com`.
- **Steps:** Open `/sign-in` in browser. Verify the "Quick dev sign-in" form is visible at the bottom. Submit `zomid777@gmail.com` / `000000`. Verify redirect to `/`.
- **Expected:** Land on inbox; cookie `sb-rvirlhrssgnbkjqhqjao-auth-token` set.
- **Failure mode:** Form not visible → `NEXT_PUBLIC_DEV_LOGIN_ENABLED` not deployed (it's a build-time var). Trigger Render rebuild after setting.
- **Failure mode:** 403 on submit → `DEV_LOGIN_ENABLED` server-side gate or password mismatch. Check Render env group.

### 1.3 Inbox loads with grouped agent sections
- **ID:** SMOKE-003
- **Prereq:** Signed in (1.2).
- **Steps:** On `/`, observe the inbox.
- **Expected:** Each section is grouped by `source_agent` then by day inside. Agent labels match: "Listing Agent", "Bookkeeper", "Reflector", "Portfolio Manager", "Repricer", "Account Health", "Customer Success", "Fulfillment Ops", "Research Analyst", "Daily Digest". Sections collapse past 5 items.
- **Failure mode:** Items ungrouped → `components/inbox/timeline.tsx` regression. File a bug.

### 1.4 Settings/env-var sanity check
- **ID:** SMOKE-004
- **Prereq:** Render dashboard access.
- **Steps:** Open `pharm1-shared` env group. Verify the 28 expected slots exist (per 0.4 above). For any populated slot, sanity-check the prefix (e.g. `SUPABASE_SERVICE_ROLE_KEY` starts with `sb_secret_` or `eyJ` for legacy JWT; `OPENROUTER_API_KEY` starts with `sk-or-`).
- **Expected:** All 28 slots present; populated values look right shape.
- **Failure mode:** Slot missing → it'll appear at runtime as "undefined" and either crash the agent or fall through to fixture. Add the slot.

---

## Section 2: Kernel (independent of any agent)

The kernel is the propose→approve→execute→undo machinery. It works regardless
of which agent produced the briefing. These tests use the seeded fixtures
plus any briefing produced by a Wave 1-3 agent in real mode.

### 2.1 Approve a Bookkeeper briefing (Acknowledge button)
- **ID:** KERNEL-001
- **Prereq:** A Bookkeeper briefing exists in the inbox (state='pending', proposed_actions=[]).
- **Steps:** On `/`, click "Acknowledge" on a Bookkeeper section briefing.
- **Expected:** Card transitions to 'dismissed' state (greyed out). `inbox_items.state='dismissed'` and `briefings.status='dismissed'` in Supabase. **No** `audit_log` row (since no executor was invoked — Bookkeeper is report-only).
- **Failure mode:** Modal closes but state still 'pending' → `/api/actions/reject` failure. Inspect server logs.

### 2.2 Approve a Portfolio Manager `add_to_watchlist` action
- **ID:** KERNEL-002
- **Prereq:** A Portfolio Manager briefing with `proposed_actions[0].kind='add_to_watchlist'` exists (run `npm run agent:portfolio-manager` against cloud or wait for Sunday cron).
- **Steps:** Click the primary action button (e.g. "Add Omega-3 + 4 others to watchlist").
- **Expected:**
  - HTTP 200 on `/api/actions/approve`.
  - `products.watchlist_status='watching'` for each product_id in the action's `params.product_ids`.
  - `audit_log` row inserted with `action='add_to_watchlist'`, `result.applied_product_count` populated.
  - Card transitions to 'acted' state with **UndoBanner** visible showing countdown (≤30 min).
  - `inbox_items.state='acted'`.
- **Failure mode:** Card flips state but watchlist status unchanged → executor forward succeeded but UPDATE failed; check executor source `lib/executors/add-to-watchlist.ts`.
- **Failure mode:** 500 with "UnknownExecutorError" → registry mismatch (`lib/executors/index.ts` doesn't import the kind).

### 2.3 Click Undo within 30 min
- **ID:** KERNEL-003
- **Prereq:** Just completed KERNEL-002, UndoBanner still showing.
- **Steps:** Click the "Undo" link in the UndoBanner.
- **Expected:**
  - HTTP 200 on `/api/actions/undo`.
  - For each product: `watchlist_status` reverts to its prior value.
  - New `audit_log` row inserted with `action='undo:add_to_watchlist'`, FK back to the original audit_log row.
  - Card now shows "Reverted at HH:MM" banner.
  - `inbox_items.state` stays `'acted'` (per locked decision; "Reverted" text replaces UndoBanner).
- **Failure mode:** 410 Gone → 30-min window expired (see 2.4); use a fresh approve.
- **Failure mode:** Reverse step ran but DB unchanged → `executor.reverse()` not implemented or threw silently. Inspect logs.

### 2.4 Click Undo after 30 min (window expired)
- **ID:** KERNEL-004
- **Prereq:** An `acted` audit_log row whose `created_at` is older than 30 min.
- **Steps:** Open Supabase Studio → find a stale `acted` briefing. Construct `POST /api/actions/undo` with its briefing_id (or wait for a real one to age out).
- **Expected:** HTTP 410 Gone. UI displays "Undo window expired" message.
- **Failure mode:** 200 on undo of stale row → window check missing in `app/api/actions/undo/route.ts`. File a bug.

### 2.5 Reject a briefing
- **ID:** KERNEL-005
- **Prereq:** A pending briefing of any kind (e.g. Wave 2 Repricer "hold" briefing).
- **Steps:** Click "Reject" / "Skip" / "Dismiss".
- **Expected:** Card transitions to 'dismissed'. `inbox_items.state='dismissed'`. **No** executor was invoked. **No** `audit_log` row (reject is non-executable; only approve writes audit_log).
- **Failure mode:** audit_log row appears with `action='reject'` → executor was wrongly invoked; bug in approve route's branch logic.

---

## Section 3: Wave 1 agents (Bookkeeper · Reflector · Portfolio Manager)

All three are zero-external-dependency. They have **no creds-present variant**
because they read only our own Supabase tables. The "creds" they care about
are `OPENROUTER_API_KEY` (for the LLM call itself), which is mandatory always.

### 3.1 Bookkeeper

**3.1.1 Manual cron trigger**
- **ID:** WAVE1-BK-001
- **Prereq:** `OPENROUTER_API_KEY` set; `MAX_DAILY_CLAUDE_SPEND_USD=50` (or higher).
- **Steps:** Render dashboard → `pharm1-bookkeeper` cron → "Trigger Run". Watch logs for ~30-90s.
- **Expected:** Logs show `[bookkeeper] starting`, `[bookkeeper] inserted briefing <id>`, `[bookkeeper] done`. Within 60s, a new briefing appears in inbox under "Bookkeeper" section with `briefing_type='strategic'` and `data_snapshot.kind='daily_pnl'`.
- **Failure mode:** `OPENROUTER_API_KEY missing` → set it.
- **Failure mode:** `getTodaySpendUsd: cap exceeded` → bump `MAX_DAILY_CLAUDE_SPEND_USD` or wait until UTC day rollover.
- **Failure mode:** `relation "orders" does not exist` → migrations not applied; re-run via Management API.

**3.1.2 Sample-row SQL spot-check on cloud Supabase**
- **ID:** WAVE1-BK-002
- **Prereq:** WAVE1-BK-001 succeeded.
- **Steps:** Supabase Studio → SQL editor →
  ```sql
  select id, source_agent, briefing_type, data_snapshot->>'kind' as kind,
         summary, created_at
  from briefings
  where source_agent='bookkeeper'
  order by created_at desc limit 1;
  ```
- **Expected:** One row, `kind='daily_pnl'`, `data_snapshot` has fields `revenue`, `cogs`, `fees`, `net_profit`, `anomaly_flags`.
- **Failure mode:** Row missing → cron didn't actually insert; check logs for transactional rollback.

**3.1.3 Acknowledge flow**
- **ID:** WAVE1-BK-003 — covered by KERNEL-001.

### 3.2 Reflector

**3.2.1 Manual cron trigger**
- **ID:** WAVE1-RF-001
- **Prereq:** `OPENROUTER_API_KEY` set. At least one week of `audit_log` rows + `briefings` rows present (or seeded fixtures).
- **Steps:** Render dashboard → `pharm1-reflector` cron → "Trigger Run". Note: reasoning_effort='high' so this can take up to 3 min and cost ~$0.30 per run.
- **Expected:** Logs show `[reflector] starting`, `[reflector] inserted N memory rows`, `[reflector] inserted briefing <id>`. New briefing under "Reflector" section + 1-5 new rows in `memory` with `kind in ('procedural','semantic','preferences')`.
- **Failure mode:** Empty result with no error → not enough audit data; seed more or wait for org activity.

**3.2.2 Memory row spot-check**
- **ID:** WAVE1-RF-002
- **Steps:**
  ```sql
  select id, kind, source, content, embedding is not null as has_embedding,
         embedding_model, created_at
  from memory
  where source like 'reflector:%'
  order by created_at desc limit 5;
  ```
- **Expected:** Rows with `kind in ('procedural','semantic','preferences')` (NOT `'episodic'`). `embedding` is NOT NULL only if `VOYAGE_API_KEY` is set; `embedding_model='voyage-4-lite'` in that case.
- **Failure mode:** `kind='episodic'` row found → Reflector is emitting wrong kind; check `lib/agents/reflector.ts` output schema.

**3.2.3 Acknowledge flow** — covered by KERNEL-001.

### 3.3 Portfolio Manager

**3.3.1 Manual cron trigger**
- **ID:** WAVE1-PM-001
- **Prereq:** `OPENROUTER_API_KEY` set. Some `memory` and `audit_log` rows present (use seeded data).
- **Steps:** Render dashboard → `pharm1-portfolio-manager` cron → "Trigger Run".
- **Expected:** Briefing under "Portfolio Manager" section with `proposed_actions` of length 3, each with `kind in ('add_to_watchlist','pause_brand','flag_anomaly')`. May include `data_snapshot.unmapped_moves[]` if the LLM emitted free-form moves.
- **Failure mode:** Briefing has 0 proposed_actions → output adapter fell through; inspect `lib/agents/portfolio-manager-output-adapter.ts` and verify all 3 moves landed in `unmapped_moves`.

**3.3.2 Approve `add_to_watchlist` flow** — covered by KERNEL-002 + KERNEL-003.

**3.3.3 Approve `pause_brand` flow**
- **ID:** WAVE1-PM-002
- **Prereq:** A Portfolio Manager briefing whose `proposed_actions` includes `kind='pause_brand'` (re-trigger if needed).
- **Steps:** Click the "Pause [brand]" button. Wait. Click "Undo" within 30 min.
- **Expected:**
  - Approve: `brand_authorization.status='paused'`, `paused_until=created_at+7d` (default), `prior_status` captured.
  - Audit log row with `action='pause_brand'`.
  - Undo: status reverts to `prior_status`, `paused_until=null`.
- **Failure mode:** `paused` enum value missing → migration `20260504000001_wave1_brand_paused_enum.sql` not applied; check `pg_enum` for `'paused'` value of `brand_auth_status`.

**3.3.4 Approve `flag_anomaly` flow**
- **ID:** WAVE1-PM-003
- **Steps:** Approve a briefing whose action is `flag_anomaly`.
- **Expected:** New `memory` row with `kind='semantic'`, `metadata.anomaly_type` populated, `source='portfolio_manager:anomaly:<id>'`. Reverse marks it deleted (or flips `metadata.dismissed=true` per executor's reverse implementation).

---

## Section 4: Wave 2 agents (Repricer · Account Health · Customer Success)

These three are the first cred-gated agents. Test each in **both** creds-missing
and creds-present mode.

### 4.1 Repricer

**4.1.1 Cred-missing test (fixture pathway)**
- **ID:** WAVE2-RP-001
- **Prereq:** `SP_API_REFRESH_TOKEN` UNSET. `OPENROUTER_API_KEY` set.
- **Steps:** Render → `pharm1-repricer` cron → "Trigger Run".
- **Expected:**
  - Logs show `[sp-api] credentials missing — using fixture client`.
  - For each watching listing, agent receives a fixture Buy Box snapshot.
  - 1+ briefings emitted under "Repricer" section.
  - Each briefing: `briefing_type in ('reprice_up','reprice_down','suspend')`, `proposed_actions` either `[{kind:'reprice', params:{listing_id, from_price, to_price, decision}}, ...]` or `[{kind:'pause_listing', params:{...}}]`.
  - "hold" decisions emit a low-urgency briefing with `proposed_actions=[{kind:'dismiss_briefing'}]` only.
- **Failure mode:** No briefings → no products in `watchlist_status='watching'` state. Set at least one via SQL.
- **Failure mode:** All briefings are `suspend` → fixture data is too pessimistic; spot-check `vendor/sp-api-fixtures/getFeaturedOfferExpectedPriceBatch.json`.

**4.1.2 Cred-present test (real Buy Box pull)**
- **ID:** WAVE2-RP-002
- **Prereq:** `SP_API_REFRESH_TOKEN`, `LWA_CLIENT_ID`, `LWA_CLIENT_SECRET` all set. SP-API approval landed for Kaleem's seller account.
- **Steps:** Render → `pharm1-repricer` cron → "Trigger Run".
- **Expected:**
  - Logs show `[sp-api] LWA token cached`.
  - For each listing with `platform_listing_id` populated, real `getFeaturedOfferExpectedPriceBatch` call.
  - Briefings reflect real Buy Box deltas. `data_snapshot.bb_price_real=true`.
- **Failure mode:** `LWA refresh failed: 401` → `SP_API_REFRESH_TOKEN` expired or `LWA_CLIENT_*` mismatched. Re-do self-authorization (see `docs/amazon-sp-api-setup.md`).
- **Failure mode:** `NOT_ELIGIBLE_TO_COMPETE` for all listings → seller listings haven't activated yet on Amazon side; wait for marketplace propagation.

**4.1.3 Approve a `reprice` action**
- **ID:** WAVE2-RP-003
- **Steps:** Click "Match Buy Box at $X.XX" (or whatever variant). Verify `pending_pricing_changes` row created.
- **Expected:**
  - HTTP 200, audit_log row, `pending_pricing_changes` row with `status='pending'`, `decision`, `from_price`, `to_price`, `audit_log_id` FK.
  - **No** real SP-API mutation (Repricer is propose-only forever per locked decision 3 of Wave 2).
  - Undo within 30 min: `pending_pricing_changes.status='cancelled'`.

**4.1.4 Approve a `pause_listing` action**
- **ID:** WAVE2-RP-004
- **Steps:** On a `suspend` briefing, click "Pause this listing".
- **Expected:** `pending_health_actions` row with `triggered_by='repricer_suspend'`, `action_kind='pause_listing'`. **Listing's `listings.status` is NOT mutated** (stub).

### 4.2 Account Health

**4.2.1 Cred-missing test (fixture pathway, green status)**
- **ID:** WAVE2-AH-001
- **Prereq:** `SP_API_REFRESH_TOKEN` UNSET.
- **Steps:** Render → `pharm1-account-health` cron → "Trigger Run".
- **Expected:**
  - Fixture `seller-performance-report-sample.json` returns green-status metrics.
  - Single briefing with `briefing_type='account_health'`, `data_snapshot.status='green'`, `proposed_actions=[]` (report-only, "Acknowledge" button).
  - Trend rows appended to `health_metrics` table.

**4.2.2 Cred-missing test, forced red status**
- **ID:** WAVE2-AH-002
- **Prereq:** Edit `vendor/sp-api-fixtures/seller-performance-report-sample.json` to flip ODR > 1%, push the change to a feature branch and deploy. (Or, simpler: synthesize a `pending_health_actions` red trigger via SQL.)
- **Steps:** Trigger cron with red fixture.
- **Expected:**
  - Status classifier returns `'red'` with N contributing listings.
  - **If N ≤ 5:** auto-pause loop fires → N rows in `pending_health_actions` with `triggered_by='account_health_red_auto'`, status='pending'.
  - **If N > 5:** auto-pause is SKIPPED (per locked decision 21). Briefing carries `proposed_actions=[{kind:'acknowledge_health_alert'}, {kind:'dismiss_briefing'}]`.
  - SMS: if `TWILIO_ACCOUNT_SID` set, real SMS sent to `KALEEM_SMS_NUMBER`. If unset, log-only with `[twilio] credentials missing — would have sent: PHARMADASH ALERT: Red status, N listings affected — too many for auto-pause. Open inbox.` (or similar).
  - audit_log row with `actor='system:account_health'`.
- **Failure mode:** Auto-pause loop fires for N=30 → N=5 cap not enforced; bug. File.

**4.2.3 Cred-present test (real GET_V1_SELLER_PERFORMANCE_REPORT flow)**
- **ID:** WAVE2-AH-003
- **Prereq:** SP-API creds set. Seller Central account active.
- **Steps:** Trigger cron. Note: real Reports flow is async (createReport → poll up to 5 min → fetch presigned URL → parse JSON). Logs may show `[reports] polling… processingStatus=IN_PROGRESS` for several minutes.
- **Expected:** Real metrics persist to `health_metrics`. Briefing reflects actual ODR/Late-Ship/Cancellation/VTR/Buy-Box-% values.
- **Failure mode:** Polling times out → bump the 5-min budget in `lib/sp-api/reports.ts`; or report wasn't generated for the marketplace yet.

**4.2.4 Acknowledge `acknowledge_health_alert`**
- **ID:** WAVE2-AH-004
- **Steps:** Click "Acknowledge alert" on a red briefing.
- **Expected:** No-op forward succeeds; audit log row with `action='acknowledge_health_alert'`. `pending_health_actions` rows created by the auto-pause are NOT cancelled by acknowledge — they remain pending until separately acted on or expired.

### 4.3 Customer Success

**4.3.1 Cred-missing webhook test, two-stage flow**
- **ID:** WAVE2-CS-001
- **Prereq:** `SP_API_WEBHOOK_SECRET` set (~`openssl rand -hex 32`).
- **Steps:** Compute HMAC for a synthetic NotificationEnvelope:
  ```bash
  BODY='{"NotificationType":"CUSTOMER_MESSAGE_RECEIVED","Payload":{"AmazonOrderId":"123-1234567-1234567","Message":"When will my order arrive?"}}'
  SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SP_API_WEBHOOK_SECRET" | awk '{print $2}')
  curl -X POST https://pharm1-web.onrender.com/api/sp-api/webhook \
    -H "Content-Type: application/json" \
    -H "X-PharmaDash-Signature: sha256=$SIG" \
    -d "$BODY"
  ```
- **Expected:**
  - HTTP 200, response `{ok:true, dispatched:'customer_success'}`.
  - Stage 1 (Triage, Haiku, ~$0.001): classifies as `'shipping'`.
  - Stage 2 (Draft, Sonnet 4.6, ~$0.005): generates voice-matched reply text.
  - Single briefing under "Customer Success", `briefing_type='customer_message'`, `proposed_actions=[{kind:'send_reply',params:{...}}, {kind:'dismiss_briefing'}]`.
- **Failure mode:** 401 → HMAC mismatch; check secret + signature computation matches `verifyHmac(body, header, secret)` in webhook route.
- **Failure mode:** Stage 1 only, no draft → classification was `'medical_question'` or `'spam'` (per locked decision 5 of Wave 2 — Stage 2 skipped for these). Verify via `data_snapshot.classification`.

**4.3.2 Spam classification → audit-only**
- **ID:** WAVE2-CS-002
- **Steps:** POST a clearly-spam message: `"FREE BITCOIN!!! Click here"`. Same HMAC procedure.
- **Expected:** Triage returns `'spam'`. **No briefing emitted.** Audit log row with `action='customer_success_triage_spam'`. Conversation NOT visible to Kaleem.

**4.3.3 Medical question → escalate**
- **ID:** WAVE2-CS-003
- **Steps:** POST a medical question: `"Can I take this with metformin?"`.
- **Expected:** Triage returns `'medical_question'`. Briefing emitted with `data_snapshot.classification='medical_question'`, `proposed_actions=[{kind:'dismiss_briefing'}]` only (no draft — Kaleem replies in person/manually).

**4.3.4 Approve `send_reply` (cred-present)**
- **ID:** WAVE2-CS-004
- **Prereq:** SP-API creds + Customer Messaging permission scoped.
- **Steps:** Click "Send draft reply" on a briefing.
- **Expected:** Real `createConfirmDeliveryDetails` call to SP-API. `pending_customer_messages.status='sent'`, `sp_api_message_id` populated.
- **Failure mode (cred-missing):** `pending_customer_messages.status='pending'` only — no real Amazon API call. Acceptable for stub mode.

---

## Section 5: Wave 3 agents (Fulfillment Ops · Research Analyst · Daily Digest)

### 5.1 Fulfillment Ops

**5.1.1 Cred-missing webhook test (fixture wholesalers)**
- **ID:** WAVE3-FO-001
- **Prereq:** All EzriRx + SP-API vars unset; `SP_API_WEBHOOK_SECRET` set.
- **Steps:** POST a synthetic `ORDER_CHANGE` envelope with HMAC:
  ```bash
  BODY='{"NotificationType":"ORDER_CHANGE","Payload":{"OrderChangeNotification":{"AmazonOrderId":"123-1234567-1234567","OrderStatus":"Unshipped","OrderItems":[{"ASIN":"B00FOO","SellerSKU":"OMEGA3-30CT","QuantityOrdered":1}]}}}'
  SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SP_API_WEBHOOK_SECRET" | awk '{print $2}')
  curl -X POST https://pharm1-web.onrender.com/api/sp-api/webhook \
    -H "X-PharmaDash-Signature: sha256=$SIG" -H "Content-Type: application/json" -d "$BODY"
  ```
- **Expected:**
  - Order upserted into `orders` table.
  - Fixture wholesaler comparison loaded from `vendor/edi-fixtures/wholesaler-comparison-sample.json` (5 wholesalers: ABC, McKesson, Cardinal, Parmed, EzriRx).
  - Single briefing under "Fulfillment Ops", `briefing_type='order_to_fulfill'`, `data_snapshot.comparison_table[]` has 5 rows. `proposed_actions=[{kind:'generate_purchase_order',variant:'primary',label:'PO from <best>',...}, ...4 more wholesaler options..., {kind:'dismiss_briefing',label:'Skip — handle manually'}]`.

**5.1.2 10-item cap test**
- **ID:** WAVE3-FO-002
- **Prereq:** Fixture or hand-crafted envelope with 12 OrderItems.
- **Steps:** POST envelope via webhook.
- **Expected:** Briefing carries warning `data_snapshot.warning='Order has 12 items; only first 10 processed'`. Comparison table covers items 1-10. Items 11-12 listed in `data_snapshot.skipped_items`.

**5.1.3 Approve `generate_purchase_order`**
- **ID:** WAVE3-FO-003
- **Steps:** Click "PO from ABC" (or whichever wholesaler is shown as primary).
- **Expected:**
  - HTTP 200.
  - `pending_purchase_orders` row inserted with `wholesaler='ABC'`, `proposed_unit_price`, `audit_log_id` FK, `status='pending'`.
  - Logs show `[STUB] would generate PO PDF and send 850 EDI to ABC`.
  - Undo within 30 min: row.status='cancelled'.

**5.1.4 Cred-present test (real EzriRx 832 pull)**
- **ID:** WAVE3-FO-004
- **Prereq:** `EZRIRX_SFTP_HOST`, `EZRIRX_SFTP_USER`, `EZRIRX_SFTP_KEY` all set.
- **Steps:** POST same envelope.
- **Expected:** Real SFTP fetch of latest 832 file from EzriRx. Comparison table reflects real wholesaler-stock-snapshots from the 832 parse. `data_snapshot.captured_at` reflects real 832 file date.
- **Failure mode:** SFTP timeout/auth fail → check SSH key format in `EZRIRX_SFTP_KEY` (must be PEM with newlines preserved).

### 5.2 Research Analyst

**5.2.1 Cred-missing test (real FDA, fixture Keepa)**
- **ID:** WAVE3-RA-001
- **Prereq:** `FDA_API_KEY` UNSET (uses default low rate limit but works). `KEEPA_API_KEY` UNSET.
- **Steps:** Render → `pharm1-research-analyst` cron → "Trigger Run". Note: 06:15 UTC is the regular schedule; manual is fine.
- **Expected:**
  - Logs show `[fda] no key — using default 1k/day limit`.
  - Real openFDA call to `/drug/shortage.json` and `/drug/recall.json`.
  - Logs show `[keepa] credentials missing — using fixture client` returning 5 deals.
  - 1-10 briefings emitted, each `briefing_type in ('new_opportunity','rx_shortage_adjacency','fda_recall_triggered')`, `proposed_actions=[{kind:'add_to_watchlist',params:{product_ids:[<one>], reason}}, {kind:'dismiss_briefing'}]`.
- **Failure mode:** openFDA returns 5xx → empty-results synthesized; agent emits 0 briefings (no error, just quieter day).
- **Failure mode:** All briefings are `rx_shortage_adjacency` even for OTC shortages → expected per locked decision 27 (this enum value covers both Rx-adjacency and direct OTC shortages in Wave 3).

**5.2.2 Cred-present test (real Keepa)**
- **ID:** WAVE3-RA-002
- **Prereq:** `KEEPA_API_KEY` set ($54/mo subscription active).
- **Steps:** Trigger cron.
- **Expected:** Real Keepa `/deal` and `/product` calls. Logs show `[keepa] tokensLeft=N`. Briefings include real Buy Box prices and FBA stockout signals in `data_snapshot.keepa`.
- **Failure mode:** 429 → token bucket exhausted; agent should respect `tokensLeft` and back off. Re-run after refill (typically 1 hour).

**5.2.3 Approve `add_to_watchlist` from Research Analyst** — covered by KERNEL-002.

### 5.3 Chief of Staff Daily Digest

**5.3.1 Cred-missing test (normal day with briefings)**
- **ID:** WAVE3-CS-DG-001
- **Prereq:** At least 1-2 briefings in last 24h.
- **Steps:** Render → `pharm1-chief-of-staff-digest` cron → "Trigger Run".
- **Expected:**
  - Single briefing under "Daily Digest", `briefing_type='digest'`, `proposed_actions=[]` (report-only).
  - `data_snapshot.per_agent_counts` populated, `data_snapshot.takeaways` has 3-5 strings.
  - Renders as `isReportOnly` with "Dismiss" button only.

**5.3.2 Empty-window short-circuit**
- **ID:** WAVE3-CS-DG-002
- **Prereq:** A test day with **zero** briefings in the last 24h (e.g. wipe `briefings` for a test or run on a Sunday after pausing all crons).
- **Steps:** Trigger digest cron.
- **Expected:** Logs show `[digest] no briefings in window — skipping`. **No** new briefing emitted. **No** LLM call (cost = $0). **No** error.
- **Failure mode:** Digest emits a "Nothing happened today" briefing → empty-window short-circuit broken; bug.

---

## Section 6: Webhooks (SP-API webhook ingest)

The single endpoint at `/api/sp-api/webhook` handles all NotificationTypes
through a `switch` dispatch. HMAC verification is the gate.

### 6.1 HMAC verification: 401 on bad signature
- **ID:** WH-001
- **Steps:** POST a valid-shaped envelope with header `X-PharmaDash-Signature: sha256=deadbeef`.
- **Expected:** HTTP 401, body `{error:'invalid signature'}`. **No** agent invoked. **No** audit log row.

### 6.2 HMAC: 401 on missing signature
- **ID:** WH-002
- **Steps:** POST without the `X-PharmaDash-Signature` header.
- **Expected:** HTTP 401.

### 6.3 HMAC: 401 on non-hex signature
- **ID:** WH-003
- **Steps:** POST with `X-PharmaDash-Signature: foo-bar`.
- **Expected:** HTTP 401 (constant-time hex compare rejects non-hex).

### 6.4 NotificationType: ANY_OFFER_CHANGED → dispatched to Repricer
- **ID:** WH-004
- **Steps:** POST a valid `ANY_OFFER_CHANGED` envelope with valid HMAC.
- **Expected:** `runRepricer({listing_id})` invoked. 1 briefing under "Repricer". Audit log shows webhook ingestion.
- **Failure mode:** Routed elsewhere → bug in `routeNotificationToAgent()` switch.

### 6.5 NotificationType: ACCOUNT_STATUS_CHANGED → dispatched to Account Health
- **ID:** WH-005
- **Expected:** `runAccountHealth()` invoked. Status classifier may flip.

### 6.6 NotificationType: LISTINGS_ITEM_ISSUES_CHANGE → dispatched to Account Health
- **ID:** WH-006
- **Expected:** Same as 6.5 (Account Health handles both).

### 6.7 NotificationType: ORDER_CHANGE → dispatched to Fulfillment Ops
- **ID:** WH-007
- **Expected:** `runFulfillmentOps({order})` invoked. Order upserted into `orders`. 1 briefing under "Fulfillment Ops".

### 6.8 NotificationType: ORDER_STATUS_CHANGE → dispatched to Fulfillment Ops
- **ID:** WH-008
- **Expected:** Same as 6.7. (May be a no-op if status is already terminal — log "no actionable change".)

### 6.9 NotificationType: CUSTOMER_MESSAGE_RECEIVED → dispatched to Customer Success
- **ID:** WH-009
- **Expected:** Two-stage Triage+Draft flow per WAVE2-CS-001.

---

## Section 7: Chat tools

The chat route at `/api/chat` exposes 9 tools. Three new ones added in
Wave 3: `batch_approve_briefings`, `dismiss_all_briefings`, `summarize_inbox`.

### 7.1 batch_approve_briefings
- **ID:** TOOL-001
- **Prereq:** Multiple Bookkeeper briefings in 'pending' state (use seeded data or trigger cron).
- **Steps:** In `/chat`, type: `"approve all the bookkeeper briefings"`.
- **Expected:**
  - Tool fires (visible in chat as `[tool: batch_approve_briefings { source_agent: 'bookkeeper' }]`).
  - Server-side calls `approveOne()` from `lib/kernel/approve.ts` per matching briefing.
  - Tool returns `{ approved: N, failed: 0, results: [...] }`.
  - Audit log rows for each approve. UI inbox refreshes (or refresh manually) — all bookkeeper briefings now 'dismissed' (since Bookkeeper is report-only, "approve" is acknowledge).
- **Failure mode:** Tool fires but 0 approved → filter mismatch; verify `source_agent='bookkeeper'` in tool input.
- **Failure mode:** "tool not registered" → `lib/tools/index.ts` regression.

### 7.2 dismiss_all_briefings
- **ID:** TOOL-002
- **Steps:** `"dismiss all the customer success briefings"`.
- **Expected:** Tool dismisses all matching briefings (status flips to 'dismissed'). **No** executors invoked (dismiss ≠ approve).

### 7.3 summarize_inbox
- **ID:** TOOL-003
- **Steps:** `"what's in my inbox"`.
- **Expected:** Tool returns per-agent summary like:
  ```
  Listing Agent: 2 pending
  Bookkeeper: 1 daily P&L
  Repricer: 5 (3 reprice_down, 2 hold)
  Account Health: 1 green status
  Fulfillment Ops: 0
  Research Analyst: 7 new opportunities
  Daily Digest: 1
  ```

---

## Section 8: Memory + Embeddings (Phase 1.5 fold-in)

### 8.1 Cred-missing: writeMemory inserts row with embedding=NULL
- **ID:** MEM-001
- **Prereq:** `VOYAGE_API_KEY` UNSET.
- **Steps:** Trigger Reflector cron (or manually insert via SQL using `lib/memory/write.ts:writeMemory()`).
- **Expected:** New `memory` row, `embedding IS NULL`, `embedding_model IS NULL`.
- **Failure mode:** Insert failed → `embed()` is throwing instead of returning null when key missing. File a bug.

### 8.2 pg_trgm fallback retrieval
- **ID:** MEM-002
- **Prereq:** Several memory rows with `embedding IS NULL`.
- **Steps:** Use the chat tool `search_memory("tinactin shortage")`.
- **Expected:** Tool returns matching rows ordered by trigram similarity. No vector ops attempted.

### 8.3 Cred-present: writeMemory inserts then UPDATEs with vector
- **ID:** MEM-003
- **Prereq:** `VOYAGE_API_KEY` set.
- **Steps:** Trigger Reflector cron.
- **Expected:** New rows have `embedding IS NOT NULL`, `embedding_model='voyage-4-lite'`. Cosine HNSW search returns these in vector queries.
- **Failure mode:** `embedding IS NULL` even with key set → Voyage API error swallowed; check logs for `[voyage] embed failed: ...`.

### 8.4 Backfill walks NULL rows
- **ID:** MEM-004
- **Prereq:** Some rows with NULL embedding (from MEM-001 phase) AND `VOYAGE_API_KEY` set.
- **Steps:** SSH to Render shell or run locally with cloud env: `npm run embeddings:backfill`.
- **Expected:** Logs show `[backfill] processing 100 rows`, `[backfill] updated 100 rows`, repeats until exhausted. Re-running is a no-op (idempotent).
- **Failure mode:** `429` from Voyage → respect free-tier rate limit; backfill should retry with backoff. If persistent, run in batches of 50 instead of 100.

---

## Section 9: Cron schedules

### 9.1 All 8 cron services registered
- **ID:** CRON-001
- **Steps:** Render dashboard → list all crons under `pharm1-blueprint`.
- **Expected:** 8 agent crons (listing-agent, bookkeeper, portfolio-manager, reflector, repricer, account-health, research-analyst, chief-of-staff-digest) + 2 backup crons (backup-weekly, backup-restore-test) = 10 total.

### 9.2 Manual trigger of each cron from Render UI
- **ID:** CRON-002
- **Steps:** For each agent cron, click "Trigger Run". Verify each completes successfully.
- **Expected:** Exit code 0, briefing or memory row inserted. Total cost across all 8: <$1.00.
- **Note:** Reflector takes longest (~3 min, reasoning_effort='high'); listing-agent ~1 min; others 30-90s.

### 9.3 Sunday 7am collision (portfolio_manager + chief_of_staff_digest)
- **ID:** CRON-003
- **Schedules:** Portfolio Manager `0 7 * * 0`, Chief of Staff Digest `0 7 * * *`. They collide every Sunday at 07:00 UTC.
- **Steps:** On a Sunday morning, observe Render logs across both crons. Or simulate by triggering both within 30s.
- **Expected:** Both run independently. **No** lock contention on `claude_usage` (the `pharm1-bookkeeper` race avoidance from Wave 1 used `30 23 * * 0` to dodge bookkeeper-vs-reflector clash; portfolio_manager + digest don't share data writes). Both produce their respective briefings.
- **Failure mode:** One run starves the other → check Render logs for serial-queue behavior; should not happen because Render runs cron services as independent containers.

### 9.4 Reflector vs Bookkeeper Sunday 23:00 UTC
- **ID:** CRON-004
- **Note:** Bookkeeper runs `0 23 * * *` (23:00 daily); Reflector runs `30 23 * * 0` (Sunday 23:30). The 30-minute stagger prevents `claude_usage` write race.
- **Steps:** On a Sunday around 23:00 UTC, observe both crons.
- **Expected:** Bookkeeper completes by 23:30; Reflector starts fresh at 23:30.

---

## Section 10: Backups

The backup crons are currently broken at runtime per `CLAUDE.local.md`:
`SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`, `B2_KEY_ID`, `B2_APPLICATION_KEY`
are empty.

### 10.1 Backup-weekly with B2 unset (current state)
- **ID:** BACKUP-001
- **Steps:** Render → `pharm1-backup-weekly` cron → "Trigger Run".
- **Expected (current, broken):** Cron exits non-zero with error like `B2_KEY_ID is empty`. **This is acceptable for demo state.**

### 10.2 Backup-weekly with B2 set
- **ID:** BACKUP-002
- **Prereq:** All B2 vars + `BACKUP_PASSPHRASE` + `SUPABASE_DB_URL` populated. B2 bucket `pharm1-backups` created with Object Lock + write-only key.
- **Steps:** Trigger backup-weekly.
- **Expected:**
  - Cron runs `backup-supabase.sh`: `pg_dump | gpg --symmetric --passphrase $BACKUP_PASSPHRASE | aws s3 cp - s3://pharm1-backups/pharm1-YYYY-MM-DD.sql.gpg --endpoint-url $B2_ENDPOINT_URL`.
  - Exit 0; B2 bucket has new file dated today.
  - `backup_log` row appended in Supabase.
- **Failure mode:** `pg_dump: too many connections` → add `?max_connections=1` to `SUPABASE_DB_URL`.
- **Failure mode:** B2 401 → key doesn't have write permission to the bucket. Re-issue key.

### 10.3 Backup-restore-test
- **ID:** BACKUP-003
- **Prereq:** A throwaway Supabase project for restore target. `RESTORE_TEST_DB_URL` set on the cron service (NOT the env group, per render.yaml comment).
- **Steps:** Trigger backup-restore-test.
- **Expected:** Latest B2 backup downloaded → decrypted → `psql $RESTORE_TEST_DB_URL < dump.sql`. Exit 0; row counts roughly match production.
- **Failure mode:** `gpg: bad passphrase` → mismatch between backup and restore env vars; sync them.

---

## Section 11: Middleware + Auth

### 11.1 Unauthenticated `/api/sp-api/webhook` → 401 from HMAC, NOT redirected to sign-in
- **ID:** AUTH-001
- **Steps:** `curl -X POST https://pharm1-web.onrender.com/api/sp-api/webhook -d '{}'` (no auth cookie, no signature).
- **Expected:** HTTP 401 with body `{error:'invalid signature'}`. **NOT** a redirect to `/sign-in`.
- **Why:** Per `middleware.ts` matcher, `/api/sp-api/*` is exempt from auth gating because the SP-API caller has no Kaleem cookie. HMAC is the gate.

### 11.2 Unauthenticated GET `/` → redirected to `/sign-in`
- **ID:** AUTH-002
- **Steps:** Curl with no cookie: `curl -i https://pharm1-web.onrender.com/`.
- **Expected:** HTTP 307/302 redirect to `/sign-in`.

### 11.3 Sign in via dev-login → cookie set; protected routes accessible
- **ID:** AUTH-003
- **Steps:** Per SMOKE-002. Then `curl --cookie sb-rvirlhrssgnbkjqhqjao-auth-token=... https://pharm1-web.onrender.com/`.
- **Expected:** HTTP 200 with inbox HTML. Other protected routes (`/chat`, `/api/actions/*`) also accessible.

### 11.4 `/api/health` accessible without auth
- **ID:** AUTH-004
- **Steps:** `curl https://pharm1-web.onrender.com/api/health` (no cookie).
- **Expected:** HTTP 200 (not redirected). Per matcher, `/api/health` is exempt.

---

## Section 12: Sentry

### 12.1 Sentry no-op when DSN unset
- **ID:** SENTRY-001
- **Prereq:** `SENTRY_DSN` UNSET.
- **Steps:** Trigger any error path (e.g. POST malformed body to `/api/actions/approve`). Check Sentry dashboard.
- **Expected:** **No** events received. Server logs show error normally. `lib/logger.ts:initSentry()` early-returned per design.

### 12.2 Sentry receives test error when DSN set
- **ID:** SENTRY-002
- **Prereq:** `SENTRY_DSN` set to a real Sentry project DSN.
- **Steps:** Throw a test error from a cheap path (e.g. a chat tool with intentionally bad input). Or use the Sentry test endpoint if added.
- **Expected:** Event lands in Sentry within ~30s. Stack trace visible.
- **Verify PII redaction:** If `REDACT_ENV` is set (comma-separated env-var names), values for those vars are scrubbed from stack frame variables in the Sentry event.

---

## Section 13: Cred-toggle matrix (the master table)

This table is the **single source of truth** for cred-driven behavior. Every
external dependency has a row.

| Feature | Env var(s) | Missing-behavior | Present-behavior | Pass criteria (missing) | Pass criteria (present) |
|---|---|---|---|---|---|
| OpenRouter LLM (all agents + chat) | `OPENROUTER_API_KEY` | Hard fail at startup of any agent. Health endpoint reports `llm.ok=false`. | Real LLM calls; cost tracked in `claude_usage`. | N/A (mandatory) — set this. | Agent runs to completion; `claude_usage` row inserted with `total_cost_usd>0`. |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Hard fail. Health endpoint `db.ok=false`. | Reads/writes work. | N/A (mandatory). | All sections pass. |
| Sign-in (dev-login) | `DEV_LOGIN_ENABLED`, `NEXT_PUBLIC_DEV_LOGIN_ENABLED`, `DEV_PASSWORD`, `ALLOWED_USER_EMAILS` | Sign-in via dev-login route returns 403; form is hidden in the UI. Magic-link path is the only way in. | Form visible; `POST /api/auth/dev-login` accepts `{email,password}`. | SMOKE-002 (magic-link only path) passes. | SMOKE-002 dev-login form path passes. |
| SP-API (Wave 2 + Wave 3) | `SP_API_REFRESH_TOKEN`, `LWA_CLIENT_ID`, `LWA_CLIENT_SECRET`, `SP_API_REGION`, `SP_API_MARKETPLACE_ID`, `SP_API_SELLER_ID` | All `getXxxClient()` factories return fixture clients. Repricer/Account Health agents run against `vendor/sp-api-fixtures/*.json`. Briefings carry `data_snapshot.source='fixture'` (or equivalent). | Real SP-API calls. LWA refresh-token flow caches bearer for `expires_in`. | WAVE2-RP-001, WAVE2-AH-001, WAVE3-FO-001, WAVE3-RA-001 pass with fixture data. | WAVE2-RP-002, WAVE2-AH-003, WAVE3-FO-004 pass with real seller data. |
| SP-API webhook signing | `SP_API_WEBHOOK_SECRET` | Webhook returns 401 for ALL inbound POSTs (cannot verify). | HMAC verification gates each POST. | WH-001/002/003 pass; valid POSTs (without secret on this end) all return 401. | WH-004 through WH-009 pass. |
| Twilio SMS (Account Health red) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `KALEEM_SMS_NUMBER` | `sendSms()` logs `[twilio] credentials missing — would have sent: <msg>` and returns. No SMS dialed. | Real SMS sent via Twilio API. | WAVE2-AH-002 logs the would-send message. | WAVE2-AH-003 with red-forced fixture: real SMS lands on Kaleem's phone. |
| Voyage embeddings (Phase 1.5) | `VOYAGE_API_KEY` | `embed()` returns null. Memory rows insert with `embedding=NULL`. pg_trgm fallback covers retrieval. | `embed()` returns 1024-dim vector. Insert happens, then async UPDATE sets `embedding` + `embedding_model='voyage-4-lite'`. | MEM-001, MEM-002 pass. | MEM-003, MEM-004 pass. |
| openFDA (Wave 3 Research Analyst) | `FDA_API_KEY` | Real fetch with default 1k/day rate limit. On 5xx, returns synthesized empty results. | Real fetch with 120k/day rate limit. | WAVE3-RA-001 passes (FDA call works without key). | WAVE3-RA-001 with bumped rate limit ceiling — same test passes; agent runs more often won't hit 1k/day cap. |
| Keepa (Wave 3 Research Analyst) | `KEEPA_API_KEY` | `getKeepaClient()` returns fixture client; deals + product responses are synthetic. | Real `/deal` and `/product` calls; token-bucket aware. | WAVE3-RA-001 produces fixture-flavored picks. | WAVE3-RA-002 produces real-data picks; `data_snapshot.keepa.bb_price` populated. |
| EzriRx EDI (Wave 3 Fulfillment Ops) | `EZRIRX_SFTP_HOST`, `EZRIRX_SFTP_USER`, `EZRIRX_SFTP_KEY` | `getWholesalerCatalogClient()` returns fixture client. Comparison loaded from `vendor/edi-fixtures/wholesaler-comparison-sample.json`. | Real SFTP fetch + 832 parse for the actual most-recent catalog. | WAVE3-FO-001 passes. | WAVE3-FO-004 passes; comparison data has real `captured_at`. |
| Backblaze B2 backups | `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, `B2_ENDPOINT_URL`, `BACKUP_PASSPHRASE`, `SUPABASE_DB_URL` | `pharm1-backup-weekly` and `pharm1-backup-restore-test` crons fail at runtime. | Weekly backup uploads encrypted dump to B2. Monthly restore-test verifies. | BACKUP-001 expected fail. | BACKUP-002, BACKUP-003 pass. |
| Sentry (errors) | `SENTRY_DSN`, optionally `REDACT_ENV` | `lib/logger.ts:initSentry()` early-returns. No events sent. Server logs unchanged. | Events emitted. PII scrubbed per `REDACT_ENV`. | SENTRY-001 passes. | SENTRY-002 passes. |
| Daily spend cap | `MAX_DAILY_CLAUDE_SPEND_USD` | Default in code (50) used. | Override applied. | All agents run within budget; cap returns 429 from chat route. | Same; just with whatever override. |
| OpenRouter analytics metadata | `OPENROUTER_APP_NAME`, `OPENROUTER_APP_URL` | OpenRouter dashboard groups requests under "unknown app". | Dashboard groups under "PharmaDash". | Agents work; analytics blank. | Analytics dashboard populated. |

---

## Section 14: Acceptance criteria

The system is "production ready" when:

1. **Fixture-mode (creds-missing) full pass:** Sections 1, 2, 3, plus the
   creds-missing column of Sections 4, 5, 6.1-6.3, 7, 8 (8.1, 8.2), 9.1, 9.2,
   10.1 (expected-fail acknowledged), 11, 12.1, all PASS.
2. **Real-mode (creds-present) full pass:** Sections 4-12 with all relevant
   creds populated, PASS. Backups (Section 10) passing requires B2 setup;
   Sentry (Section 12.2) requires DSN.
3. **No 5xx errors in Sentry** for 7 consecutive days under normal cron load.
4. **No PII in logs:** spot-check 24h of Render logs across all services for
   customer names, email addresses, full street addresses. Should find none —
   any PII appears scrubbed (✱✱✱✱) or absent.
5. **Audit log replay possible:** for any approved action in the last 30 days,
   the `audit_log` row contains enough data (action, payload, result) to
   reconstruct what happened.
6. **30-min undo invariant holds:** no executor action older than 30 min is
   undoable; every action newer than 30 min is undoable in <5 seconds round-
   trip.

---

## Section 15: Onboarding sequencing for Kaleem

Order in which Kaleem should obtain credentials and re-run tests. Each step
lists env vars to set + which test sections to re-run.

### Day 0 (today, fixture-mode demo)
- **Already runnable:** Sections 1, 2, 3, 7, 8.1-8.2, 9, 11, 12.1.
- **Action:** Kaleem signs in via dev-login (SMOKE-002), clicks through the 4
  seeded briefings to verify kernel UI (KERNEL-001 through KERNEL-005).

### Day 1 — start the SP-API clock + free integrations
- **Action:** Kaleem submits SP-API app per `docs/amazon-sp-api-setup.md`.
  1-4 week Amazon approval clock starts.
- **Action (parallel):** Set `FDA_API_KEY` (free, instant via api.fda.gov).
  Re-run WAVE3-RA-001.
- **Action (parallel):** Set `VOYAGE_API_KEY` (instant via voyageai.com signup).
  Re-run MEM-003, MEM-004. Reflector now produces vector-embedded memory rows.

### Day 2-3 — Backblaze + Sentry
- **Action:** Sign up for Backblaze B2; create `pharm1-backups` bucket with
  Object Lock enabled at creation; create write-only API key. Set
  `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, `B2_ENDPOINT_URL`. Set
  `BACKUP_PASSPHRASE` (`openssl rand -hex 32`) and `SUPABASE_DB_URL` (from
  Supabase project settings → Database → Connection string).
- **Action:** Sign up for Sentry; get DSN; set `SENTRY_DSN` and optionally
  `REDACT_ENV=SUPABASE_SERVICE_ROLE_KEY,OPENROUTER_API_KEY,LWA_CLIENT_SECRET,SP_API_REFRESH_TOKEN,TWILIO_AUTH_TOKEN,EZRIRX_SFTP_KEY,VOYAGE_API_KEY,KEEPA_API_KEY,B2_APPLICATION_KEY,BACKUP_PASSPHRASE`.
- **Re-run:** BACKUP-002, BACKUP-003, SENTRY-002.

### Day 5-7 — Keepa
- **Action:** Subscribe to Keepa ($54/mo, instant). Set `KEEPA_API_KEY`.
- **Re-run:** WAVE3-RA-002. Trigger `keepa-token-probe` script: `npm run keepa:token` to verify creds + see initial token bucket state.

### Day 7-10 — Twilio + 10DLC
- **Action:** Sign up for Twilio. Buy a US long-code or toll-free number.
  Submit 10DLC registration (5-7 day SMB registration). Set
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`,
  `KALEEM_SMS_NUMBER`.
- **Re-run:** WAVE2-AH-002 with red-forced fixture; verify real SMS lands.

### Day 10-14 — EzriRx EDI
- **Action:** Kaleem signs up for EzriRx (~1 week onboarding). Get SFTP host,
  user, key. Set `EZRIRX_SFTP_HOST`, `EZRIRX_SFTP_USER`, `EZRIRX_SFTP_KEY`.
- **Re-run:** WAVE3-FO-004 (real wholesaler comparison).

### Day 14-28 — SP-API approval lands
- **Action:** Amazon approves SP-API app. Capture `SP_API_REFRESH_TOKEN` via
  self-authorization flow. Set the 6 SP-API vars (`LWA_CLIENT_ID`,
  `LWA_CLIENT_SECRET`, `SP_API_REFRESH_TOKEN`, `SP_API_REGION=na`,
  `SP_API_MARKETPLACE_ID=ATVPDKIKX0DER`, `SP_API_SELLER_ID=<your seller id>`).
  Set `SP_API_WEBHOOK_SECRET=$(openssl rand -hex 32)`.
- **Action:** Run setup script: `npm run sp-api:create-subscriptions` (if
  exists; otherwise the Notifications subscription dance is documented in
  `tmp/research/2026-05-04-sp-api-comprehensive.md` §5).
- **Re-run:** WAVE2-RP-002, WAVE2-AH-003, WAVE2-CS-004, WAVE3-FO-004,
  Section 6 (all webhook tests with real SP-API push).

### Day 28+ — operational steady-state
- All 9 agents producing real data. Real Sentry monitoring. Real backups.
  This is the "ready for production" line.

---

## Final notes

- **Fixture-mode tests** (the creds-missing column of every section) can be
  run **today**, against the live cloud deployment. Kaleem can validate the
  kernel UI and inbox grouping right now.
- **Real-mode tests** unfold over 4 weeks as creds arrive. Each step adds a
  layer of real data without code changes — the cred-gate facade pattern
  guarantees this.
- **After this plan passes end-to-end in real mode**, the system is ready for
  production: propose→approve→execute round-trips work for every agent
  against real data; auto-pause + SMS work; backups work; observability works.
- **What this plan does NOT cover (deferred to later passes):**
  - Multi-pharmacy splitting (Phase 3+).
  - Staff accounts + RLS (Phase 3+).
  - Real Buyer-Seller Messaging API polling (Wave 3 polish or post-launch).
  - SQS consumer worker for SP-API push (Wave 3 polish or post-launch).
  - Real PO PDF generation (post-Wave-3 swap).
  - Google Trends signal (deferred to Phase 2.5).
  - LangSmith / Langfuse OTLP wiring (Wave 2 cross-cutting; verify
    independently if added).

End of plan.
