# Brief: Phase 2 Waves 1–3 — Build All 8 Remaining Agents End-to-End

> Written 2026-05-04. Roadmap for the rest of Phase 2. Each wave gets its own
> `/plan` cycle with 3 reviewer passes, its own `/implement`, its own test pass,
> and its own `/document` refresh before the next wave starts.

## Why
Listing agent (Layer 2) is shipped and live. The kernel works. We have 8 agents
left to build, some blocked on external data sources, all buildable today
against mocks using the same propose-only pattern as the Listing agent. Goal:
ship all 8 in three sequenced waves while Kaleem's SP-API + EzriRx + Keepa
onboarding lands in parallel. When real data arrives, swap stub executors for
real calls — kernel doesn't change.

## Direction
3 waves, sequential. Each wave is self-contained: own plan, own reviews, own
implement, own tests, own docs refresh. **Autonomous build — Dev runs end-to-end
with no user gates between waves.** No big-bang release; each agent goes live
the day it's reviewed and merged.

## Operating Mode (locked 2026-05-04)
- **Autonomous.** User pre-approved all 3 waves + pushes + reviewer-pass
  judgement calls. No check-ins between waves; only stop on a true blocker
  (e.g. API requires something fundamentally unmockable, or a locked decision
  in this brief is contradicted by reality).
- **Real APIs, not mocks.** Build against actual SP-API / EzriRx / Keepa / FDA /
  Google Trends / Voyage shapes. Credential-gate every external client: if
  the env var is set, call the real API; if missing, fall back to a fixture
  that matches the real response shape. End-state: user enters credentials
  and the agents go live without code changes.
- **Research first.** Before each wave's `/plan`, spawn dedicated researcher
  agents to pull primary documentation for every external API touched in that
  wave. Save dossiers to `tmp/research/`. Plans cite those dossiers.
- **Final deliverable:** after Wave 3 ships, produce a comprehensive E2E test
  plan (`tmp/ready-plans/2026-05-XX-comprehensive-e2e-test.md`) covering every
  feature × {creds-present, creds-missing} matrix. User runs this once
  credentials are entered to verify the system works end-to-end.

## API Documentation Requirements
For each external API touched, the researcher dossier must include:
- Auth model (OAuth flow, token refresh, header shape)
- Endpoints used + URL patterns + HTTP methods
- Request payload shapes (TypeScript interfaces)
- Response shapes (TypeScript interfaces)
- Rate limits + retry/backoff behavior
- Sandbox/dev-key availability
- Known gotchas (pagination, partial failures, eventual consistency)
- Cost model (free / per-call / monthly subscription)
- Fixture data shape (so creds-missing fallback returns realistic shape)

APIs we'll need dossiers for:
- **Wave 2:** Amazon SP-API (Listings, Pricing, Notifications, Customer
  Messaging), Resend or Twilio (SMS for Account Health red alerts)
- **Wave 3:** Amazon SP-API (Orders, Reports), FDA Drug Shortage + Recall,
  Google Trends, Keepa, EzriRx, Voyage AI embeddings (Phase 1.5 folded in)

---

## Wave 1 — Self-contained agents (no mocks needed)

**Agents:** Bookkeeper · Reflector · Portfolio Manager

**Why first:** zero external dependencies. They read from our own Supabase
tables (orders, audit_log, memory, briefings). They prove the
agent-writing-to-memory loop end-to-end. Cheapest to validate.

**What they do:**
- **Bookkeeper** — daily 11pm cron. Reads `orders`, `claude_usage`, fees,
  refunds. Writes daily P&L row + anomaly flags as briefings. Report-only,
  never proposes executor actions.
- **Reflector** — Sunday 11pm cron. Reads the week's `audit_log` +
  `briefings` (status='acted' vs 'rejected'). Distills patterns into
  `memory` rows (kind=procedural for "Kaleem always rejects X" /
  kind=semantic for "tinactin shortage Q4 pattern").
