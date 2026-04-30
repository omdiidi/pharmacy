---
name: Agent Runtime Architecture Comparison
description: Discussion brief framing the four-phase research project to compare agent runtime/orchestration options before committing to Phase 1 MVP build
type: project
---

# Brief: Agent Runtime Architecture Decision

## Why

Phase 1 MVP plans to use **minicrew (Supabase job queue) + Claude Code CLI sessions on Kaleem's Mac mini** as the agent runtime for 9 specialist agents. Before committing, we want a thorough, honest comparison of all viable agent runtime / orchestration options — this is a foundational decision and hard to reverse once built.

Specific concerns surfaced in discussion:
- Claude Code is designed for interactive dev work, not headless production agent runtime — using it as a queue-driven background process is unconventional
- Mac mini introduces a single point of failure for a business-critical system (pharmacy power, WiFi, hardware). **Resolution (post-research):** dropped from architecture entirely; backup goes to a separate cloud account.
- "If this runs as a business, I don't know" — uncertainty whether the current plan is production-grade. (*Resolved:* cloud-only deployment removes this concern entirely.)

User position: "I don't care how it's done other than the best way." No tool allegiance. Wants weighed recommendation.

## Context

**Project:** PharmaDash — multi-agent platform automating Kaleem's Amazon OTC arbitrage workflow.

**Agent topology:** 9 specialists coordinated by Chief of Staff (Research Analyst, Repricer, Fulfillment Ops, Account Health, Customer Success, Bookkeeper, Portfolio Manager, Reflector, Chief of Staff). Human-in-loop is invariant — Kaleem clicks every action; 30-min undo on every executor write.

**Architecture (planned):**
- Supabase (Postgres + pgvector) = single source of truth (queue + business data + memory + audit)
- Cloud (Render) = Next.js UI, Business Chatbot, SP-API webhooks, scheduled cron
- Render worker service = agent worker, SFTP polling (with static egress IP if needed), Render Cron for weekly pg_dump → Backblaze B2 (separate cloud account) *[Updated 2026-04-30: was Mac mini in original brief; finalized to cloud-only.]*
- minicrew = Dev's own job-queue-on-Supabase pattern; currently being ported to Linux separately
- Memory schema: kinds = episodic/procedural/semantic/preferences; HNSW pgvector index (Phase 1.5)

**Pre-implementation.** No code in the repo yet — only planning docs and a 44-task ready-plan.

**Already designed (independent of runtime choice):**
- Skill prompts as files
- audit_log table
- claude_usage tracking + daily spend cap
- briefings + inbox_items tables
- 30-min undo window

## Decisions

- **Candidates to compare in Phase 2/3:**
  - **A. minicrew + Claude Code CLI** — current plan (status quo)
  - **B. minicrew + Claude API direct / Claude Agent SDK** — middle path; same architecture, standard inference layer
  - **C. LangGraph + Claude API** — framework path; explicit state graph, vendor-neutral
  - **D. Other agent frameworks worth surveying** — CrewAI, AutoGen, Mastra, etc. (web-research what's serious in 2026)
- ~~**Mac-mini-vs-cloud is a separate dimension** — do not couple it to runtime choice; evaluate independently~~ **Decision finalized 2026-04-30:** all compute on Render. Mac mini removed from architecture entirely (was a hybrid option in mid-research; resolved to cloud-only).
- **Phase 2 research scope:** LangGraph + Claude Agent SDK + serious alternatives. NOT all of LangChain classic — that's legacy and would waste effort
- **Goal:** best architectural fit, not allegiance to any tool

## Rejected Alternatives

- **LangChain "classic"** (chains, agent executors) — legacy; even LangChain team has moved on; abstractions don't fit this pattern
- **Treating "LangChain" as one undifferentiated thing** — too broad; the comparison-worthy piece is LangGraph specifically

## Direction

Execute four phases in this conversation:

1. **Phase 1 — Codebase + intent comprehension.** Read all planning docs (PLAN.md, how-this-works, ready-plan, prior brief, prior research, meeting prep, integration notes). Summarize the system clearly enough that all later analysis is grounded.

2. **Phase 2 — Research candidates.** Web-research each candidate runtime + orchestration framework. Capture: what it is, what it's good at, where it breaks, production maturity, cost model, vendor risk, ecosystem, observability story, human-in-loop story, recovery/durability story.

3. **Phase 3 — Comparison matrix.** Score each candidate across ~8 dimensions: observability, recovery/durability, vendor lock-in, dev velocity, cost, fit-for-pattern (multi-agent + human-in-loop), reliability, ecosystem maturity. Honest cell-by-cell reasoning.

4. **Phase 4 — Final recommendation report.** Saved to `tmp/research/2026-04-30-agent-runtime-recommendation.md`. Defensible answer with reasoning.

**Final decision:** Option B (minicrew + Claude Agent SDK) running on Render. Mac mini removed from architecture. Backup goes to Backblaze B2 in a separate cloud account. See `tmp/research/2026-04-30-agent-runtime-recommendation.md` v3.

---

## Final Decision Trail (chronological)

- **2026-04-30 morning** — Brief written. Framed candidates A/B/C/D + Mac-mini-vs-cloud as separate axis.
- **2026-04-30 mid-day** — Three parallel research agents return. Brief's "predicted Option B" validated; refined to specifically Anthropic Agent SDK (vs bare SDK, both of which were lumped as "Option B" in the brief).
- **2026-04-30 afternoon** — Recommendation report v1 written, then v2 after self-review. v2 recommended Option B with hybrid cloud-primary + Mac-mini-for-EDI-and-backup deployment.
- **2026-04-30 evening** — User pushback: if mini isn't load-bearing for agents, why keep it for anything? Both retained roles have cleaner cloud-native solutions. Decision finalized to **cloud-only**.
- **2026-04-30 evening** — `tmp/ready-plans/2026-04-30-cloud-only-refactor.md` plan written, reviewed 3x, executed.

For full reasoning see `tmp/research/2026-04-30-agent-runtime-recommendation.md` v3 (current) and `tmp/research/2026-04-30-agent-runtime-recommendation-v2.md` (frozen v2 with hybrid reasoning).
