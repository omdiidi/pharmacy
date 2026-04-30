# Plan — Cloud-Only Architecture Refactor (Drop Mac Mini)

**Date:** 2026-04-30
**Revision:** v2 — after 3 reviewer passes (synthesized into one revision)
**Type:** Documentation + planning artifact refactor (no code changes — pre-implementation project)
**Owner:** Dev
**Goal:** Update every planning artifact to reflect a fully cloud-deployed PharmaDash. The Mac mini is no longer load-bearing for any system function. Establish pristine handoff state via a `CLAUDE.md` so a fresh instance can pick up immediately.

## Changelog

### v1 → v2 (2026-04-30, after 3 reviewer passes)

Three independent plan-reviewers flagged **18 must-fix or should-fix issues** plus **6 quality polish items**. v2 incorporates all of them. Highlights:

**Sequencing change:**
- **CLAUDE.md authoring moves to T1 (was T9).** A handoff file should exist *during* the refactor so a session compaction or interruption mid-edit doesn't leave the repo in an unrecoverable state. T1 writes CLAUDE.md with a "refactor in progress" status header; final task (T9) updates it to "refactor complete."

**Backup-target change:**
- **Switched recommendation from Cloudflare R2 to Backblaze B2.** Reason: B2's Object Lock is GA (since 2020); R2's is recent/limited. For air-gapped backup, you want Object Lock + a write-only API token to prevent a compromised Render credential from `rm -rf`-ing the backup bucket. B2 also costs 60% less per GB at our scale ($0.006/GB vs $0.015/GB). Both are S3-compatible APIs so the script doesn't change shape.

**Recommendation-versioning change:**
- **v2 of the runtime-recommendation report gets preserved as a frozen snapshot file** (`2026-04-30-agent-runtime-recommendation-v2.md`) rather than overwritten. v3 lives at the original path. Decision history is auditable — two months from now if anyone asks "what was the hybrid option?" the answer is on disk, not lost to a `git log` archaeology dive.

**Heavy-edit scope expansion:**
- **T7 (kaleem-meeting prep) is now spec'd as the largest editing task in the refactor**, not "possible no-op." That doc has the heaviest mini content of any file (architecture diagram + ~58-line dedicated section + infra-questions block + timeline + cost line). Every section is enumerated with line ranges and explicit delete-vs-rewrite calls.
- **PLAN.md (T4) and Phase 1 MVP plan (T6) line-level enumerations expanded** — line 79, 81, 177, 288, 289, 332 in PLAN.md; lines 139, 240, 303, 1243 in Phase 1 MVP plan all explicitly listed.

**Brief-handling correction:**
- **`tmp/briefs/2026-04-30-agent-runtime-comparison.md` body gets fixed in place** rather than only an addendum appended. The brief was written *today*; treating today's-own-document as immutable was overcautious, and an addendum can't override contradictions in the body without inline callouts. Lines 11, 15, 29, 49, 70 get edited.
- **`tmp/briefs/2026-04-19-pharmacy-otc-platform.md`** (April 18 brief) keeps the historical-callout treatment but adds a 6-character inline strike-through of "— workhorse for agent runtime" on line 48 to prevent the brief body from reading as flat factual lie.

**Stakeholder-reframing addition:**
- **T5 and T7 add explicit "why the change" framing for Kaleem.** The meeting prep sold the mini as a *feature* ("$0 hardware cost", "his existing mini is ideal", "off-hours idle"). A bare flip without acknowledging that prior framing risks Kaleem feeling sold-then-taken-back. The new language: *"Why the change: keeping system uptime independent of your pharmacy's WiFi/power. Your mini is still useful — it just isn't load-bearing for the system anymore."* Plus reaffirm Pioneer/Rx isolation (preserved in cloud) and a one-line data-residency note ("US-region, encrypted at rest").

**Cost-arithmetic correction:**
- **`docs/how-this-works.md` line 255 cost claim ($360-680/mo)** was computed assuming free Mac mini compute. Adding Render worker service ($10-25/mo) + B2 backup bucket ($1-3/mo) + Render Cron Jobs ($1/mo each, budget $2/mo for weekly-backup + monthly-restore-test) shifts the bottom of the range. Updated.

**Honesty fixes on cloud-architecture details:**
- **R2 air-gap claim was oversold in v1.** v2 explicitly states the Object-Lock + write-only-token requirement and uses B2 (where this is GA).
- **Static IP from Render was oversold.** v2 frames as "Render Pro static IP **OR a small dedicated proxy with a reserved IPv4** — verify per wholesaler before committing." Render Pro is $25/mo team minimum and the IP can change on regional redeploy.
- **`pg_dump` is not in Render's standard runtime images.** v2 adds [NEEDS CLARIFICATION] flagging that the cron job needs a custom Dockerfile with `postgresql-client` + `aws-cli` packages.

**Verification gate hardening:**
- **T10 grep expanded.** Now includes: `the mini`, `his mini`, `Kaleem's mini`, `tmux`, `systemd`, `pharmacy WiFi`, `pharmacy power`, `pharmacy internet`, `at the pharmacy`, `Intel 8GB`. Added `-i` case-insensitive flag. Includes `*.sql` and `*.yaml` in addition to `*.md`. Tracks reference counts before/after per file as a regression bar (concrete numbers in T10).

