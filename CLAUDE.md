# PharmaDash — Repository Handoff

> **Build status:** Pre-implementation. All planning artifacts complete. Phase 1 MVP plan ready (44 tasks, confidence 9/10). Awaiting decision to start build.
>
> **Refactor status:** `COMPLETE` (2026-04-30) — cloud-only refactor done. All planning artifacts reflect the new architecture. See `tmp/ready-plans/2026-04-30-cloud-only-refactor.md` (or its moved location in `tmp/done-plans/`) for the change log.
>
> **Current architecture (as of 2026-04-30):** Cloud-only deployment on Render + Supabase + Backblaze B2. Mac mini removed. Inference layer: Claude Agent SDK (TypeScript). Orchestration: minicrew on Render worker service.

This file is the entry point for any agent or human picking up this repo cold. It contains everything needed to understand the project, the architecture, the decisions, and what to do next — without having to read every other file first.

---

## What This Project Is (60-second briefing)

**PharmaDash** is a multi-agent AI platform that automates the Amazon + eBay over-the-counter (OTC) arbitrage workflow for **Kaleem**, a licensed Utah pharmacist who owns two pharmacies (St. Mark's + Redwood Road). Kaleem already does this manually — lists ~30 OTC products on Amazon, fulfills orders by searching wholesaler portals (AmerisourceBergen / Parmed / McKesson / Cardinal) one at a time. He makes real money (one observed Tinactin sale: $51 from $7 cost during a stock-out window). The system removes the manual grind and adds intelligence he can't do by hand.

**The defensible edge:** stock-out arbitrage. Amazon's FBA-trust premium normally caps FBM-only sellers like Kaleem below the Buy Box price. But when FBA inventory is exhausted, the trust penalty disappears and FBM wins at scarcity premiums. Kaleem's licensed-pharmacy status widens his playable catalog vs random arbitrage sellers.

**The architecture in one diagram:**

```
                          ┌──────────────────────────────────┐
                          │          KALEEM (you)            │
                          │     opens app on phone/laptop    │
                          └────────────────┬─────────────────┘
                                           │
                                           ▼
                          ┌──────────────────────────────────┐
                          │      CHIEF OF STAFF              │
                          │   (the AI Kaleem chats with)     │
                          │  Inbox + Chat — single entry     │
                          └────────────────┬─────────────────┘
                                           │ coordinates
                                           ▼
            ┌──────────────────────────────────────────────────────┐
            │            9 AI SPECIALIST AGENTS                     │
            │            (running in our cloud)                     │
            │                                                       │
            │   Research    Repricer      Fulfillment   Account    │
            │   Analyst                   Ops           Health     │
            │                                                       │
            │   Customer    Bookkeeper    Portfolio     Reflector  │
            │   Success                   Manager                  │
            └──────────────────────────────┬───────────────────────┘
                                           │ all share one memory
                                           ▼
                          ┌──────────────────────────────────┐
                          │   SUPABASE (Postgres + pgvector) │
                          │   queue + data + memory + audit  │
                          └──────────────────────────────────┘
                                           │
                                           │ encrypted weekly backup
                                           ▼
                          ┌──────────────────────────────────┐
                          │   BACKBLAZE B2 (separate account)│
                          │   Object Lock + write-only token │
                          └──────────────────────────────────┘
```

**The invariant that matters:** Kaleem stays 100% in control. Agents do research and propose. **Kaleem clicks every Buy button, approves every reply, confirms every price change.** 30-minute undo on every executor action.

---

## Who's Working on This

- **Dev** (you, when reading this as an agent) — building the system. Owns architecture, code, infra.
- **Nick** — co-builder. Dev + Nick = "the team."
- **Kaleem** — the pharmacist partner. Owns the pharmacy operation, makes every system-action approval. Not a developer; reads `docs/how-this-works.md` and `docs/kaleem-meeting-2026-04-20.md` for system context.

When this CLAUDE.md says "the user," that's whoever is talking to you in chat — usually Dev.

---

## Repo State

```
~/Desktop/CODEBASES/kaleem/pharm1
│
├── git remote        : origin → https://github.com/omdiidi/pharmacy.git
│                       Do not push without explicit user approval.
│                       (Per global CLAUDE.md push policy.)
│
├── git branch        : main
│
├── code              : NONE YET
│                       This is a planning-only repo until Phase 1
│                       starts. All .md content is decision-record +
│                       design intent.
│
└── status            : Pre-implementation. 44-task Phase 1 plan ready.
```

---

## Repo Map

```
pharm1/
├── CLAUDE.md ........................... THIS FILE — read first
├── PLAN.md ............................. master overview, agent swarm, integrations, decision log
│
├── docs/
│   ├── how-this-works.md ............... Kaleem-facing explainer (one-page system overview)
│   ├── kaleem-meeting-2026-04-20.md .... meeting prep (meeting now passed; archived but referenced)
│   ├── kaleem-todos.md ................. running checklist of Kaleem-side actions
│   ├── amazon-sp-api-setup.md .......... step-by-step SP-API onboarding for Kaleem
│   ├── wholesaler-connections.md ....... supplier integration plan
│   ├── wholesaler-questions.md ......... questions to ask each wholesaler rep
│   └── emails/ ......................... 5 supplier email drafts (ABC, McKesson, Cardinal, Parmed, IPC)
│
└── tmp/
    ├── briefs/ ......................... discussion briefs — decision records
    │   ├── 2026-04-19-pharmacy-otc-platform.md
    │   └── 2026-04-30-agent-runtime-comparison.md
    │
    ├── research/ ....................... web/codebase research synthesis (versioned)
    │   ├── 2026-04-18-product-manager-research.md
    │   ├── 2026-04-30-agent-runtime-recommendation.md     ← v3 (current)
    │   └── 2026-04-30-agent-runtime-recommendation-v2.md  ← v2 (frozen snapshot)
    │
    ├── ready-plans/ .................... active implementation plans
    │   ├── 2026-04-19-phase-1-mvp.md ... 44-task Phase 1 build (the main one)
    │   └── 2026-04-30-cloud-only-refactor.md  ← active refactor plan
    │
    ├── done-plans/ ..................... shipped plans (created when first plan completes)
    │
    └── cancelled-plans/ ................ abandoned plans (created when first plan is dropped)
```

---

## Read-Order for Coming Up to Speed

```
                         ┌──────────────────────┐
                         │     CLAUDE.md        │
                         │   (this file)        │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │      PLAN.md         │
                         │   30,000-foot view   │
                         └──────────┬───────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │ runtime decision │  │ Phase 1 MVP plan │  │ how-this-works   │
    │ (v3 + v2 snap)   │  │ (44 tasks)       │  │ (Kaleem-facing)  │
    │ tmp/research/    │  │ tmp/ready-plans/ │  │ docs/            │
    └──────────────────┘  └──────────────────┘  └──────────────────┘
              │                     │
              ▼                     ▼
    ┌──────────────────┐  ┌──────────────────┐
    │ briefs (history) │  │ Kaleem todos     │
    │ tmp/briefs/      │  │ + meeting prep   │
    └──────────────────┘  └──────────────────┘
```

**For an agent ready to take action:** CLAUDE.md → PLAN.md → `tmp/ready-plans/2026-04-19-phase-1-mvp.md` is enough to start the Phase 1 build. Other docs are deep context.

---

## The 9 Agents (one-line each)

| Agent | When it runs | What it does |
|---|---|---|
| **Chief of Staff** | Always-on (chatbot) | Front-end Kaleem chats with. Curates 8 specialists' output into one Inbox. Routes Kaleem's replies. |
| **Research Analyst** | Daily 6am + ad-hoc | Pulls overnight wholesaler/Keepa/FDA/Trends data, scores opportunities, hands Kaleem 5–10 listing picks with reasoning. |
| **Repricer** | 2x daily + Keepa events | Per live listing: match Buy Box / hold / raise / drop / pause. Within rules: autonomous. Outside rules: proposes for approval. |
| **Fulfillment Ops** | On Amazon/eBay order webhook | Queries every wholesaler in real-time, shows Kaleem cross-source comparison table (price, stock, ETA), Kaleem picks. |
| **Account Health** | Daily 6am + events | Watches ODR, Late Ship, Cancellation, VTR, Buy Box %. Yellow → propose. Red → auto-pause + SMS. |
| **Customer Success** | On message webhook | Triages noise, drafts replies in Kaleem's style, escalates medical questions to him personally. |
| **Bookkeeper** | Daily 11pm + payouts | Reconciles payouts, fees, refunds. Daily P&L. Anomaly flags. Report-only — never touches money. |
| **Portfolio Manager** | Sunday 7am | Year-over-year strategic review. Proposes 3 strategic moves for the week that bind other agents. |
| **Reflector** | Sunday 11pm | Reads the week's decisions + outcomes, distills patterns into procedural playbooks + semantic memory. |

All 9 share **one memory** (Supabase pgvector with kinds: episodic / procedural / semantic / preferences). Every decision is logged with full reasoning trail in `audit_log` for replay and 30-min undo.

---

## Architecture (technical)

```
┌─────────────────────────────────────────────────────────────────────┐
│                  SUPABASE (cloud — source of truth)                  │
│                                                                      │
│  Postgres + pgvector (HNSW) + pg_trgm                                │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Tables (high level):                                            │ │
│  │   queue  : minicrew jobs / workers / worker_events              │ │
│  │   data   : pharmacies, products, listings, orders, signals,     │ │
│  │             health_metrics, wholesaler_stock_snapshots          │ │
│  │   memory : memory (kind enum), pgvector embedding column        │ │
│  │   policy : policy_rules, brand_authorization, tic_certifications│ │
│  │   audit  : briefings, inbox_items, audit_log, claude_usage,     │ │
│  │             backup_log                                          │ │
│  │   auth   : auth.users, user_pharmacy_access                     │ │
│  └────────────────────────────────────────────────────────────────┘ │
└────────┬────────────────────────────────────────────────┬───────────┘
         │ reads/writes                                    │ reads/writes
         ▼                                                 ▼
┌─────────────────────────────────────┐    ┌─────────────────────────────────────┐
│ Render — Web Service                │    │ Render — Worker Service              │
│                                     │    │                                      │
│  Next.js 14 App Router              │    │  minicrew worker                     │
│   - /sign-in (Supabase magic link)  │    │   - polls Supabase jobs queue        │
│   - / (Inbox = home)                │    │   - claims jobs by job_type          │
│   - /chat (Business Chatbot)        │    │   - invokes Claude Agent SDK         │
│   - /preview (Phase 2 placeholders) │    │      query({ ...skill prompt... })   │
│   - /api/chat (Claude API + tools)  │    │   - per-job model selection          │
│   - /api/auth/callback              │    │      (Haiku / Sonnet / Opus)         │
│   - /api/health                     │    │   - HITL hooks: PreToolUse,          │
│                                     │    │      PermissionRequest, etc.         │
│  Scheduled cron → enqueue jobs      │    │                                      │
│  (Phase 2)                          │    │  SFTP/EDI polling (Phase 2)          │
│                                     │    │   - EzriRx aggregator (30+ sources)  │
│  SP-API webhook handlers (Phase 2)  │    │   - ABC direct EDI (parallel track)  │
└─────────────────────────────────────┘    └─────────────────────────────────────┘
                                                              │
                                                              │ encrypted weekly
                                                              ▼
                              ┌─────────────────────────────────────────┐
                              │  Backblaze B2 (separate cloud account)  │
                              │   - Object Lock enabled at creation     │
                              │   - Write-only API token (no delete)    │
                              │   - 12-week lifecycle retention         │
                              │   - S3-compatible API                   │
                              │                                          │
                              │  Render Cron Jobs (~$1/mo each):         │
                              │   - Weekly: pg_dump → gpg → upload to B2 │
                              │   - Monthly: --test-restore from latest  │
                              └─────────────────────────────────────────┘
```

**Key architectural facts:**
- All compute is on Render. **No on-prem dependency.** (Mac mini was in earlier architecture; removed 2026-04-30.)
- Inference is Anthropic Claude (Opus / Sonnet / Haiku) via the **Claude Agent SDK** (TypeScript) — `@anthropic-ai/claude-agent-sdk`. Same engine as Claude Code; library form gives HITL hooks, OpenTelemetry, native skill-file loading.
- Orchestration is **minicrew** (Dev's own Supabase job-queue pattern — repo at [github.com/omdiidi/minicrew](https://github.com/omdiidi/minicrew)).
- Skill prompts are **Markdown files** at `minicrew-config/skills/*.md` — loaded by the Agent SDK's `setting_sources` config.
- Memory schema kinds: `episodic | procedural | semantic | preferences`. Phase 1 uses pg_trgm text search; Phase 1.5 adds Voyage AI embeddings into the `vector(1024)` column.

---

## Settled Architecture Decisions (Don't Re-litigate)

| Concern | Decision | Why |
|---|---|---|
| Inference layer | Claude Agent SDK (TypeScript) — `@anthropic-ai/claude-agent-sdk` | Same engine as Claude Code, library form, native HITL hooks (PreToolUse, PermissionRequest) + OpenTelemetry + skill files load identically. Anthropic's official production-recommended path. |
| Agent orchestration | minicrew — Supabase job-queue ([github.com/omdiidi/minicrew](https://github.com/omdiidi/minicrew)) | Already exists; Dev wrote it; fits the propose-then-execute pattern. |
| Database | Supabase (Postgres + pgvector + HNSW + pg_trgm) | Source of truth for queue, data, memory, audit. One DB simplifies ops. |
| Web/UI | Next.js 14 App Router on Render | Standard, mature, fast deploy. |
| Agent worker | Render worker service (TypeScript, calls Agent SDK `query()`) | Same deploy unit as web service. |
| Off-cloud backup | **Backblaze B2** with Object Lock + write-only API token, in a cloud account separate from Supabase | B2 has Object Lock GA (since 2020); cheaper than R2 at our scale ($0.006/GB vs $0.015/GB); S3-compatible API. Account separation = true air-gap. |
| EDI polling | Render with static egress IP if any wholesaler requires it (Render Pro $25/mo team minimum, OR small dedicated proxy with reserved IPv4 — verify per wholesaler) | Most wholesalers reach us via EzriRx aggregator; static IP only matters for direct connections. |
| Authentication | Supabase Auth magic-link + email allowlist | Single user (Kaleem) in Phase 1; staff accounts in Phase 2. |
| Memory | `memory` table; kinds = episodic / procedural / semantic / preferences | Single table with kind enum keeps schema simple. |
| Embeddings | Voyage AI `voyage-3` (1024-dim) deferred to Phase 1.5; trigram text search in Phase 1 | No agents writing memory in Phase 1, so embeddings not needed yet. |
| Observability | Sentry (exceptions) + `claude_usage` table + OTLP from Agent SDK → LangSmith free tier OR Langfuse (self-host) | OTLP comes from SDK for free; LangSmith/Langfuse are framework-agnostic. |
| Mac mini | **Removed.** Not load-bearing for any system function. | Pharmacy WiFi/power was a single point of failure. Kaleem keeps the device for personal use; system has zero on-prem dependency. |

**Why these specifically (deeper reading):** `tmp/research/2026-04-30-agent-runtime-recommendation.md` (v3 — current). v2 frozen snapshot at `tmp/research/2026-04-30-agent-runtime-recommendation-v2.md` for decision history.

---

## Two-POS Isolation Invariant (Non-Negotiable)

PharmaDash is **OTC-only**. The Pioneer / Heartland / prescription side of Kaleem's pharmacy is on a **completely separate POS architecture** that this system never touches.

**Reasons:**
- **HIPAA proximity:** prescription data is PHI; OTC arbitrage data isn't. Mixing them creates BAA / breach-notification surface area.
- **Licensure:** rules around handling Rx data are stricter than OTC; isolation simplifies compliance.
- **Failure isolation:** an Amazon listing bug can't propagate to Pioneer and break Rx fulfillment.

**Don't propose unifying the two systems. Don't pull Rx data into Supabase. Don't share network paths.**

---

## Project Phases

```
Phase 1 MVP — pre-agent platform              [44 tasks ready, awaiting build kickoff]
├── Supabase schema (queue + data + memory + policy + audit)
├── Next.js app (Inbox + Chat + Preview)
├── Business Chatbot (Claude API + 5 tools, real SSE streaming)
├── Auth + magic link + email allowlist
├── Skill prompt files for all 9 agents (authored, not yet running)
├── Weekly encrypted backup → B2 (Render Cron + custom Dockerfile)
└── Sentry + claude_usage + daily spend cap

Phase 1.5 — between Phase 1 and Phase 2
├── Voyage AI embeddings + memory.embedding backfill
└── Refinements based on Kaleem's chatbot use

Phase 2 — agents + integrations               [blocked: minicrew Linux port, Kaleem onboarding]
├── minicrew Linux port lands → deploy as Render worker
├── 4 user-facing agents activate (Research Analyst, Repricer, Fulfillment Ops, Account Health)
├── SP-API integration (live listings, orders, pricing, health)
├── EzriRx EDI integration
├── Keepa subscription + integration
├── FDA Drug Shortage + Recall + Google Trends
└── Remaining agents: Customer Success, Bookkeeper, Portfolio Manager, Reflector

Phase 3+ — expansion
├── Own-store e-commerce
├── Halal/kosher private-label vitamins
├── TikTok store + AI video gen
├── Multi-pharmacy split (if useful)
└── Staff accounts + RLS
```

---

## What's Pending (Not Yet Done)

- **Decision to start Phase 1 build** — 44-task ready-plan exists; awaiting user's go-ahead.
- **Kaleem-side onboarding:**
  - SP-API app submission (1–4 wk Amazon approval) — full procedure in `docs/amazon-sp-api-setup.md`
  - ABC email send — draft in `docs/emails/abc-order-data-exchange.md`
  - NDA signing
  - Blind-ship confirmations from each wholesaler
  - TIC certification status check on top supplement brands
- **minicrew Linux port** — separate stream; should target generic Linux container (Render compatible), NOT Mac-specific build. Coordinate with parallel-track work before the port lands so worker-spawning code targets `query()` (Agent SDK) not `claude -p` (CLI) from the start.
- **Static egress IP check** — verify with each wholesaler rep before Phase 2 whether SFTP / EDI feeds require a fixed source IP.
- **Phase 2 day-1 spike** — when Phase 2 starts, prove Agent SDK runtime with one agent (Bookkeeper recommended — simplest: daily cron, single-pass reasoning, one DB write) end-to-end before porting the rest.
- **GitHub remote setup** — per `PLAN.md` Next-steps item 1.

---

## Three Concrete "Pick Up Here" Options

### Option 1 — Start Phase 1 implementation

```bash
# Run this:
/implement tmp/ready-plans/2026-04-19-phase-1-mvp.md
```

This kicks off the 44-task Phase 1 build:
- Supabase schema (5 migrations)
- Next.js 14 app with sidebar nav (Inbox / Chat / Preview)
- Business Chatbot with Claude API + 5 tools (real SSE streaming, auth gate, rate limit, daily budget guard)
- Auth flow (Supabase magic-link + email allowlist + user_pharmacy_access bootstrap)
- minicrew config + 9 skill prompt files (authored as files, runnable when minicrew Linux port lands)
- Weekly encrypted backup to Backblaze B2 (Render Cron Job, custom Dockerfile)
- Sentry + claude_usage tracking + daily spend cap
- Health check endpoint + Render zero-downtime deploys

Confidence: 9/10 for one-pass success after 3 reviewer passes. Full plan at `tmp/ready-plans/2026-04-19-phase-1-mvp.md`.

### Option 2 — Update Kaleem-side onboarding

Open `docs/kaleem-todos.md` for the working checklist. Send the ABC email draft from `docs/emails/abc-order-data-exchange.md`. Verify SP-API app submission timeline. Coordinate with Kaleem on TIC supplement brand list and blind-ship confirmation emails from each wholesaler.

### Option 3 — Validate the runtime decision early (de-risking spike)

Before the full Phase 2 build, prove the stack composes by building **one** Agent SDK worker template against the seeded data. Pick the Bookkeeper agent (simplest — daily cron, single-pass reasoning, writes one report row, no executor branch). Confirm five things:

1. Skill file (`minicrew-config/skills/bookkeeper.md`) loads via `setting_sources` / `settingSources` config
2. `PreToolUse` hook fires when the agent calls a tool
3. OTLP traces export to a chosen backend (LangSmith free tier or Langfuse self-host)
4. `total_cost_usd` from each `query()` call lands in `claude_usage` correctly
5. Worker can be killed mid-run and minicrew's `attempt_count` retry logic re-runs the job cleanly

Time-box to 1–2 days. If any step fails, escalate before porting other agents.

---

## Critical External Dependencies

| Dependency | Status | Reference |
|---|---|---|
| Supabase | Account needed; Phase 1 uses local + cloud project | [supabase.com](https://supabase.com) |
| Render | Account needed; web + worker + cron services | [render.com/docs](https://render.com/docs) |
| Anthropic Claude API | API key required | [docs.anthropic.com](https://docs.anthropic.com) |
| Claude Agent SDK | `npm i @anthropic-ai/claude-agent-sdk` | [code.claude.com/docs/en/agent-sdk](https://code.claude.com/docs/en/agent-sdk) |
| minicrew | Dev's own repo, parallel-stream Linux port pending | [github.com/omdiidi/minicrew](https://github.com/omdiidi/minicrew) |
| Backblaze B2 | Separate account from Supabase; Object Lock at bucket creation | [backblaze.com/b2](https://www.backblaze.com/cloud-storage/object-storage) |
| Keepa API | $54/mo (Phase 2) | [keepa.com](https://keepa.com) |
| Amazon SP-API | Free; 1–4 week gating | `docs/amazon-sp-api-setup.md` |
| EzriRx EDI | Onboarding via Kaleem's pharmacist account (Phase 2) | TBD |
| LangSmith (optional) | Free tier 5k traces/mo | [langchain.com/langsmith](https://www.langchain.com/langsmith) |
| Langfuse (alternative) | Self-host (free) or hosted | [langfuse.com](https://langfuse.com) |
| Sentry | Free tier | [sentry.io](https://sentry.io) |

---

## Credentials Pattern

Per global `~/.config/claude/credentials.md` pattern (see global CLAUDE.md). When keys are needed for Phase 1 implementation:

1. Read `~/.config/claude/credentials.md` to see what's available.
2. Always invoke `/load-creds` (don't inline the bash flow).
3. Use the same env-var names as the catalog when generating `.env.example`.
4. Never echo resolved secret values; reference by env var name only.

If `op whoami` fails, the user needs to enable 1Password desktop app integration or set `OP_SERVICE_ACCOUNT_TOKEN`.

---

## Artifact-Type Conventions

```
tmp/briefs/         Decision records. Preserve body content; add architecture-update
                    callouts at the top if decisions change. Don't rewrite history.
                    Exception: brief written today + same-day decision contradiction
                    → fix in place.

tmp/research/       Versioned research reports. Major changes preserve prior version
                    as <name>-v<N>.md snapshot, then bump active version in place.
                    Don't lose decision history.

tmp/ready-plans/    Living plans. Edit freely until shipped.

tmp/done-plans/     Shipped plans (move here after /implement completes).

tmp/cancelled-plans/ Abandoned plans.

docs/               Operational docs. Living. Edit freely.

CLAUDE.md           Repo-root handoff (this file). Update when architecture or
                    workflow conventions change.
```

The `tmp/done-plans/` and `tmp/cancelled-plans/` directories don't exist yet — create on first use.

---

## Conventions Specific to This Repo

- **Documentation discipline:** After any change, update affected `.md` files. The doc-to-code mapping is implicit in `PLAN.md`'s "Documentation map" section — keep that section authoritative.
- **No code yet:** This is a planning-only repo until Phase 1 starts.
- **Briefs are decision history:** Don't edit brief content unless the brief was written *today* and contradicts a same-day decision. Otherwise add architecture-update callouts at the top.
- **Plans are living artifacts** until shipped: `tmp/ready-plans/` is active, `tmp/done-plans/` is shipped.
- **Research reports are versioned:** preserve `-v<N>` snapshot before major rewrites.
- **No emojis in code or docs** (per global CLAUDE.md unless user explicitly asks).
- **No mocking the database in tests** (when tests come): use a real Supabase test project. Reason: prior incidents where mock/prod divergence masked broken migrations.

---

## Things to Never Do

```
NEVER PUSH TO REMOTE WITHOUT EXPLICIT USER APPROVAL
   Applies to all branches, all remotes, no exceptions.
   Always show what will be pushed and ask for confirmation first.
   (Per global CLAUDE.md push policy.)

NEVER REINTRODUCE THE MAC MINI AS LOAD-BEARING INFRA
   Settled 2026-04-30. If user changes their mind, *they say so explicitly*
   and we revisit. Don't drift back. Mac mini is removed because pharmacy
   WiFi/power was a single point of failure for a business-critical system.

NEVER ADOPT LANGCHAIN OR LANGGRAPH WITHOUT REVISITING THE RUNTIME RECOMMENDATION
   The propose-then-execute architecture doesn't benefit from LangGraph's
   interrupt() durability; this was researched in detail. See
   tmp/research/2026-04-30-agent-runtime-recommendation.md v3.

NEVER USE CLAUDE CODE CLI (`claude -p`) AS THE AGENT RUNTIME IN PRODUCTION
   Use the Agent SDK library form. Same engine; different ergonomics. CLI is
   designed for interactive dev work; Anthropic recommends SDK for production.

NEVER AUTO-PURCHASE, AUTO-SEND TO CUSTOMERS, OR AUTO-LIST WITHOUT KALEEM'S CLICK
   Human-in-loop is invariant. Kaleem clicks every executor write; 30-min
   undo on every action. The system proposes; he decides.

NEVER TOUCH PIONEER / HEARTLAND / PRESCRIPTION DATA
   Two-POS architecture, OTC-only. See "Two-POS Isolation Invariant" above.

NEVER COMMIT .env, CREDENTIALS, *.key, *.pem
   Use .gitignore discipline; never `git add -A` blindly.

NEVER SKIP HOOKS (--no-verify, --no-gpg-sign, --no-edit on rebases)
   Unless user explicitly requests it. If a pre-commit hook fails, fix the
   underlying issue and create a new commit. Don't amend commits in a way
   that bypasses safety checks.
```

---

## Useful Commands

```bash
# Start Supabase locally (when Phase 1 build starts)
cd /Users/omidzahrai/Desktop/CODEBASES/kaleem/pharm1
supabase start
supabase db reset                # apply migrations from tmp/ready-plans Phase 1 schema
supabase gen types typescript --local > lib/supabase/types.ts

# Run the Phase 1 build
/implement tmp/ready-plans/2026-04-19-phase-1-mvp.md

# Search for stale Mac-mini references (post-refactor verification)
grep -rni "Mac mini\|the mini\|his mini\|kaleem's mini\|pharmacy WiFi\|pharmacy power\|tmux\|systemd\|at the pharmacy\|Linux Mint\|Intel 8GB" \
  --include="*.md" --include="*.sql" --include="*.yaml" \
  /Users/omidzahrai/Desktop/CODEBASES/kaleem/pharm1/

# Find which docs reference a specific file
grep -rln "PLAN.md\|how-this-works.md" --include="*.md" .
```

---

## If You're a Fresh Agent: First-Run Checklist

```
□ Read this file (CLAUDE.md) end-to-end.
□ Read PLAN.md for the 30,000-foot view.
□ Read tmp/research/2026-04-30-agent-runtime-recommendation.md (v3) for the runtime decision.
□ Skim tmp/ready-plans/2026-04-19-phase-1-mvp.md if Phase 1 build is the goal.
□ Identify which "Pick Up Here" option fits the user's request.
□ Ask the user to confirm before taking action that affects more than one file
  or that touches anything outside tmp/ or docs/.
```

After reading these, you should have enough context to execute any of the three pickup options without reading the full repo. If you need deeper context on a specific topic (memory schema details, Amazon SP-API specifics, etc.), the targeted docs are listed above.

@CLAUDE.local.md