- **Portfolio Manager** — Sunday 7am cron. Reads `memory` + last 30 days of
  audit_log. Proposes 3 strategic moves for the week as briefings (each with
  `proposed_actions` for the kernel — e.g. "add 5 SKUs to watchlist", "pause
  brand X").

**Gate to start:** smoke test of current Listing agent kernel (you click
through the 4 seeded briefings successfully).

**Steps:**
1. `/plan` — feature: Wave 1 agents (3 agents, 3 cron jobs, memory-write
   plumbing, briefing types: `weekly_strategy`, `pattern_extracted`,
   `daily_pnl`)
2. Plan reviewer × 3 (per /plan skill Step 5 — present findings, fold in,
   re-review)
3. User approves final plan
4. `/implement` — single primary implementer
5. Tests:
   - Unit: each agent's prompt returns valid JSON shape
   - Integration: cron run end-to-end on cloud Render produces ≥1
     briefing row + ≥1 memory row
   - Manual: user clicks Approve on a Portfolio Manager briefing,
     confirms `add_to_watchlist` executor stub fires
6. `/document` — refresh `docs/` with new agents
7. Move plan → `tmp/done-plans/`
8. Commit + push (with user approval)
9. Smoke gate → Wave 2

**Estimated scope:** ~600–900 LOC. Three skill prompt files (already authored).
Three executors: `add_to_watchlist`, `pause_brand`, `flag_anomaly` (all
write-to-DB only — no external API calls).

**External blockers:** none.

---

## Wave 2 — Mock-driven agents (real-data shape, stub executors)

**Agents:** Repricer · Account Health · Customer Success

**Why second:** same shape as the Listing agent — propose-only against mocked
data, executor stubs ready to swap when SP-API approves. By end of Wave 2 we
have 6 agents shipped and the propose→approve→execute pattern is rock-solid.

**What they do:**
- **Repricer** — 2×/day cron + on-event. Reads mocked Buy Box prices for
  watching products. Per listing: proposes match / hold / raise / drop /
  pause with reasoning. **Never auto-changes** (locked decision).
- **Account Health** — daily 6am + on-event. Reads mocked SP-API metrics
  (ODR, Late Ship, Cancellation, VTR, Buy Box %). Yellow → propose action.
  Red → auto-pause listing + SMS Kaleem (only auto-pause; SMS is via
  Resend or Twilio).
- **Customer Success** — on mocked message webhook. Triages
  noise/escalation/medical. Drafts replies in Kaleem's voice.

**Gate to start:** Wave 1 deployed and one full week of cron runs observed
(Bookkeeper has produced 7 P&Ls, Reflector has run once on Sunday).

**Steps:**
1. `/plan` — feature: Wave 2 agents (3 agents, mock fixtures for SP-API
   shape, executors: `reprice`, `pause_listing`, `send_reply`,
   `pause_pharmacy`)
2. Plan reviewer × 3
3. User approves
4. `/implement`
5. Tests:
   - Unit: executor stubs write expected `pending_*` rows
   - Integration: each agent run produces valid `proposed_actions`
   - Manual: full propose → approve → execute → undo loop on each agent
   - Regression: Wave 1 agents still pass their tests
6. `/document` refresh
7. Commit + push (with approval)
8. Smoke gate → Wave 3

**Estimated scope:** ~900–1200 LOC. Heavier mock-fixture work (SP-API order
shapes, message shapes, metrics shapes). Skill prompt files already authored.

**External blockers:** none for build. SP-API approval needed before stubs
become real (handled in post-Wave-3 swap pass).

---

## Wave 3 — Heavy UI + coordination

**Agents:** Fulfillment Ops · Research Analyst · Chief of Staff (upgrade)

**Why last:** most UI work + best done once we have 6 agents producing inbox
traffic to coordinate. Chief of Staff in particular needs all 8 specialists
running so it has something to coordinate.

**What they do:**
- **Fulfillment Ops** — on mocked Amazon/eBay order webhook. Queries mocked
  wholesalers (ABC, McKesson, Cardinal, Parmed, EzriRx aggregator). Renders
  cross-source comparison table (price, stock, ETA). Kaleem picks → executor
  generates PO PDF (stubbed → writes to `pending_purchase_orders`).
- **Research Analyst** — daily 6am cron. Single-pass (no 8-fanout — locked
  decision). Pulls overnight FDA shortage + recall + Google Trends + mocked
  Keepa data. Scores opportunities. Hands Kaleem 5–10 listing picks with
  reasoning as briefings (each with `add_to_watchlist` action).
- **Chief of Staff upgrade** — already half-built at `/chat`. Add: read
  pending briefings across all 8 specialists, summarize daily digest, route
  Kaleem's natural-language replies back into `proposed_actions` (e.g.
  "approve all the Bookkeeper anomalies" → batch approve API call).

**Gate to start:** Wave 2 deployed, one full week observed.