**CLAUDE.md content depth:**
- **Resolves the git-remote contradiction** between PLAN.md ("not yet set") and the meeting prep ("at omdiidi/pharmacy"). Authoritative answer: not set yet — that's a pending Next-step from PLAN.md.
- **Adds team identification** (Dev + Nick is the team; Kaleem is the pharmacist partner — important so a fresh AI session knows who it's collaborating with).
- **Adds supporting docs** (`docs/wholesaler-*.md`, `docs/emails/*.md`, `docs/amazon-sp-api-setup.md`) under a "supporting docs (read on demand)" subsection.
- **Adds artifact-type conventions** (briefs vs research vs ready-plans vs done-plans).
- **Adds minicrew GitHub URL** (`https://github.com/omdiidi/minicrew`) so a fresh AI can find context.
- **Adds Pioneer/Heartland/HIPAA isolation context** alongside the "never do" — *why*, not just *what*.

**Quality polish:**
- **Backup script pseudocode lives only in the Phase 1 MVP plan**, not duplicated here (eliminates future-drift risk).
- **PLAN.md decisions log:** earlier rows ("Memory on Supabase with weekly local backup", "No local AI models on Mac mini") get superseded notes alongside the new 2026-04-30 entry.
- **Rollback note added** at the end of the plan (one sentence — doc-only refactor, git-revertable).
- **Editor's-note that slipped through v1 cleaned up** ("— wait, that one stays").

## Why This Plan Exists

After completing the four-phase agent-runtime research (see `tmp/research/2026-04-30-agent-runtime-recommendation.md` v2), the user pushed back on the v2 hybrid recommendation ("cloud primary, mini for EDI + backup") with a sharper question: *if the mini is no longer load-bearing for agents, why keep it in the architecture at all?* Honest answer: we shouldn't.

The mini's two retained roles in v2 — IP-allowlist EDI polling and off-cloud backup — both have cleaner cloud-native solutions. Render supports static outbound IPs on Pro tier (or any small relay box does). Encrypted backups can land in **Backblaze B2** (S3-compatible, with Object Lock GA) for the same air-gapped property without on-prem hardware.

This plan refactors all docs to match the cleaner architecture, then bootstraps a `CLAUDE.md` so future sessions pick up where we left off without context loss.

## Settled Decisions (from briefs — not re-litigating)

From `tmp/briefs/2026-04-19-pharmacy-otc-platform.md` and `tmp/briefs/2026-04-30-agent-runtime-comparison.md`:

- **Inference layer:** Claude Agent SDK (TypeScript) — `@anthropic-ai/claude-agent-sdk`. Same engine as Claude Code, library form, native HITL hooks + OpenTelemetry, skill files port without rewrite.
- **Orchestration:** minicrew (Dev's Supabase job-queue pattern, [github.com/omdiidi/minicrew](https://github.com/omdiidi/minicrew)). Worker template invokes `query()` from the SDK.
- **Source of truth:** Supabase (Postgres + pgvector). All queue/data/memory/audit tables.
- **Web/UI:** Next.js 14 on Render.
- **Updated 2026-04-30:** **All compute is on Render. The Mac mini is removed from the architecture.**
- **Updated 2026-04-30 (v2 plan revision):** **Backup target: Backblaze B2 with Object Lock + write-only API token** (in a cloud account separate from Supabase). Cloudflare R2 / AWS S3 are also acceptable; B2 is the primary recommendation because Object Lock is GA + cheaper.

## Convention rule (so future refactors don't re-derive this)

- **Briefs (`tmp/briefs/*.md`)** are decision records. Preserve body content; if architecture changes contradict the body, add a top-of-doc callout. **Exception:** if the brief was written *today* and contains language that contradicts a decision finalized *today*, fix in place (don't outdate yourself in a callout).
- **Plans in `tmp/ready-plans/*.md`** are living artifacts. Edit freely until they hit `tmp/done-plans/*.md` (moved after `/implement` completes).
- **Research reports (`tmp/research/*.md`)** are versioned. When making major changes, preserve the previous version as a frozen snapshot file (`<name>-v<N>.md`) and bump the active version in place. Don't lose decision history.
- **Operational docs (`docs/*.md`)** are living. Edit freely.

## What's Changing in This Plan

Everything below is a documentation / planning-artifact edit. Zero code changes. Zero Supabase schema changes. The runtime decision and Phase 1 MVP scope are otherwise unchanged.

## Files Being Changed

```
pharm1/
├── CLAUDE.md                                                            ← NEW (repo-root handoff for fresh AI sessions)
├── PLAN.md                                                              ← MODIFIED (architecture diagram, Phase 1 scope, integrations, decisions log w/ supersedes)
├── docs/
│   ├── how-this-works.md                                                ← MODIFIED (delete Mac mini section, simplify diagram, "why the change" framing, cost-claim update)
│   ├── kaleem-meeting-2026-04-20.md                                     ← MODIFIED (heavy edit — 8+ mini references, full section deletion, stakeholder reframing)
│   └── kaleem-todos.md                                                  ← MODIFIED (resolve settled-but-still-open questions, add static-IP-check item)
├── tmp/
│   ├── briefs/
│   │   ├── 2026-04-19-pharmacy-otc-platform.md                          ← MODIFIED (top-of-brief architecture-update callout + inline strikethrough on line 48)
│   │   └── 2026-04-30-agent-runtime-comparison.md                       ← MODIFIED (fix in place — body lines 11, 15, 29, 49, 70 + final-decision section)
│   ├── ready-plans/
│   │   ├── 2026-04-19-phase-1-mvp.md                                    ← MODIFIED (architecture diagram + 7 line-level edits + T34 backup-script body + new T43b)
│   │   └── 2026-04-30-cloud-only-refactor.md                            ← THIS FILE (v2)
│   └── research/
│       ├── 2026-04-30-agent-runtime-recommendation.md                   ← MODIFIED (overwrite with v3 cloud-only)
│       └── 2026-04-30-agent-runtime-recommendation-v2.md                ← NEW (frozen snapshot of v2 hybrid recommendation)
```

**Files NOT changing (verified clean by Pass 1 + Pass 3 grep):**
- `docs/amazon-sp-api-setup.md`
- `docs/wholesaler-connections.md`, `docs/wholesaler-questions.md`
- `docs/emails/*.md` (all 5 supplier email drafts)
- `tmp/research/2026-04-18-product-manager-research.md` (only incidental "mini Keepa-style chart" — unrelated)

**Files being deleted:** None. Every file retains useful content; only mini-specific paragraphs/sections within them get rewritten or deleted.

---

## Architecture Overview (After This Refactor)

```
┌─────────────────────────────────────────────────────────────────┐
│                  SUPABASE (cloud — source of truth)              │
│  Postgres + pgvector. Queue + business data + memory + audit.    │
└────────┬────────────────────────────────────────────────────────┘
         │ reads/writes
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Render (cloud — single deploy unit)                              │
│                                                                  │
│ Web service:                  Worker service:                    │
│ • Next.js 14 app              • minicrew worker                  │
│ • /api/chat (Claude API)      • Polls Supabase jobs              │
│ • /api/auth/callback          • Invokes Claude Agent SDK         │
│ • /api/health                 • EDI polling (SFTP from Render    │
│ • Webhook handlers (Phase 2)    egress IP, static if needed)     │
│ • Scheduled cron → enqueue                                       │
│                                                                  │
│ Render Cron Jobs (~$1/mo each):                                  │
│ • Weekly: encrypted pg_dump → B2 (custom Dockerfile required)    │
│ • Monthly: restore-test from latest backup                       │
└──────────────────────────────────────────────────────┬──────────┘
                                                       │ encrypted dump
                                                       ▼
                                       ┌─────────────────────────────┐
                                       │ Backblaze B2 (separate      │
                                       │ cloud account, Object Lock  │
                                       │ + write-only API token).    │
                                       │ Lifecycle: 12-week retention│
                                       └─────────────────────────────┘
```

**What's not in this diagram anymore:** Kaleem's Mac mini. Kaleem keeps the device for whatever else; our system doesn't depend on it.

**The single failure mode that disappears:** "Pharmacy WiFi or power blips → agents stop." Now the only way agents stop is Render going down (rare, well-monitored) or Supabase going down (rare, well-monitored). Both have status pages and clear SLAs.

**Two separate cloud accounts:** Supabase has its own auth/access. B2 is in a *different* cloud account (different email, different 2FA) so a compromised Supabase credential can't reach the backup. With B2 Object Lock + write-only API token issued to Render, even a compromised Render credential can't `rm -rf` the bucket — only append.

---

## Tasks (Implementation Order)

### Phase 1 — Bootstrap handoff state FIRST so refactor is recoverable mid-flight

**T1 — Create `CLAUDE.md` at repo root.** *(was T9 in v1; moved here so a fresh session opening the repo mid-refactor has orientation.)*

Create file at `/Users/omidzahrai/Desktop/CODEBASES/kaleem/pharm1/CLAUDE.md` with this exact content (substitute the date placeholder):

```markdown
# PharmaDash — AI Pharmacy OTC Arbitrage Platform

> **Build status: pre-implementation.** All planning artifacts complete. Phase 1 MVP plan ready (44 tasks, confidence 9/10). Awaiting decision to start build.
>
> **As of {date}:** Cloud-only architecture refactor in progress (or complete — see status below). Mac mini removed from architecture. Inference layer is Claude Agent SDK; orchestration is minicrew on Render; backup target is Backblaze B2 in a separate cloud account.

## Refactor Status

`{IN_PROGRESS|COMPLETE}` — see `tmp/ready-plans/2026-04-30-cloud-only-refactor.md` if in progress.

## What This Project Is

PharmaDash is a multi-agent AI platform automating Kaleem's (licensed Utah pharmacist, two pharmacies — St. Mark's + Redwood Road) Amazon + eBay OTC arbitrage workflow. A swarm of 9 specialist agents coordinated by a Chief of Staff reads wholesaler stock, Amazon market data, FDA shortages, and Kaleem's own sales history; recommends what to list, at what price, when; surfaces a daily action queue Kaleem reviews and approves. Kaleem keeps 100% of decisions; the system does 100% of the busywork.

The defensible edge: **stock-out arbitrage** — FBA-empty windows where FBM-only licensed pharmacies like Kaleem's can win the Amazon Buy Box at scarcity premiums.

## Who's Working on This

- **Dev (you, when reading this)** — building the system. Owns architecture, code, infra.
- **Nick** — co-builder. Dev + Nick = "the team."
- **Kaleem** — the pharmacist partner. Owns the pharmacy operation, makes every system-action approval. Not a developer; reads `docs/how-this-works.md` and `docs/kaleem-meeting-2026-04-20.md` for system context.

## Repo State

- **Git remote:** Not yet set as of 2026-04-30. Per `PLAN.md` Next-steps item 1, a new GitHub repo is pending. Do not push to any remote without explicit user approval. (The `nkpardon8-prog/connect-crm` remote that may appear is a different project entirely — not this repo's home.)
- **Branch:** `main` (local only).
- **Code:** None yet. This is a planning-only repo. All `.md` content is decision-record + design intent until Phase 1 starts.

## Read These In Order to Get Up to Speed

**Primary (read all):**
1. **`PLAN.md`** — 30,000-foot view, agent swarm, data layer, Phase 1 scope, integrations, decision log.
2. **`tmp/research/2026-04-30-agent-runtime-recommendation.md`** (v3 — current) — runtime decision (Claude Agent SDK on Render, no Mac mini).
3. **`tmp/research/2026-04-30-agent-runtime-recommendation-v2.md`** (v2 — frozen snapshot, hybrid option, superseded but preserved for decision history).
4. **`tmp/ready-plans/2026-04-19-phase-1-mvp.md`** — the concrete 44-task build plan for Phase 1.
5. **`tmp/briefs/2026-04-19-pharmacy-otc-platform.md`** — original decision brief from April 18 discussion (read the top "architecture update" callout first; rest is historical).
6. **`tmp/briefs/2026-04-30-agent-runtime-comparison.md`** — runtime-decision brief.
7. **`docs/how-this-works.md`** — what we're explaining to Kaleem.
8. **`docs/kaleem-meeting-2026-04-20.md`** — meeting prep for the (now-passed) April 20 meeting; archived but referenced.
9. **`docs/kaleem-todos.md`** — running checklist of Kaleem-side actions.

**Supporting docs (read on demand):**
- `docs/amazon-sp-api-setup.md` — SP-API onboarding step-by-step for Kaleem.
- `docs/wholesaler-connections.md` — supplier integration plan.
- `docs/wholesaler-questions.md` — questions to ask each wholesaler rep.
- `docs/emails/*.md` — 5 supplier email drafts (ABC, McKesson, Cardinal, Parmed, IPC).

**Active research:**
- `tmp/research/2026-04-18-product-manager-research.md` — 60+ source synthesis on opportunity-scoring, stock-out detection, demand forecasting, H&PC constraints, UI patterns. Still authoritative.

## Artifact Type Conventions

- **`tmp/briefs/`** — decision records. Preserve body; add architecture-update callouts at top if decisions change. Don't rewrite history.
- **`tmp/research/`** — versioned research reports. Major changes preserve prior version as `<name>-v<N>.md` snapshot.
- **`tmp/ready-plans/`** — living plans, edit freely until shipped.
- **`tmp/done-plans/`** — shipped plans, move here after `/implement` completes.
- **`tmp/cancelled-plans/`** — abandoned plans, move here if work is dropped.
- (`tmp/done-plans/` and `tmp/cancelled-plans/` directories don't exist yet — create when first needed.)

## Settled Architecture (Don't Re-litigate)

| Concern | Decision |
|---|---|
| Inference layer | Claude Agent SDK (TypeScript) — `@anthropic-ai/claude-agent-sdk` |
| Agent orchestration | minicrew (Dev's Supabase job-queue pattern — [github.com/omdiidi/minicrew](https://github.com/omdiidi/minicrew)) |
| Database | Supabase (Postgres + pgvector + HNSW + pg_trgm) |
| Web/UI | Next.js 14 App Router on Render |
| Agent worker | Render worker service (TypeScript, calls Agent SDK `query()`) |
| Off-cloud backup | Backblaze B2 with Object Lock + write-only API token, in cloud account separate from Supabase |
| EDI polling | Render with static egress IP if any wholesaler requires it (Pro tier $25/mo team minimum, OR small dedicated proxy box with reserved IPv4 — verify per wholesaler) |
| Authentication | Supabase Auth magic-link + email allowlist |
| Memory | `memory` table, kinds = episodic/procedural/semantic/preferences |
| Embeddings | Voyage AI deferred to Phase 1.5; trigram text search in Phase 1 |
| Observability | Sentry (exceptions) + `claude_usage` table + OTLP from Agent SDK → LangSmith free tier or Langfuse |
| Mac mini | **Removed.** Not load-bearing for any system function. (Kaleem may use it for personal purposes; system has zero on-prem dependency.) |

## Two-POS Isolation Invariant (Non-Negotiable)

PharmaDash is **OTC-only**. The Pioneer / Heartland / prescription side of Kaleem's pharmacy is on a **completely separate POS architecture** that this system never touches. Reasons:
- **HIPAA proximity:** prescription data is PHI; OTC arbitrage data isn't. Mixing them creates BAA / breach-notification surface area we don't want.
- **Licensure:** the pharmacist license rules around handling Rx data are stricter than OTC; isolation simplifies compliance.
- **Failure isolation:** an Amazon listing bug can't propagate to Pioneer and break Rx fulfillment.

Two-POS architecture is invariant. Don't propose unifying them. Don't pull Rx data into Supabase. Don't share network paths between the systems.

## Credentials

Per global `~/.config/claude/credentials.md` pattern (see global CLAUDE.md). When keys are needed for Phase 1 implementation:
1. Read `~/.config/claude/credentials.md` to see what's available.
2. Always invoke `/load-creds` (don't inline the bash flow).
3. Use the same env-var names as the catalog when generating `.env.example`.

Never echo resolved secret values; reference by env var name only.

## What's Pending (Not Yet Done)

- **Decision to start Phase 1 build** — 44-task ready-plan exists; awaiting user's go-ahead.
- **Kaleem-side onboarding** — SP-API app submission (1-4 wk Amazon approval), ABC email send, NDA signing, blind-ship confirmations from each wholesaler.
- **minicrew Linux port** — separate stream; should target generic Linux container (Render compatible), NOT Mac-specific build. Coordinate with parallel-track work before the port lands so the worker-spawning code targets `query()` instead of `claude -p` from the start.
- **Static egress IP check** — verify with each wholesaler rep before Phase 2 whether SFTP / EDI feeds require a fixed source IP.
- **Phase 2 day-1 spike** — when Phase 2 starts, prove the Agent SDK runtime with one agent (Bookkeeper recommended) end-to-end before porting the rest.
- **GitHub remote setup** — per `PLAN.md` Next-steps item 1.

## Three Concrete "Pick Up Here" Options

1. **Start Phase 1 implementation.** Run `/implement tmp/ready-plans/2026-04-19-phase-1-mvp.md` to kick off the 44-task build.
2. **Update Kaleem-side onboarding.** Use `docs/kaleem-todos.md` as the working checklist; send the ABC email draft from `docs/emails/abc-order-data-exchange.md`; confirm SP-API app submission timeline.
3. **Validate the runtime decision.** Optional: do the Phase 2 day-1 spike early — build one Agent SDK worker template against the seeded data (no minicrew runtime needed yet) to confirm the stack composes.

## Conventions Specific to This Repo

- **Documentation discipline:** After any change, update affected `.md` files. The doc-to-code mapping is implicit in `PLAN.md`'s "Documentation map" section — keep that section authoritative.
- **No code yet:** This is a planning-only repo until Phase 1 starts.
- **Briefs are decision history:** Don't edit brief content unless the brief was written *today* and contradicts a same-day decision. Otherwise add architecture-update callouts at the top.
- **Plans are living artifacts** until shipped: `tmp/ready-plans/` is active, `tmp/done-plans/` is shipped. Move plans there after `/implement` completes.
- **Research reports are versioned:** preserve `-v<N>` snapshot before major rewrites.

## Things to Never Do

- **Never push to remote without explicit user approval.** Applies to all branches, all remotes, no exceptions. (Per global CLAUDE.md push policy.)
- **Reintroduce the Mac mini as load-bearing infra.** Settled 2026-04-30. If user changes their mind, *they say so explicitly* and we revisit; don't drift back.
- **Adopt LangChain or LangGraph without explicitly revisiting the runtime recommendation.** The propose-then-execute architecture doesn't benefit from LangGraph's `interrupt()` durability; this was researched in detail.
- **Use Claude Code CLI (`claude -p`) as the agent runtime in production.** Use the Agent SDK library form. Same engine; different ergonomics.
- **Auto-purchase, auto-send to customers, or auto-list without Kaleem's click.** Human-in-loop is invariant. Kaleem clicks every executor write; 30-min undo on every action.
- **Touch Pioneer / Heartland / prescription data.** Two-POS architecture, OTC-only. See "Two-POS Isolation Invariant" above for context.
- **Commit `.env`, credentials, or anything matching `*.key`/`*.pem`.** Use `.gitignore` discipline; never `git add -A` blindly.
```

Status header should read `IN_PROGRESS` until T9.

---

### Phase 2 — Source-of-truth artifacts

**T2 — Update runtime recommendation report (v2 → v3, with v2 preserved as snapshot).**

Step A: **Copy the current file** at `tmp/research/2026-04-30-agent-runtime-recommendation.md` to a new file `tmp/research/2026-04-30-agent-runtime-recommendation-v2.md`. Don't change content; this is the frozen snapshot.

Step B: **Edit the original file in place to v3.** Specific edits below; do them in order, then re-read end-to-end before declaring T2 done.

**B.1 — Frontmatter:** Update `status: v3 — final, cloud-only`.

**B.2 — TL;DR (around line 13):** Replace verbatim:

> *Old:* "Run minicrew + Claude Agent SDK (TypeScript) on Render, with the Mac mini reduced to EDI polling + local backup. Adopt LangSmith free tier for observability, framework-agnostic."
>
> *New:* "Run minicrew + Claude Agent SDK (TypeScript) on Render. **All system compute lives on Render.** The Mac mini is dropped from the architecture — Kaleem keeps the hardware but our system doesn't depend on it. Encrypted weekly backups land in Backblaze B2 (Object Lock GA, S3-compatible API, separate cloud account from Supabase) for off-cloud disaster recovery. Adopt LangSmith free tier (or Langfuse self-host) for observability, framework-agnostic."

**B.3 — TL;DR headline reasons (4th bullet, currently mentions Mac mini):** Replace verbatim:

> *Old:* "**Mac mini is a separable decision** and the current plan over-couples it to the runtime choice. Pharmacy power outage shouldn't stop agents."
>
> *New:* "**No on-prem dependency.** Mac mini removed entirely. Air-gapped backup uses a separate cloud bucket (Backblaze B2 with Object Lock + write-only API token). EDI polling runs from Render with a static egress IP if any wholesaler requires it (Render Pro tier, or a small dedicated proxy with a reserved IPv4 — verify per wholesaler before committing)."

**B.4 — "What's Actually Being Decided" → Decision 2 bullets:** Replace the 3-bullet list ("Mac mini at the pharmacy / Cloud / Both") with a single line: "**Render-only (recommended; final).** v2's hybrid option is preserved as a frozen snapshot at `2026-04-30-agent-runtime-recommendation-v2.md` for decision-history."

**B.5 — "What stays constant" list:** Confirm no Mac mini references. Currently nothing in the list mentions the mini — leave the list intact. (v1 of this plan had an editor's note here that read "Remove `briefings + inbox_items state machine` line — wait, that one stays" — that's been resolved, no edit needed.)

**B.6 — Comparison table around lines 261-262:** Update the "Worker location" and "Mac mini role" rows. Replace:

> *Old (paraphrasing):* "Worker location: Render (cloud) | Mac mini role: EDI polling + weekly pg_dump backup"
>
> *New:* "Worker location: **Render (cloud) — only**. Mac mini role removed (was EDI polling + backup in v2 hybrid; both moved cloud-side in v3)."

**B.7 — "Backup" row in the same table (around line 267):** Update from "weekly pg_dump on Mac mini" to "**weekly encrypted pg_dump → Backblaze B2** (separate cloud account from Supabase, Object Lock + write-only API token, 12-week lifecycle retention). Render Cron Job (~$1/mo). Custom Dockerfile required for cron (`postgresql-client` + `aws-cli`)."

**B.8 — "The Mac Mini Sub-Decision" section (heading around line 313):** **Delete entirely** (heading + body, full section). Replace with a new section titled **"Why Cloud-Only (Final)"** with the following content:

```markdown
## Why Cloud-Only (Final)

v2 of this report recommended a hybrid: cloud primary, mini for two retained roles
(EDI polling with potential IP-allowlist requirements, and off-cloud backup target).
After review, both retained roles have cleaner cloud-native answers:

- **EDI polling:** Render Pro static outbound IP ($25/mo team minimum), or a small
  dedicated proxy (e.g. fly.io with reserved IPv4 ~$2/mo) gives us a fixed source
  IP without on-prem hardware. Or, if all wholesaler EDI reaches us through EzriRx
  (the aggregator covering 30+ wholesalers via single integration), the IP-allowlist
  question doesn't apply at all. Verify with each wholesaler rep before committing.

- **Off-cloud backup:** Backblaze B2 in a cloud account separate from Supabase
  preserves the air-gap property without on-prem hardware. With Object Lock GA
  (since 2020) and a write-only API token issued to Render, even a compromised
  Render credential can't delete the backup bucket — only append. This is a
  *stronger* air-gap guarantee than a Mac mini under Kaleem's desk (which is
  trivially defeated by physical access or pharmacy network compromise).

The hybrid option's only remaining argument was "free compute Kaleem already owns,"
which trades $10–25/mo of Render worker compute for an on-prem dependency that
makes agent uptime depend on pharmacy WiFi, power, and physical mini health. For
a business-critical system, that's a bad trade.

**Final architecture:** All compute on Render. All backup in B2 (separate account).
Mac mini is removed. Kaleem keeps the hardware for personal use; the system has
zero on-prem dependency.

(v2's hybrid reasoning is preserved at `2026-04-30-agent-runtime-recommendation-v2.md`
for decision-history — read it if you ever wonder why the hybrid option was
seriously considered, or if you're tempted to reintroduce the mini.)
```

**B.9 — New "Backup Strategy" section** immediately after the "Why Cloud-Only (Final)" section:

```markdown
## Backup Strategy

**Recommended target: Backblaze B2.** Reasons:
- **Object Lock GA since 2020.** Object Lock + write-only API token = compromised
  Render credentials can't `rm -rf` the bucket. R2's Object Lock is more recent
  and limited; B2 is the more battle-tested choice for ransomware-resistant backups.
- **Pricing: $0.006/GB/mo storage, $0.01/GB egress** — cheaper than R2 ($0.015/GB
  storage, free egress) at PharmaDash's read-rarely-write-weekly profile.
- **S3-compatible API** — script uses standard `aws-cli` with `AWS_ENDPOINT_URL_S3`
  pointed at B2 (e.g. `https://s3.us-west-004.backblazeb2.com`).

**Account separation setup (concrete steps):**
1. Create a `+backup` email alias (e.g. `dev+pharm1backup@your-domain.com`).
2. Register a fresh Backblaze account using that alias.
3. Enable 2FA. Set a recovery email different from your main account.
4. Create a B2 bucket `pharm1-backups` with Object Lock enabled at creation
   (you cannot enable it later).
5. Configure bucket lifecycle: keep latest 12 weekly backups, auto-delete older.
6. Issue an API key scoped to *that bucket only* with **write permission only,
   no delete**. This is the credential Render uses for backups.
7. Store a separate "break-glass" admin key offline (1Password / paper) — used
   only for restore operations.

**Acceptable alternatives:** AWS S3 (with Object Lock and IAM scoped policy),
Cloudflare R2 (with Object Lock when GA, write-only API token). The script
doesn't change shape — only the endpoint URL and credentials.

**Restore-test cron:** Same backup script in `--test-restore` mode, runs monthly
on Render. Pulls the latest backup, decrypts, restores to a throwaway Supabase
database (Supabase free tier is fine for the throwaway), asserts row counts
sane. Logs to `backup_log` table.
```

**B.10 — "What Would Make Me Change This Recommendation" → item 1:** Replace verbatim:

> *Old:* "**If Kaleem rejects the cloud-primary deployment** for reasons (data residency, cost, control), the runtime choice stays B but mini becomes the worker — single point of failure consciously accepted, with a cloud fallback worker as the mitigation."
>
> *New:* "**If Kaleem strongly prefers on-prem control** (data residency concerns, cost philosophy, sense of ownership), the mini can return as an additional backup target or fallback worker — but the system stays cloud-primary. Single-point-of-failure on the mini is no longer accepted as a default; it would be a conscious tradeoff requiring explicit approval and a documented mitigation plan."

**B.11 — "Open Risks & Honest Caveats" → caveat 10 (the minicrew-Linux-port note):** Replace verbatim:

> *Old:* "**minicrew's Linux port (currently in progress on a parallel stream) is being designed against the Claude Code CLI invocation pattern.** Switching to Agent SDK invocation requires updating the minicrew worker template..."
>
> *New:* "**minicrew now needs to run on Linux on Render**, not Linux Mint on a Mac mini. The Linux port (currently in progress on a parallel stream) targets the same underlying Linux runtime, so this is a deploy-target detail, not a runtime change. Confirm the parallel stream is targeting cloud-Linux or a generic Linux container, not a specific Mac mini build. Also confirm the worker-spawning code targets `query()` (Agent SDK) not `claude -p` (CLI) from the start — coordinate with the parallel stream before the port lands."

**B.12 — Sources section:** Add citations:
- [Backblaze B2 Object Lock docs](https://www.backblaze.com/b2/docs/object_lock.html)
- [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing)
- [Render Cron Jobs pricing & docs](https://render.com/docs/cronjobs)
- [Render static outbound IPs (Pro tier)](https://render.com/docs/static-outbound-ip-addresses)

**B.13 — End-to-end re-read.** After applying B.1–B.12, **read the entire v3 file fresh** and verify: (a) no sentence advocates for or assumes mini-as-agent-runtime; (b) no sentence claims R2 — all backup-target references say B2 (or generic "cloud bucket" with B2 as recommendation); (c) static IP language is honest about Render Pro requirement; (d) no leftover editor's notes; (e) the v2 → v3 changelog implicit in the differences is captured by B.8's "Why Cloud-Only (Final)" section.

---

**T3 — Update `tmp/briefs/2026-04-30-agent-runtime-comparison.md` (fix in place, not append).**

This brief was written today; addendum would contradict the body. Fix the body:

**T3.1 — Line 11** (`## Why` section, last paragraph): Currently mentions "Mac mini introduces a single point of failure for a business-critical system." Update to: "Mac mini introduces a single point of failure for a business-critical system. **Resolution (post-research):** dropped from architecture entirely; backup goes to a separate cloud account."

**T3.2 — Line 15** ("If this runs as a business" concern paraphrase): Add an inline parenthetical: "(*Resolved:* cloud-only deployment removes this concern entirely.)"

**T3.3 — Line 29** ("Mac mini (Kaleem's pharmacy, Linux Mint) = agent worker, SFTP polling, weekly pg_dump backup"): Replace verbatim with: "Render worker service = agent worker, SFTP polling (with static egress IP if needed), Render Cron for weekly pg_dump → Backblaze B2 (separate cloud account)."

**T3.4 — Line 49** ("Mac-mini-vs-cloud is a separate dimension"): Replace verbatim with: "**Decision finalized:** all compute on Render. Mac mini removed from architecture entirely (was a hybrid option in mid-research; resolved to cloud-only)."

**T3.5 — Line 70** ("Working assumption (prediction, not decision)"): Replace verbatim with: "**Final decision:** Option B (minicrew + Claude Agent SDK) running on Render. Mac mini removed from architecture. Backup goes to Backblaze B2 in a separate cloud account. See `tmp/research/2026-04-30-agent-runtime-recommendation.md` v3."

**T3.6 — Add new section at bottom titled "Final Decision Trail":**

```markdown
## Final Decision Trail (chronological)

- 2026-04-30 morning — Brief written. Framed candidates A/B/C/D + Mac-mini-vs-cloud as separate axis.
- 2026-04-30 mid-day — Three parallel research agents return. Brief's "predicted Option B" validated; refined to specifically Anthropic Agent SDK (vs bare SDK, both of which were lumped as "Option B" in the brief).
- 2026-04-30 afternoon — Recommendation report v1 written, then v2 after self-review. v2 recommended Option B with hybrid cloud-primary + Mac-mini-for-EDI-and-backup deployment.
- 2026-04-30 evening — User pushback: if mini isn't load-bearing for agents, why keep it for anything? Both retained roles have cleaner cloud-native solutions. Decision finalized to **cloud-only**.
- 2026-04-30 evening — `tmp/ready-plans/2026-04-30-cloud-only-refactor.md` plan written, reviewed 3x, executed.

For full reasoning see `tmp/research/2026-04-30-agent-runtime-recommendation.md` v3 (current) and `tmp/research/2026-04-30-agent-runtime-recommendation-v2.md` (frozen v2 with hybrid reasoning).
```

---

**T4 — Add architecture-update callout to `tmp/briefs/2026-04-19-pharmacy-otc-platform.md`.**

This brief is from April 18 — historical record. Preserve body, add callout + one inline strikethrough.

**T4.1 — Top of file (after frontmatter, before "## Why"):** Insert:

```markdown
> **2026-04-30 architecture update:** This brief assumes the Mac mini as primary agent worker (see "Compute" line in the Technical Stack section, "Memory: weekly pg_dump to Mac mini" decision, and the "Mac mini running Linux Mint" line in Existing Tools). After follow-up research and user discussion, the architecture moved to **cloud-only on Render** with backup to Backblaze B2. The brief is preserved as a historical decision record from the April 18 discussion; for current architecture see `tmp/research/2026-04-30-agent-runtime-recommendation.md` v3 and `tmp/ready-plans/2026-04-30-cloud-only-refactor.md`.
```

**T4.2 — Line 48** (Existing tools list, the Mac mini bullet): Strike just the role-assignment parenthetical. Find the line:

> `- Mac mini running Linux Mint (Intel, 8GB — workhorse for agent runtime)`

Edit to:

> `- Mac mini running Linux Mint (Intel, 8GB — ~~workhorse for agent runtime~~ no longer load-bearing as of 2026-04-30; see top callout)`

Don't edit anything else in this brief.

---

### Phase 3 — Master planning docs

**T5 — Update `PLAN.md`.**

Specific line-level edits below.

**T5.1 — Line 48-69 architecture diagram ("Architecture at 30,000 feet"):** Replace the current dual-box diagram (Render + Mac mini) with the cloud-only diagram from this plan's "Architecture Overview" section above.

**T5.2 — Lines 71-79 "Cloud responsibilities" / "Mac mini responsibilities" bullets:** Replace both blocks with a single "What runs where" block:

```markdown
**What runs where:**
- **Render web service:** Next.js UI + Business Chatbot + auth + SP-API webhook handler + scheduled cron → enqueue jobs.
- **Render worker service:** minicrew worker, polling Supabase queue, invoking Claude Agent SDK for each job. Also handles SFTP/EDI polling (with Render Pro static egress IP if any wholesaler requires it).
- **Render Cron Jobs:** Weekly encrypted pg_dump → Backblaze B2; monthly restore-test.
- **Supabase:** Postgres + pgvector + auth. Source of truth for queue, business data, memory, audit log.
- **Backblaze B2 (separate cloud account):** off-cloud encrypted backup target with Object Lock + write-only API token. 12-week lifecycle retention.
```

**T5.3 — Line 81** (currently `"...When ready, we install on Kaleem's mini, point at our Supabase, and agents run."`): Replace verbatim:

> `**Agent runtime:** [minicrew](https://github.com/omdiidi/minicrew) — the Dev's own job-queue-on-Supabase pattern, currently being ported to Linux separately. When ready, we deploy as a Render worker service alongside the web service, point at our Supabase, and agents run.`

**T5.4 — Phase 1 MVP "Ships" item 7 (around line 150):** Replace verbatim from "Weekly encrypted pg_dump backup with sha256 log + monthly restore-test cron" to:

> `Weekly encrypted pg_dump backup to Backblaze B2 (separate cloud account, Object Lock + write-only API token) with sha256 log + monthly restore-test cron. Both as Render Cron Jobs.`

**T5.5 — Phase 2 section, line 177** (`"Wire minicrew worker on Kaleem's Linux Mac mini"`): Replace verbatim:

> `Deploy minicrew worker as a Render worker service alongside the web service`

**T5.6 — Integrations table:** Add new row before "Sentry":

```markdown
| **Backblaze B2** | Phase 1 | ~$1–3/mo at our volume | Off-cloud encrypted backup target (Object Lock + write-only API token, separate cloud account from Supabase) |
```

**T5.7 — Critical Constraints section:** No mini constraints listed. No edit needed.

**T5.8 — Key decisions log (around lines 282-298):** Add new row at the end:

```markdown
| 2026-04-30 | Cloud-only deployment; Mac mini removed from architecture | Removes pharmacy-WiFi single point of failure; backup goes to Backblaze B2 (separate cloud account, Object Lock + write-only token) for stronger air-gap than on-prem mini. Render handles static egress IP if wholesaler reps confirm fixed-IP requirement. Supersedes 2026-04-18 "Memory on Supabase with weekly local backup" and "No local AI models on Mac mini" rows below — both rendered moot by removal of the mini. |
```

**T5.9 — Lines 288-289 (the now-stale decision rows):** Append `(superseded 2026-04-30 — see row above)` to each. Don't delete; preserve history with the supersede marker.

**T5.10 — Line 332 ("Next steps" item, when minicrew Linux port lands):** Replace verbatim:

> `**When minicrew Linux port lands** — deploy as a Render worker service, point at our Supabase, first agent job can fire.`

---

**T6 — Update `docs/how-this-works.md`.**

This is Kaleem-facing. Edit pass:

**T6.1 — Diagram "The setup at a glance":** Replace the current diagram (which shows agents potentially on Mac mini side) with a single cloud-only diagram. Keep the "you talk to Chief of Staff via Chat + Inbox" framing. Diagram body:

```
                    KALEEM (you)
                         │
             opens the app on any device
                         │
                         ▼
          ┌──────────────────────────────┐
          │  CHIEF OF STAFF               │
          │  (the AI you talk to)         │
          │  via Chat + Inbox             │
          └───────────────┬──────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │                                    │
        │  9 AI SPECIALISTS                  │
        │  — running in our cloud setup —    │
        │  (Render + Supabase)               │
        │                                    │
        │  [list of 9 specialists]           │
        │                                    │
        └────────────────┬───────────────────┘
                         │ all share one memory
                         ▼
          ┌──────────────────────────────┐
          │   SHARED CLOUD DATABASE       │
          │   + WEEKLY ENCRYPTED BACKUPS  │
          │   to a separate cloud bucket  │
          └──────────────────────────────┘
```

**T6.2 — "What we need from your Mac mini" section (currently around lines 206-219, ~14 lines):** **Delete entirely.** Replace with:

```markdown
## What we need from you on infrastructure

**Nothing.** Everything runs in our cloud setup (Render for the app + agents; Supabase for the database; Backblaze for off-cloud encrypted backups). You don't need to host anything, manage any hardware, keep any computer running, or grant SSH access. We handle uptime.

**Why this changed (vs earlier conversations):** Earlier plans had your Mac mini doing some of the agent work. We moved everything to the cloud so the system's uptime doesn't depend on your pharmacy's WiFi or power. **Your mini is still useful for whatever you use it for** — it just isn't load-bearing for our system anymore.

**Pioneer / prescription isolation is preserved.** The cloud architecture never touches Pioneer's network, never gets prescription data, runs in a completely separate Supabase project. Two-POS architecture is unchanged.

**Where your data lives:** Your Amazon order history, listings, and OTC sales data live in Supabase (US-region, encrypted at rest). Weekly encrypted backups are stored in a separate cloud account from Supabase, so even if either provider has an issue, the other has your data. You own all of it; full export anytime.
```

**T6.3 — Line 219** (the SSH-for-maintenance line, "we can SSH in for maintenance when needed (optional, not required for operation)"): This is part of the section being deleted in T6.2. **Verify** during execution that the deletion captures it. If not, replace with: "We deploy via git push to Render — no SSH access to anywhere of yours is needed."

**T6.4 — "Timeline honest estimate" table:** Remove any Mac-mini-setup line. Add a line if needed:

```
Week 0–1                       Cloud infra provisioned (Render + Supabase + B2). Zero setup on your end.
```

**T6.5 — "Questions answered in one pass" → "Who owns the data?" (around line 258):** Replace:

> *Old:* "...You get weekly encrypted backups to your own Mac mini. Full export anytime."
>
> *New:* "...You get weekly encrypted backups to a Backblaze B2 bucket in a cloud account separate from Supabase, so a compromise of one provider doesn't reach the backup. Full export anytime, all yours."

**T6.6 — "Questions answered in one pass" → "What if I want to stop using it?" (around line 261):** Replace:

> *Old:* "Revoke SP-API app, remove our user access from Seller Central, turn off the Mac mini. Everything stops."
>
> *New:* "Revoke SP-API app, remove our user access from Seller Central, we shut down our Render services. Everything stops. Data export sent to you, all backups in your B2 account already."

**T6.7 — Cost claim line 255** ("~$360-680/month once wired"): Update to reflect Render worker + B2 + Render Cron costs:

> *Old:* "~$360–680/month once wired (AI API + database + data feeds + hosting). A single good arbitrage sale (like the Tinactin moment — $51 sold from $7 cost) covers a full week of running cost."
>
> *New:* "~$370–710/month once wired (AI API + database + Render web + Render worker + B2 backup + Render Cron + data feeds). A single good arbitrage sale (like the Tinactin moment — $51 sold from $7 cost) covers a full week of running cost."

**T6.8 — One-page summary box (currently mentions "running on your Mac mini + cloud database"):** Update "THE PLATFORM" section verbatim:

> *Old:* "running on your Mac mini + cloud database, watching 5 data feeds"
>
> *New:* "running entirely in our cloud setup (Render + Supabase, with off-cloud encrypted backups in Backblaze), watching 5 data feeds"

---

**T7 — Update `tmp/ready-plans/2026-04-19-phase-1-mvp.md`.**

This is the active 44-task implementation plan. Surgical edits — don't disturb task numbering or v4-after-3-reviewer-passes integrity.

**T7.1 — Architecture Overview diagram (around line 273-298):** Replace the right-side Mac mini box with the cloud-only architecture per "Architecture Overview" section above.

**T7.2 — "What runs where in Phase 1" bullets (around lines 300-303):** Remove the Mac mini bullet (line 303 specifically: `"Mac mini: Nothing yet in Phase 1 (minicrew Linux port lands separately). config.yaml + skills are authored for when it arrives."`). Replace the bullet block with:

```markdown
- **Render web service**: Next.js app (UI + chatbot API). Deploys from main branch.
- **Render worker service**: minicrew worker stub provisioned (no jobs run in Phase 1; activated in Phase 2 when minicrew runtime lands).
- **Supabase**: Everything persistent. Provides Realtime channel for Inbox updates (Phase 2).
- **Backblaze B2 (separate cloud account)**: Off-cloud encrypted backup target. Render Cron writes weekly.
```

**T7.3 — Line 139** (Phase 1 "Ships" bullet 7, "Weekly pg_dump backup script for Mac mini cron"): Replace verbatim:

> `Weekly encrypted pg_dump → Backblaze B2 backup script (Render Cron Job, custom Dockerfile with postgresql-client + aws-cli). Monthly restore-test (separate Render Cron Job).`

**T7.4 — Line 240** (file tree comment, `"weekly pg_dump → Mac mini local disk"`): Replace verbatim:

> `← NEW (weekly pg_dump → Backblaze B2 via Render Cron, set -euo pipefail + size assert + custom Dockerfile)`

**T7.5 — Line 1243** (T3 env-config description for `BACKUP_PASSPHRASE`): Replace `"gpg symmetric key for pg_dump encryption on Mac mini"` with: `"gpg symmetric key for pg_dump encryption before B2 upload"`. Also add to the env-var list in T3:
- `B2_KEY_ID` (write-only token, scoped to backup bucket)
- `B2_APPLICATION_KEY` (the secret part of that token)
- `B2_BUCKET` (e.g. `pharm1-backups`)
- `B2_ENDPOINT_URL` (e.g. `https://s3.us-west-004.backblazeb2.com`)
- (S3-compatible API; same env var names work for AWS S3 or R2 if substituted later.)

**T7.6 — T34 (backup script task, around line 1289):** Replace the task body verbatim. New version:

```markdown
34. **T34 — Backup script.** `scripts/backup-supabase.sh` — `set -euo pipefail`, runs `pg_dump` against Supabase, gzips, encrypts with `gpg --symmetric` + `BACKUP_PASSPHRASE`, uploads to Backblaze B2 via `aws s3 cp` with `--endpoint-url $B2_ENDPOINT_URL` (S3-compatible API). Size assertion: fail if encrypted output < 100KB or < 50% of last week's size from `backup_log` table (catches silent dump failures more robustly than fixed 10KB threshold). SHA256 logged to `backup_log`. Bucket retention: 12 weekly backups via B2 lifecycle rule (configured in B2 dashboard, not in script). **Runs as a Render Cron Job (~$1/mo).** [NEEDS CLARIFICATION: pg_dump is not in Render's standard runtime images — cron job needs a custom Dockerfile with `postgresql-client` + `aws-cli` packages. Confirm Render Cron supports custom images, or alternative: trigger from GitHub Actions schedule calling a Render webhook.] Separate Render Cron runs monthly with `--test-restore`: pulls latest backup from B2, decrypts, restores to a throwaway Supabase project, asserts row counts sane. **Backup bucket lives in a Backblaze account separate from Supabase** to preserve air-gap property (Object Lock + write-only API token).
```

**T7.7 — T43 (Render deploy, around line 1300):** Add to env-var list: `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, `B2_ENDPOINT_URL`. Add note: "Provision a Backblaze B2 bucket in a Backblaze account separate from Supabase. Create bucket with Object Lock enabled at creation (cannot enable later). Issue a B2 API key scoped to that bucket only with write-only permission (no delete). Store a separate break-glass admin key offline for restore operations."

**T7.8 — NEW T43b (insert between T43 and T44):** "**Static egress IP check.** Verify with each wholesaler rep (ABC, McKesson, Cardinal, Parmed, IPC) whether SFTP / EDI feeds require a fixed source IP. Three outcomes possible: (a) all wholesalers reachable via EzriRx aggregator only — no static IP needed, no action; (b) one or more wholesalers require fixed IP and Render Pro static-IP feature suffices ($25/mo team minimum, but IP changes on regional redeploy — pin region in Render config); (c) wholesaler IT requires IPs in writing 2 weeks ahead and demands stability across deploys — provision a small dedicated proxy box (fly.io with reserved IPv4 ~$2/mo, or any VPS) and route EDI traffic through it. Add the chosen approach to `docs/integrations.md` under the wholesaler section."

**T7.9 — `[NEEDS CLARIFICATION]` markers section, item 8** (Supabase backups vs pg_dump, around line 1335): Replace verbatim:

> *Old:* "...Our weekly pg_dump to Kaleem's Mac mini is belt-and-suspenders for peace-of-mind AND air-gapped recovery if Supabase account is ever compromised. Both retained."
>
> *New:* "Our weekly encrypted pg_dump to Backblaze B2 (separate cloud account, Object Lock + write-only API token) is belt-and-suspenders for peace-of-mind AND air-gapped recovery if Supabase account is ever compromised. Stronger air-gap than on-prem (compromised Render credentials still can't delete from B2). Both retained."

**T7.10 — Add a new `[NEEDS CLARIFICATION]` marker** (item 9): "**Render Cron Job runtime image.** `pg_dump` is not in Render's standard runtime images. Confirm: (a) Render Cron supports custom Dockerfiles, OR (b) we package `pg_dump` and `aws-cli` into our app image and have the cron command shell-out, OR (c) move the backup cron to GitHub Actions (free, calls a Render webhook to trigger; loses some operational coupling but simpler). Resolve before T34 ships."

---

### Phase 4 — Kaleem-facing operational docs

**T8 — Update `docs/kaleem-meeting-2026-04-20.md`** *(largest editing task in this refactor — Pass 1, 2, 3 all flagged this was severely under-spec'd in v1).*

This was meeting prep for the April 20 meeting (now historical — April 30 today). Decision: treat as historical record for the meeting + still-relevant context, NOT living guidance. Add a top-of-file callout, then surgically update content sections.

**T8.1 — Top-of-file callout (insert before first heading):**

```markdown
> **2026-04-30 update:** This was meeting prep for the 2026-04-20 meeting (now historical). Architecture has since shifted to **cloud-only** (Mac mini removed). Sections referring to Mac mini setup are kept as historical record but flagged inline. For current architecture see `tmp/research/2026-04-30-agent-runtime-recommendation.md` v3 and `CLAUDE.md`.
```

**T8.2 — Architecture diagram (lines 122-134):** Replace the dual-box diagram (which has "KALEEM'S MAC MINI" as a labeled box) with the cloud-only diagram from this plan's "Architecture Overview" section. Above the new diagram, add: "*Updated 2026-04-30. Original diagram showed Mac mini as primary worker; that role moved to Render.*"

**T8.3 — Major section "The Mac mini — what runs on it, why his is perfect" (lines 165-223, ~58 lines):** **Delete entirely.** Replace with a single short section:

```markdown
## ~~The Mac mini~~ → Cloud-only (updated 2026-04-30)

Earlier meeting prep proposed using Kaleem's existing Mac mini as the primary agent worker. After follow-up research and user discussion, the architecture moved to **fully cloud-deployed** on Render. Reasons: (a) keeps system uptime independent of pharmacy WiFi/power, (b) backup target moved to Backblaze B2 in a separate cloud account for stronger air-gap than on-prem, (c) no SSH-into-pharmacy maintenance burden.

**For the meeting (which has now passed):** there was no Mac mini setup ask of Kaleem. If/when Kaleem asks "what about my mini?" the answer: he keeps it for personal use; our system has zero on-prem dependency.

**Pioneer/Rx isolation is preserved.** The cloud architecture never touches Pioneer's network, never gets prescription data, runs in a completely separate Supabase project. Two-POS architecture is unchanged.
```

**T8.4 — "Infrastructure questions for the Mac mini" subsection (lines 346-350):** **Delete entirely.** These four bullets are dead questions. Replace the section heading with a comment line: `<!-- 2026-04-30: removed; Mac mini no longer in architecture. -->`

**T8.5 — Week 4-6 timeline entry (line 400, "Install worker on Kaleem's mini"):** Replace verbatim with: "Deploy minicrew worker as Render worker service; first agent job fires once minicrew Linux port lands and is wired against Supabase queue."

**T8.6 — Cost line (line 440, "his mini" reference):** Replace `"$0 (his mini..."` with `"$0 one-time hardware (Render web + worker on existing service tier; Backblaze B2 + Render Cron add ~$3-7/mo recurring — see PLAN.md integrations)."` Update the steady-state monthly table on lines 429-438 to add a `Backblaze B2` row at ~$1-3/mo and a `Render Cron Jobs` row at ~$2/mo.

**T8.7 — Verification grep** within just this file after edits: `grep -n "Mac mini\|mac mini\|Mac Mini\|mini\b\|systemd\|tmux\|pharmacy WiFi\|pharmacy power\|at the pharmacy\|Linux Mint\|Intel 8GB" /Users/omidzahrai/Desktop/CODEBASES/kaleem/pharm1/docs/kaleem-meeting-2026-04-20.md`. Expected post-edit matches: the historical-context paragraph in T8.3 (deliberate); the strikethrough heading. Anything else = a missed reference.

---

**T9 — Update `docs/kaleem-todos.md`.**

**T9.1 — Lines 163-164** (settled-but-still-open-looking questions): These read as open-question todos but are actually settled decisions. Resolve in place. Find the lines (the "Hosting: Render web service for the dashboard + Mac mini for compute jobs? Or all-in on cloud?" and "Database: ... Local SQL on his Mac mini for any sensitive data?" bullets in the "Open questions for us" section). Replace with:

> ~~`- Hosting: Render web service for the dashboard + Mac mini for compute jobs? Or all-in on cloud?`~~ **Settled 2026-04-30: all-in on cloud (Render web + worker, Supabase database, Backblaze B2 backup).**
>
> ~~`- Database: ... Local SQL on his Mac mini for any sensitive data?`~~ **Settled 2026-04-30: Supabase only. No local SQL on the mini. Off-cloud backup to B2 (separate cloud account) handles air-gap.**

**T9.2 — Add new item to the "Things for Kaleem to do" section:**

```markdown
- [ ] **Confirm with each wholesaler rep** (ABC, McKesson, Cardinal, Parmed, IPC) whether SFTP / EDI feeds require a fixed source IP. Drives whether we need Render Pro static IP, a small proxy box, or just EzriRx aggregator. (Drafts: `docs/emails/abc-order-data-exchange.md`, `docs/emails/cardinal-data-exchange.md`, `docs/emails/ipc-data-exchange.md`, `docs/emails/mckesson-data-exchange.md`, `docs/emails/parmed-data-exchange.md`.)
```

**T9.3 — Search rest of file for "mini" / "Mac" / "pharmacy WiFi" / "systemd" / "tmux"** and remove or resolve any other mini references found. (Likely none beyond lines 163-164 per Pass 1 grep, but verify.)

---

### Phase 5 — Final handoff polish

**T10 — Update CLAUDE.md status from `IN_PROGRESS` to `COMPLETE`.**

Open the CLAUDE.md created in T1. Replace the status header:

> *Old:* `\`{IN_PROGRESS|COMPLETE}\` — see \`tmp/ready-plans/2026-04-30-cloud-only-refactor.md\` if in progress.`
>
> *New:* `\`COMPLETE\` (2026-04-30) — refactor done. All planning artifacts reflect cloud-only architecture. See \`tmp/ready-plans/2026-04-30-cloud-only-refactor.md\` for the change log.`

Also replace `{date}` placeholder in the "As of" header with `2026-04-30`.

---

**T11 — Verification grep + count regression check.**

Run this command and verify counts:

```bash
grep -rni \
  "Mac mini\|Mac Mini\|mac-mini\|Linux Mint\|on-prem\|on prem\|the mini\b\|his mini\|kaleem's mini\|tmux\|systemd\|pharmacy WiFi\|pharmacy power\|pharmacy internet\|at the pharmacy\|Intel 8GB" \
  --include="*.md" \
  --include="*.sql" \
  --include="*.yaml" \
  /Users/omidzahrai/Desktop/CODEBASES/kaleem/pharm1/
```

**Expected post-refactor reference counts (the regression bar):**

| File | Pre-refactor count | Post-refactor expected | Notes |
|---|---|---|---|
| `PLAN.md` | 6 | 0 | Operational doc, all references should be gone |
| `docs/how-this-works.md` | 5+ | 0 | Operational doc, all references should be gone |
| `docs/kaleem-meeting-2026-04-20.md` | 6+ | ~3 | Historical record callouts; the strikethrough heading; the one explanatory paragraph in T8.3 |
| `docs/kaleem-todos.md` | 2 | ~2 | Strikethrough markers on the resolved lines (in T9.1) |
| `tmp/ready-plans/2026-04-19-phase-1-mvp.md` | 7 | 0 | Active plan, all references should be gone |
| `tmp/briefs/2026-04-19-pharmacy-otc-platform.md` | 8 | ~3 | Historical brief: top callout + line 48 strikethrough + (preserved) "existing tools" Mac mini bullet referenced in callout |
| `tmp/briefs/2026-04-30-agent-runtime-comparison.md` | 5 | ~3 | Edited body: "Resolution" parentheticals on 3 lines; Final Decision Trail section |
| `tmp/research/2026-04-30-agent-runtime-recommendation.md` (v3) | 11 | ~6 | Explanatory references in "Why Cloud-Only (Final)" section + cross-references to v2 snapshot |
| `tmp/research/2026-04-30-agent-runtime-recommendation-v2.md` (snapshot) | (frozen) | (unchanged) | v2 frozen, references to mini are correct for v2 |
| `CLAUDE.md` | 0 (new) | 1 | The "Mac mini removed" decision row |
| `tmp/ready-plans/2026-04-30-cloud-only-refactor.md` (this file) | (self) | many | Plan describes the refactor; references are deliberate |

**Total expected post-refactor references:** ~18 explanatory/historical mentions across 5 files (briefs, research, CLAUDE.md, refactor plan). Zero in active operational docs (PLAN.md, how-this-works.md, kaleem-todos open items, Phase 1 MVP plan).

If the grep shows any count higher than the table expects, identify which file(s) and revisit the corresponding T2-T10 task to find the missed reference.

**Also verify by re-reading** (not just grep): T2.B.13 already covers this for the v3 recommendation file. After T11 grep passes, do a second-eye read of `PLAN.md` and `docs/how-this-works.md` (the two docs Kaleem and future contributors are most likely to read first) to confirm no semantic Mac-mini-as-load-bearing claims survive — grep catches keywords, not implications.

---

## Deprecated Content to Remove

| Content | Where | Action |
|---|---|---|
| "Mac mini responsibilities" bullets | `PLAN.md` lines 76-79 | Removed in T5.2 |
| "What we need from your Mac mini" full section | `docs/how-this-works.md` lines 206-219 | **Deleted** in T6.2 |
| "The Mac mini — what runs on it, why his is perfect" full section | `docs/kaleem-meeting-2026-04-20.md` lines 165-223 | **Deleted** in T8.3 (replaced with short historical-record paragraph) |
| "Infrastructure questions for the Mac mini" subsection | `docs/kaleem-meeting-2026-04-20.md` lines 346-350 | **Deleted** in T8.4 |
| "What we install (~30 min setup)" block | within deleted section in T8.3 | Deleted as part of T8.3 |
| "Why his existing mini is ideal" table | within deleted section in T8.3 | Deleted as part of T8.3 |
| "Resource impact" block | within deleted section in T8.3 | Deleted as part of T8.3 |
| Mac-mini-installation language in T34 | `tmp/ready-plans/2026-04-19-phase-1-mvp.md` line 1289 | Rewritten in T7.6 |
| Mac mini cron + systemd setup steps | wherever they appear | Removed during T6, T7, T8 edits |
| "Mac mini: Nothing yet in Phase 1" bullet | `tmp/ready-plans/2026-04-19-phase-1-mvp.md` line 303 | Removed in T7.2 |

No file deletions. No backup-file leftovers. Every change is a clean edit.

---

## [NEEDS CLARIFICATION] Markers

1. **Backup target — Backblaze B2 vs Cloudflare R2 vs AWS S3?** Plan recommends **B2** (Object Lock GA, cheapest at our scale, S3-compatible API). User can override in T7's T43 env-var list if they prefer R2 or S3. **Default: B2 unless user objects.**

2. **Backup bucket account separation — same Backblaze account as eventual-future-anything, or distinct backup-only account?** Plan recommends **distinct cloud account** for true air-gap (separate email, separate 2FA, no org invitation between accounts). **Default: separate account; user can override.**

3. **Static egress IP — provision now or wait for wholesaler-rep confirmation?** Plan says wait (T7.8/T43b), since EzriRx aggregator might cover all wholesaler EDI without direct connections. **Default: wait. Add to Kaleem's todo list to confirm with each rep (T9.2).**

4. **Render Cron Job runtime image for `pg_dump` + `aws-cli`.** [NEEDS CLARIFICATION as raised in T7.10.] Three options: custom Dockerfile if Render Cron supports it; bundle into app image and shell-out; move backup cron to GitHub Actions calling a Render webhook. Resolve before T34 of the Phase 1 plan ships.

None of these block plan execution today; all have safe defaults or are deferrable to Phase 1 implementation.

---

## Independence + Sequencing

Tasks T2-T11 reference specific terminology that should match across files. Sequencing rule:

- **T1 (CLAUDE.md) FIRST** — handoff exists during the refactor.
- **T2 (recommendation v3) BEFORE T3-T9** — establishes the canonical phrasing for cloud-only architecture, B2 backup, static IP framing. Other tasks copy this phrasing.
- **T3-T9 in any order, can run in parallel** — different files, no cross-task dependencies once T2 phrasing is settled.
- **T10 (CLAUDE.md status update) and T11 (verification grep) LAST** — confirm all edits before declaring done.

If T2 and T7 run in parallel, ensure both use the exact phrase "Backblaze B2 (separate cloud account, Object Lock + write-only API token)" — copy verbatim from T2's B.7 and B.9.

---

## Implementation Confidence Score

**9/10 for one-pass execution success** (up from v1's 6/10 honest revised post-review estimate).

Rationale: 11 tasks, all surgical edits to existing files except two new files (CLAUDE.md + recommendation v2 snapshot). Every edit has either verbatim before/after text or specific line ranges. Three independent reviewers' findings all incorporated. Verification grep at T11 with concrete count regression bar.

Point docked: **the v3 recommendation file is long (~5500 words) and the v2 → v3 changes touch a dozen sections.** A single missed reference could create a v3-internal contradiction. Mitigated by T2.B.13's mandatory end-to-end re-read after edits, before declaring T2 done. Also mitigated by the verification grep.

---

## Rollback

This is a doc-only refactor in a git-tracked repo. Rollback: `git revert <commit>` to restore prior state. No database changes, no production state, no deploy artifacts. Cheap to undo.

---

## Phase 1.5 / Backlog (Out of Scope of This Plan)

Not addressed here, will need their own plans when relevant:
- Voyage AI embeddings integration (Phase 1.5)
- RLS policies enable (Phase 2 when staff accounts exist)
- Custom domain + SSL on Render (Phase 2)
- LangSmith Plus or Langfuse self-host migration (when free tier maxes out)
- Render Pro tier upgrade for static IP (only if wholesaler reps confirm fixed-IP requirement)
- GitHub remote setup (per `PLAN.md` Next-steps item 1)
- `tmp/done-plans/` and `tmp/cancelled-plans/` directories created when first needed

---

## Sources / Citations Used in This Plan

- All findings from three independent plan-reviewer passes (saved in agent transcripts; summarized in this plan's v1 → v2 changelog)
- [Backblaze B2 Object Lock docs](https://www.backblaze.com/b2/docs/object_lock.html)
- [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing)
- [Render Cron Jobs docs](https://render.com/docs/cronjobs)
- [Render static outbound IPs (Pro tier)](https://render.com/docs/static-outbound-ip-addresses)
- Prior research: `tmp/research/2026-04-30-agent-runtime-recommendation.md` v2 (about to be snapshotted) and v3 (about to be written)