**Steps:**
1. `/plan` — feature: Wave 3 (3 components, comparison-table UI,
   wholesaler-mock fixtures, FDA + Google Trends real integration since
   they're free + no approval needed, Chief of Staff routing extensions)
2. Plan reviewer × 3
3. User approves
4. `/implement`
5. Tests:
   - Unit: comparison table renders 5 wholesaler rows, sorts correctly
   - Integration: order webhook → Fulfillment Ops → comparison briefing
   - Manual: full Research Analyst run produces 5+ picks; Chief of Staff
     daily digest renders; batch-approve from chat works
   - Regression: Waves 1+2 still pass
6. `/document` refresh
7. Commit + push
8. Smoke gate → SP-API real-data swap pass

**Estimated scope:** ~1200–1500 LOC. Heaviest UI work. FDA + Google Trends
integration is real (not mocked — both APIs are free).

**External blockers:** Keepa subscription ($54/mo, instant) for Research
Analyst real signals — buildable against mocks first, swap when subscription
lands.

---

## Post-Wave Pass — Real Data Swap

**Trigger:** SP-API approval lands (1–4 weeks from Kaleem submitting app).

**Scope:** swap stub executors for real SP-API / EzriRx / Keepa calls. No
agent logic changes — only the executor implementations change. Each swap
gets its own commit, own smoke test, own propose-approve-execute walk-through
on real data with Kaleem watching.

This is **not** a wave — it's a series of 1–2 hour swaps spread over a few
days as each external dependency lands.

---

## Cross-cutting work (folded into each wave)

These don't get their own waves; they're added to whichever wave naturally
includes them:

- **Wave 1:** memory-write plumbing (procedural / semantic / preferences),
  inbox grouping by agent, Sentry DSN
- **Wave 2:** OTLP traces from Agent SDK → LangSmith free tier, additional
  executors
- **Wave 3:** Voyage AI embeddings + memory.embedding backfill, more
  executors

**Always-on cleanups (do as we touch nearby code, not their own tasks):**
- Sign-in error key map fix
- Add missing env vars to `.env.example`
- Commit untracked `docs/render-deploy-runbook.md`
- Move shipped plans to `tmp/done-plans/`

---

## Decisions
- **Sequential waves, not parallel** — reason: each wave's smoke test is the
  gate. Parallel waves means broken kernel changes from wave N can break
  wave N+1's tests, and we lose the propose-approve-execute invariant we just
  built.
- **3 reviewer passes per wave** — same as we did for Layers 1+2. Caught real
  blockers each time. User explicitly approved 3 passes upfront for each
  wave.
- **Wave 1 = self-contained agents first** — reason: prove the
  agent-writing-to-memory loop with zero external dependencies before any
  mock-fixture work.
- **Wave 3 = Chief of Staff last** — reason: it coordinates the other 8.
  Building it before they exist means mocking the things it coordinates,
  which is exactly the kind of mock-debt we want to avoid.
- **Real-data swap is post-Wave-3, not folded in** — reason: SP-API timeline
  (1–4 weeks) is independent of our build schedule. Don't gate code on it.
- **Tests in each wave include manual click-through, not just unit** — reason:
  the kernel UI is the user-facing surface; unit tests don't catch UX bugs.
- **`/document` runs after each wave, not just at end** — reason: keeps
  `docs/` from drifting; future cold-read agents need accurate state.
- **Cross-cutting work folded into waves, not its own wave** — reason: lower
  mental overhead, work happens where it's most contextual.

## Rejected Alternatives
- **Big-bang: build all 8 agents in one /plan + /implement** — rejected.
  Reviewer pass on a 30+ task plan would be useless. Implementation would
  drift. Single wave already produced 13 NEW + 10 MODIFIED files; 3× that is
  unmaintainable.
- **Parallel waves** — rejected for invariant-preservation reasons above.
- **Wave 1 = Repricer (the obvious "next" agent)** — rejected. Repricer needs
  Buy Box mock fixtures. Bookkeeper/Reflector/Portfolio Manager need zero
  fixtures, ship faster, prove memory loop earlier.
- **Skip /document between waves** — rejected. Doc drift is the #1 reason
  cold-read agents waste time.
- **Skip 3 reviewer passes after Wave 1, drop to 2 for Waves 2+3 since we'll
  have momentum** — rejected. Each wave's failure modes are different enough
  that 3 passes still catches material issues. User explicitly approved 3
  passes upfront.

## Direction Forward
**Immediate next step:** user clicks through current 4 seeded briefings on
cloud (smoke-test gate to start Wave 1). Once that's green, run
`/plan tmp/briefs/2026-05-04-phase-2-waves-1-2-3-roadmap.md` scoped to
**Wave 1 only** — that produces the first wave-specific plan, runs 3 reviewer
passes, presents for approval.

After Wave 1 ships, repeat for Wave 2, then Wave 3.

In parallel: Kaleem starts SP-API app submission today
(`docs/amazon-sp-api-setup.md`) so the 1–4 week clock runs while we build.
