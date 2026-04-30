---
date: 2026-04-30
topic: PharmaDash agent runtime — final recommendation
status: v2 — after self-review
audience: Dev + Nick
sources_count: 50+
---

# PharmaDash — Agent Runtime Recommendation

## TL;DR

**Run minicrew + Claude Agent SDK (TypeScript) on Render, with the Mac mini reduced to EDI polling + local backup. Adopt LangSmith free tier for observability, framework-agnostic.**

This is a small change from the current Phase 1 plan (which uses Claude Code CLI sessions on the Mac mini), preserves 100% of the skill-prompt investment, removes the unconventional "CLI as production runtime" bet, eliminates the pharmacy-WiFi single point of failure, and gives you native human-in-the-loop primitives + observability out of the box.

The headline reasons:
- **Claude Code CLI and Claude Agent SDK are the same engine.** Anthropic now explicitly recommends the SDK for production and the CLI for one-off tasks. Migration is mechanical: same `.claude/skills/*/SKILL.md` files, same prompts, swap subprocess invocation for a library call.
- **The job-queue + briefings/inbox state-machine you've already designed is the right shape for HITL.** Agent produces a proposal artifact, exits. Kaleem clicks. Executor (separate job) runs. This pattern doesn't benefit from LangGraph's `interrupt()` durability the way a long-running customer-support flow would.
- **The TS-native vs Python question matters.** Adopting LangGraph or Mastra means rewriting all 9 skill prompts and either running a Python sidecar service or staying on TS-but-less-mature. Agent SDK lets you stay TS, keep the Markdown skills, and ship Phase 2 sooner.
- **Mac mini is a separable decision** and the current plan over-couples it to the runtime choice. Pharmacy power outage shouldn't stop agents.

---

## What's Actually Being Decided

The current Phase 1 plan calls the agent runtime *"minicrew + Claude Code CLI sessions on Kaleem's Mac mini."* The user surfaced two concerns:

1. *"If this runs as a business, I don't know"* — uncertainty whether the chosen runtime is production-grade.
2. *"We'd need a Mac mini for that"* — concern about the hardware coupling.

These are two different decisions, and they should be made separately:

**Decision 1 — Inference layer:** how does each agent job actually call Claude?
- Subprocess to `claude -p` CLI (current plan)
- Library call to Claude Agent SDK
- Library call to bare Anthropic SDK with hand-rolled tool loop
- Framework (LangGraph / Mastra / Inngest AgentKit) wrapping the SDK

**Decision 2 — Where the worker runs:**
- Mac mini at the pharmacy (current plan)
- Cloud (Render / Fly / VPS)
- Both (cloud primary, mini for on-prem-only tasks)

This report addresses both, but the inference-layer decision dominates so it goes first.

What stays constant regardless of choice:
- Supabase as source of truth (queue, business data, memory, audit)
- Skill prompts as version-controlled artifacts
- `audit_log` + 30-min undo as your domain logic (no framework gives this for free)
- `briefings` + `inbox_items` state machine
- `claude_usage` tracking + daily spend cap (schema unchanged; capture point shifts from per-`messages.create` call to per-`query()` call under SDK, then rolls up internal Claude calls inside)
- Per-job model selection (Haiku / Sonnet / Opus per agent type)
- Multi-tenant boundary via `pharmacy_id`

---

## The Candidates

After research, the serious options narrow to six. Anything not on this list (LangChain classic, AutoGen/MAF, OpenAI Agents SDK, LlamaIndex AgentWorkflow, Pydantic AI, DSPy, Strands Agents, CrewAI, Agno) is either deprecated, wrong-vendor-optimized, or undifferentiated for this specific use case — see "Rejected Alternatives" below for one-line reasoning per option.

| # | Option | Description |
|---|---|---|
| **A** | **minicrew + Claude Code CLI** | Current plan. `claude -p "<prompt>" --allowed-tools ...` per job. |
| **B** | **minicrew + Claude Agent SDK (TS)** | Same engine, library form. `query({...})` from a Node worker. |
| **C** | **minicrew + bare Anthropic SDK** | `anthropic.messages.create({tools:[...]})` with hand-rolled loop. (Already in use by chatbot.) |
| **D** | **LangGraph + Anthropic SDK + minicrew** | LangGraph as in-job engine, minicrew as outer queue. |
| **E** | **Mastra + Anthropic SDK + minicrew** | Mastra Workflows as in-job engine. TS-native LangGraph alternative. |
| **F** | **Inngest AgentKit + Inngest runtime** | Single-vendor TS stack. Replaces minicrew entirely. |

---

## Comparison Matrix

Scored 1–5 (5 best). Cell reasoning in the per-option analysis below.

| Dimension | A. CLI | B. Agent SDK | C. Bare SDK | D. LangGraph | E. Mastra | F. Inngest AgentKit |
|---|---|---|---|---|---|---|
| **Fit-for-pattern** (multi-agent + HITL on every action) | 3 | 4 | 3 | 5 | 4 | 4 |
| **Recovery / durability** (worker crash, resume) | 2 | 3 | 3 | 5 | 4 | 5 |
| **Observability** (out-of-box tracing, cost) | 2 | 5 | 2 | 5 | 3 | 4 |
| **Vendor lock-in** (5 = low, easy to leave) | 5 | 4 | 5 | 3 | 4 | 2 |
| **Dev velocity** (time to ship Phase 2) | 3 | 5 | 3 | 3 | 3 | 3 |
| **Cost** (per-job inference overhead) | 2 | 3 | 5 | 4 | 4 | 4 |
| **Reliability** (production maturity, API stability) | 4 | 4 | 5 | 4 | 3 | 4 |
| **Ecosystem** (community, docs, hiring) | 3 | 4 | 5 | 5 | 3 | 3 |
| **Skill-prompt portability** (do `.claude/skills/*.md` files port?) | 5 | 5 | 2 | 1 | 1 | 1 |
| **TS-stack alignment** (no Python sidecar needed) | 3 | 5 | 5 | 3 | 5 | 5 |
| **TOTAL** | **32** | **42** | **38** | **38** | **35** | **36** |

The matrix is a heuristic, not a verdict. The qualitative analysis matters more — totals are close enough that the decision turns on which dimensions are load-bearing for *this* project. The two highest-weight dimensions for PharmaDash are skill-prompt portability (you've already invested in 9 skill files) and TS-stack alignment (the chatbot is Next.js). Both favor B.

---

## Per-Option Analysis

### A. minicrew + Claude Code CLI (current plan)

**What it is.** Each job in the Supabase queue spawns a `claude -p "<skill prompt>" --allowed-tools ...` subprocess. Output captured as JSON, parsed for tool calls and final result.

**Strengths.**
- Zero-friction prototyping. Skill prompts as files, full filesystem-based config.
- Trivial cron integration.
- Built-in tool suite ships with the binary.

**Weaknesses.**
- **Anthropic now soft-pushes against this for production.** Their docs explicitly say "use the API for production workloads" and the CLI page redirects users to the SDK for "structured outputs, tool approval callbacks, and native message objects." ([Anthropic Help Center](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan), [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview))
- **Subprocess startup tax is real.** Reports show ~50K tokens consumed per cold subprocess turn from system-prompt + plugin + MCP-tool re-injection. Mitigated by `--bare` flag but not eliminated. At 9 agents × daily cron + event triggers, this is meaningful waste at the $300–500/mo budget.
- **Subprocess-spawning-subprocess is now blocked** as of Claude Code 2.1.39 (loop protection). Forecloses some orchestration patterns.
- **No typed tool-approval callbacks.** Permission management is `--allowedTools` flags, not a programmatic permission state machine.
- **No native OpenTelemetry.** Observability is whatever you parse from JSON output.
- **Lifecycle management** (timeouts, retries, zombie-process cleanup) is yours to build.

**PharmaDash fit.** Works. But Anthropic isn't recommending it, the cost overhead is real, and you're choosing the less-supported path of two paths to the same engine. **2.5/5 production fit per the research.**

---

### B. minicrew + Claude Agent SDK (TypeScript) ⭐

**What it is.** Library form of the same engine that powers Claude Code. `import { query } from "@anthropic-ai/claude-agent-sdk"` from a Node worker. Bundles a native Claude Code binary internally and spawns it as a child process, but you talk to it via stdin/stdout with structured message objects.

**Why this is the winner.**

1. **Same engine, same skill files.** `.claude/skills/*/SKILL.md`, `CLAUDE.md`, slash commands, plugins all load identically. The 9 skill prompts you author in Phase 1 work in the SDK without rewrite. The minicrew worker template *does* need updating (replacing subprocess invocation with `query()` call + async iteration over assistant/tool_use/tool_result messages — well-defined work, est. 1–2 days per worker template), but the agent definitions themselves don't change. This is a massive cost-saver compared to LangGraph or Mastra (which would require porting all 9 skills to graph-node form).

2. **Anthropic's officially recommended production path.** Their docs comparison table maps "Production automation → SDK" and "One-off tasks → CLI." The `claude-agent-sdk-python` and `@anthropic-ai/claude-agent-sdk` (TS) packages are GA. Used internally by Anthropic for "almost all of our major agent loops" per their engineering blog. ([Building agents with the Claude Agent SDK](https://claude.com/blog/building-agents-with-the-claude-agent-sdk))

3. **First-class HITL primitives.** `PreToolUse` / `PostToolUse` / `Stop` / `UserPromptSubmit` / `SessionStart` / `SessionEnd` hooks plus a dedicated `PermissionRequest` hook. The `permission_mode: "default"` plus tool-approval callback pattern is purpose-built for "human approves every action." The native `AskUserQuestion` tool gives multiple-choice clarifying-question handling for free. ([Hooks docs](https://platform.claude.com/docs/en/agent-sdk/hooks), [Permissions docs](https://platform.claude.com/docs/en/agent-sdk/permissions))

4. **OpenTelemetry built in.** Bundled CLI emits OTLP spans per model request and tool execution, plus token/cost metrics, plus structured prompt/tool-result log events. Native integrations with Honeycomb, Datadog, Langfuse, SigNoz, Dynatrace. **This removes a planned engineering task from the Phase 1 plan** (current plan rolls Sentry + custom claude_usage; SDK gives you OTLP for free, so Sentry stays for exceptions while OTLP gives you structured agent traces). ([Agent SDK observability](https://code.claude.com/docs/en/agent-sdk/observability))

5. **Subagents + sessions.** `AgentDefinition` / Agent tool gives you the orchestrator-of-specialists pattern natively if/when you want it. Sessions are JSONL on disk, resumable/forkable with a `session_id`. Useful if you ever want long-running threaded conversations between Chief of Staff and a specialist.

6. **Per-call cost tracking.** `total_cost_usd` and full token breakdown (input/output/cache-read/cache-creation) returned per `query()` call. Plugs directly into your `claude_usage` table without parsing.

7. **TypeScript-native.** No Python sidecar. Same language as your chatbot, same deploy target.

**Weaknesses (honest).**

1. **API churn is real.** Multiple breaking changes in patch releases (e.g., `Task` vs `Agent` tool name swapped twice). Pin versions, budget a few hours per quarter for upgrade work. ([TypeScript CHANGELOG](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md))

2. **No durable execution out of the box.** SDK runs the agent loop in your process. If your worker crashes mid-job, the session JSONL is recoverable but workflow-level retries/persistence are yours. **For PharmaDash this is fine** — minicrew already provides job-level retries via `attempt_count` / `max_attempts`, and your jobs are short single-pass agent reasoning ending in a database write, not multi-hour stateful flows. Crash recovery is "the job re-runs" not "the job resumes from step 47."

3. **Multi-agent coordination primitives are partial.** Subagents and sessions are GA. "Agent Teams" (shared task list, peer-to-peer messaging) and the long-running multi-context-window initializer/coding-agent split are documented in Anthropic's engineering blogs but not all in the public SDK GA. **For PharmaDash this is fine** — the Chief of Staff + 9 specialists pattern uses minicrew + Supabase + briefings/inbox as the inter-agent communication channel, not in-process peer messaging.

**PharmaDash fit.** Strongly suited. Three of the team's hardest non-negotiables — HITL on every action, observability, skill-prompt portability — map to first-class SDK features. The migration cost from the current Plan A (CLI) is mechanical: swap subprocess for library call. **4/5 production fit per the research, capped by SDK API churn risk.**

---

### C. minicrew + bare Anthropic SDK

**What it is.** `anthropic.messages.create({ tools: [...] })` with a hand-rolled `while (response.stop_reason === "tool_use") { ... }` loop. You implement the tool registry, execution, error handling, retry, prompt caching strategy, context management, session persistence, and observability yourself.

**Strengths.**
- **Cheapest per token.** No Claude Code system-prompt overhead, no plugin/MCP descriptions injected, no bundled-binary subprocess. ~30–60% cheaper per call than CLI for tight tool sets, based on the cited ~50K-token cold-start figure.
- **Already in your stack.** The Render chatbot uses this pattern. Operational familiarity.
- **No SDK-level churn.** `messages.create` API is mature and stable.
- **Anthropic's "Building Effective AI Agents" guide explicitly endorses minimal abstraction** ("don't hesitate to reduce abstraction layers and build with basic components as you move to production"). Worth being honest: that advice is most pointed at *framework over-abstraction* (LangChain/LangGraph) rather than at choosing between the bare SDK and the Agent SDK — Anthropic ships the Agent SDK as their own position on the "right amount" of abstraction. But the spirit of the advice does favor C over B for the simplest of agents.

**Weaknesses.**
- **You build everything HITL-related yourself.** No `PreToolUse` hook. No `PermissionRequest` hook. No `AskUserQuestion`. The approval state machine is your code.
- **No skill-file or subagent infrastructure.** `.claude/skills/*/SKILL.md` files become string constants you load yourself. Subagents become recursive `messages.create` calls you orchestrate. None of `.claude/skills/`, `CLAUDE.md`, or `Agent` tool semantics ship for free.
- **No built-in observability.** OTLP export, structured tool-result logging, per-call cost tracking — all hand-rolled.

**PharmaDash fit.** Defensible if you're optimizing for cost and minimum runtime tax. But for a 9-agent system with HITL + observability requirements, you'd be re-implementing ~60% of the Agent SDK. That's 2–4 weeks of engineering for capabilities Anthropic has already shipped. The cost saving doesn't pay back the engineering cost at this scale. **Better suited for leaner systems than yours.**

---

### D. LangGraph + Anthropic SDK + minicrew

**What it is.** LangGraph 1.0 (GA October 2025) as the in-job engine. Each job invokes `graph.invoke(state, {thread_id})`. Supervisor pattern routes between specialist sub-graphs. Postgres checkpointer (Supabase) persists state. `interrupt()` / `Command(resume)` for human approvals. minicrew remains as the outer scheduler/queue.

**Strengths.**
- **`interrupt()` + `Command(resume)` is genuinely beautiful for HITL.** First-class durable pause/resume. Klarna and Replit run this pattern in production for high-stakes approvals.
- **Supervisor + sub-graph maps 1:1 to Chief of Staff + 9 specialists** if you wanted real-time supervisor dispatch.
- **Durable resume on worker crash** via the Postgres checkpointer.
- **LangSmith tracing** is excellent (and is also usable framework-agnostic — see below).
- **Vendor health is solid.** $1.25B valuation, $260M raised (Sequoia/Benchmark/IVP), 1.0 stability commitment, 1k customers, real revenue. ([Fortune](https://fortune.com/2025/10/20/exclusive-early-ai-darling-langchain-is-now-a-unicorn-with-a-fresh-125-million-in-funding/))

**Weaknesses for PharmaDash specifically.**

1. **The current architecture doesn't actually need `interrupt()` durability.** Your HITL pattern is: agent produces a proposal artifact (briefing + inbox_item), exits. Kaleem clicks Approve. A *separate* executor job runs. There's no long-running graph paused mid-flow that needs to resume from step 47 — there's a state machine over multiple short jobs. The `interrupt()` advantage shines for chat-driven flows where users provide input mid-conversation, not for the propose-then-execute pattern PharmaDash uses. **This eliminates LangGraph's killer feature for this project.**

2. **Skill files don't port.** Your 9 skill prompts are written as Markdown files designed for Claude Code / Agent SDK consumption. LangGraph nodes are typed Python/TS functions over a state dict. Porting means rewriting all 9 — real engineering, not a config swap.

3. **TS edition lags Python.** Documented bugs (`interrupt()` only works under `.stream()` in some versions, not `.invoke()`). Tutorials skew Python. For a Next.js codebase, you either run Python LangGraph as a sidecar (operational complexity) or bet on the less-mature TS edition.

4. **Documentation is famously messy.** Legacy and current patterns mix; old tutorials reference deprecated APIs. There's an open issue specifically asking the team to label legacy vs current docs. Expect to read source code occasionally.

5. **Postgres checkpointer table growth is unbounded by default.** You schedule a cleanup cron from day one — easy to forget, hard to debug if you do.

6. **You'd still build the 30-min undo yourself.** LangGraph's `rollback` is for the concurrent-write race condition only, not generic side-effect undo.

**PharmaDash fit.** Conditional yes if your architecture were "Chief of Staff dispatches multi-step flows with human input mid-flow," but it isn't. Your architecture is "scheduled/event jobs produce proposal artifacts; UI handles approval; executor jobs commit." LangGraph would be over-engineered for this shape, and the skill-prompt rewrite cost is real. **Adopt LangGraph if/when** you build a synchronous Chief-of-Staff-supervised flow (e.g., "Kaleem asks a question in chat → CoS dispatches Research Analyst sub-graph → user provides clarification → continues"). For Phase 2 as currently scoped, the Agent SDK gets you there faster with less rewriting.

---

### E. Mastra + Anthropic SDK + minicrew

**What it is.** Mastra (TS-native agent framework, 22k+ stars, $22M Series A, 1.0 in Jan 2026) as in-job engine. Workflows + Agents abstractions. Production users include PayPal, Adobe, Replit (per their marketing).

**Strengths.**
- TS-native, no Python sidecar.
- Real production users.
- Workflows support suspend/resume for HITL.
- Cleaner agent abstraction than LangGraph for simpler flows.

**Weaknesses for PharmaDash.**
- **Skill files don't port** (same issue as LangGraph).
- **Less mature than LangGraph or Agent SDK.** Smaller community, shorter production track record, less battle-tested in HITL multi-agent specifically.
- **Mastra Cloud lock-in temptation** — the managed product is opinionated; self-hosted is supported but the marketing pulls you toward Cloud.
- **Doesn't solve a problem the Agent SDK doesn't already solve** for an Anthropic-only stack with skill-as-Markdown files.

**PharmaDash fit.** Worth a deeper look only if you'd reject Anthropic Agent SDK on principle. Otherwise B dominates E on every dimension that matters here. Genuinely the strongest candidate among non-Anthropic-native frameworks if you're committed to TS, but the skill-port cost and lower maturity vs Agent SDK makes B preferable.

---

### F. Inngest AgentKit + Inngest durable runtime

**What it is.** Inngest is a TS-native durable workflow runtime (event-sourced, serverless workers). AgentKit is their first-party multi-agent framework on top. Single vendor for orchestration + inference layers. HITL via `step.waitForEvent`. Anthropic / OpenAI / Gemini provider support.

**Strengths.**
- Single-vendor TS stack with integrated durable execution + HITL.
- Genuinely well-architected. Best end-to-end TS production stack from the framework survey.
- Inngest's durability primitives (`step.waitForEvent`, durable timers) are real.

**Weaknesses for PharmaDash.**
- **Replaces minicrew entirely** with Inngest as a platform dependency. That's a bigger commitment than the current question (which inference layer to use). minicrew is your code; you understand it; the queue + retries + crash recovery you'd be replacing is largely already delivered.
- **Skill files don't port.**
- **Vendor lock-in is the highest of any option.** Inngest hosted is the recommended path; self-host is possible but less polished.
- **Adoption signal is weaker.** AgentKit is newer than LangGraph or Agent SDK, fewer production case studies.

**PharmaDash fit.** Interesting alternative architecture if you were starting from scratch and didn't have minicrew. Given you do have minicrew and the per-tenant cost of Inngest for low-volume single-pharmacy work is unclear, B is preferable. Revisit F if minicrew Linux port hits unexpected problems and you'd rather adopt a vendor's runtime than fix your own.

---

## Rejected Alternatives (one-line reasoning)

- **LangChain "classic" (chains, AgentExecutor)** — deprecated; LangChain team itself routes new users to LangGraph.
- **CrewAI** — Python-only; would require sidecar service for capabilities Agent SDK or LangGraph cover natively in better-fitting languages.
- **Microsoft AutoGen** — in maintenance mode. Microsoft Agent Framework (MAF) 1.0 just shipped April 2026 — too young, wrong ecosystem fit.
- **OpenAI Agents SDK** — designed primarily around OpenAI's Responses API; using Anthropic via LiteLLM is wrong-layer-of-the-stack thinking for an Anthropic-first shop.
- **LlamaIndex AgentWorkflow** — fine framework but optimized for RAG-heavy systems; PharmaDash isn't primarily a RAG problem.
- **Pydantic AI** — strong type-safe framework but Python-only and not multi-agent-first by design.
- **DSPy** — different paradigm (programmatic prompt optimization). Useful as a *complement* later if prompt drift becomes measurable; not a replacement for orchestration.
- **Strands Agents (AWS)** — overlooked TS-supporting Anthropic-friendly option. Would only win if PharmaDash were on AWS infrastructure (it isn't — Render + Supabase).
- **Agno** — runtime platform layer, not a framework competitor. Worth a 30-minute look later if you want to avoid building your own minicrew worker harness, but not load-bearing for this decision.
- **Temporal as a substrate** — most rigorous answer to "durable HITL," but PharmaDash doesn't need that rigor for the propose-then-execute pattern. Revisit if/when you build long-running synchronous flows.

---

## The Recommendation

**Adopt Option B: minicrew + Claude Agent SDK (TypeScript), running on Render.**

Concrete delta vs current Phase 1 plan:

| Plan element | Current (Phase 1 v4) | Recommended |
|---|---|---|
| Inference layer per job | `claude -p` CLI subprocess | `query({...})` from `@anthropic-ai/claude-agent-sdk` |
| Worker location | Mac mini (Linux Mint, Kaleem's pharmacy) | Render (cloud) |
| Mac mini role | Primary agent worker + EDI polling + backup | EDI polling (where IP-allowlist needed) + weekly pg_dump backup |
| Skill prompts | `minicrew-config/skills/*.md` (Markdown) | **Unchanged** — files load identically in the SDK |
| HITL approval pattern | "Kaleem clicks every action" via inbox state | **Unchanged** — propose/approve/execute state machine |
| Observability plan | Sentry + `claude_usage` table | Sentry + `claude_usage` table + **OpenTelemetry from SDK → LangSmith free tier or Langfuse** |
| `audit_log` + 30-min undo | Yours to build | **Unchanged** — yours to build (no framework gives this) |
| Backup | Weekly pg_dump on Mac mini | **Unchanged** |
| Per-job model selection | Per-job-type config in minicrew | **Unchanged** — SDK supports model selection per `query()` call |

**Why this is the right answer for *this* project:**

1. **Lowest-friction migration from the current plan.** Skill prompts unchanged. Architecture unchanged. Just swap subprocess for library call. The "rewrite cost" is genuinely zero for the agent definitions.

2. **Removes the unconventional bet.** Claude Code CLI as a queue-driven production runtime is novel; Anthropic doesn't position it that way and the tools surveyed point to Agent SDK as the production path. You're not picking the path of greatest support.

3. **Stays in TypeScript.** The chatbot is Next.js. Adopting LangGraph or Mastra means either a Python sidecar or betting on a less-mature TS edition. Agent SDK avoids the choice entirely.

4. **HITL hooks for free.** `PreToolUse` / `PermissionRequest` hooks let you wire fine-grained approval gates inside agent execution if you ever need them (e.g., Repricer agent wants to spend more than $X on a Keepa lookup → SDK pauses → escalate to inbox). The propose-then-execute pattern still handles 95% of HITL needs at the queue level; SDK hooks handle the other 5%.

5. **Observability as a config flag, not an engineering project.** OpenTelemetry export is a Claude Agent SDK setting. Plug it into LangSmith free tier (5k traces/mo, framework-agnostic) for the first month or two of Phase 2; upgrade to LangSmith Plus when Kaleem's actual usage exceeds it (or use Langfuse self-hosted as a free OSS alternative — also speaks OTLP). The current plan rolls Sentry + `claude_usage` from scratch; the SDK gives you OTLP + structured trace events on top of those, not in place of them.

6. **Cost predictability.** Per-call `total_cost_usd` returned by the SDK plugs straight into `claude_usage`. The CLI subprocess overhead (~50K tokens cold-start) is reduced via the SDK's child-process reuse. Real money over 9 agents × daily cron.

7. **Clean exit path.** If Anthropic ever flakes, the migration to bare Anthropic SDK + hand-rolled tool loop is mechanical. If a better framework emerges, you've still got version-controlled skill files. No deep lock-in beyond the Anthropic vendor relationship — which you're already committed to for inference quality.

**What we're consciously deferring to Phase 3+ rather than adopting now:**
- LangGraph for any synchronous Chief-of-Staff flows (none in current plan)
- Temporal as a durable substrate (no current need given propose-then-execute pattern)
- Agno as a managed worker harness (revisit if minicrew Linux port disappoints)
- Mastra or Inngest AgentKit (only if reasons to leave Anthropic-native emerge)

### When does this hit code?

Phase 1 doesn't execute agents — skill prompts are authored as files for later runtime. The decision lands at Phase 2 startup, when the minicrew runtime comes online. Practically:

- **Phase 1 ships almost unchanged.** The skill files, schema, chatbot, Inbox, audit_log, claude_usage, backup script — all the same. Three small deltas: (a) `docs/integrations.md` notes Agent SDK as the planned runtime instead of CLI, (b) `tmp/ready-plans/` gets a small addendum for the Phase 2 worker template, (c) Render deploy plan reserves capacity for an agent-worker service alongside the existing web service.
- **Phase 2 day 1** is when the worker template gets written. Pick the simplest agent (Bookkeeper — daily cron, single-pass reasoning, writes one report row, no executor branch) and build the first minicrew worker template against the SDK. Validate end-to-end before porting the rest.

### Suggested Phase 2 day-1 spike (de-risks the decision)

Time-box to 1–2 days. Pick the Bookkeeper agent. Build one minicrew worker template using `@anthropic-ai/claude-agent-sdk`. Confirm five things:

1. Skill file (`minicrew-config/skills/bookkeeper.md`) loads via `setting_sources` / `settingSources` config
2. `PreToolUse` hook fires when the agent calls a tool (even if it just logs)
3. OTLP traces export to a chosen backend (LangSmith free tier or Langfuse self-host)
4. `total_cost_usd` from each `query()` call lands in `claude_usage` correctly
5. Worker can be killed mid-run and minicrew's `attempt_count` retry logic re-runs the job cleanly

If any of these fail or feel awkward, escalate before porting the other 8 agents. If all pass, the runtime decision is validated and the rest of Phase 2 proceeds with confidence.

---

## The Mac Mini Sub-Decision

Pull this apart from the runtime choice: it's a *deployment* decision, not an *architecture* decision.

**Current plan:** Mac mini at the pharmacy is the primary agent worker. Free compute, free local backup target, lives where Kaleem can see it.

**The risk that's load-bearing for a business:** if pharmacy power blips or WiFi drops, agents stop. For a system where Account Health monitors auto-pause your listings on red metrics — being unable to *run* Account Health for 6 hours during an outage is the literal failure mode you most need to avoid.

**Recommendation: cloud-primary, mini for what only on-prem can do.**

Three roles for the mini:
1. **EDI polling** — some wholesalers IP-allowlist; if ABC or McKesson's SFTP requires a fixed IP and the pharmacy has one, mini is the natural place. (Confirm with each rep.)
2. **Local pg_dump backup target** — already in the plan. Off-cloud disaster recovery is genuinely valuable.
3. **Optional fallback worker** — minicrew can run on multiple machines pulling from the same queue; mini as a backup pool is fine.

The agent worker primary lives on Render. Roughly $10–30/mo extra compute for predictable uptime (Render starter/standard worker tiers; verify against current Render pricing). This is the cheapest production-readiness gain in the entire decision space.

If the user pushes back on "we already have free compute, why pay" — the answer is: the mini doesn't disappear, it just isn't load-bearing for agent uptime. You keep the free compute for the things only it can do. The cloud worker is the fallback for the failure modes the mini introduces.

---

## What Would Make Me Change This Recommendation

Honest list. If any of these change, revisit:

1. **If Kaleem rejects the cloud-primary deployment** for reasons (data residency, cost, control), the runtime choice stays B but mini becomes the worker — single point of failure consciously accepted, with a cloud fallback worker as the mitigation.

2. **If Anthropic Agent SDK has a major breaking change in Q3 2026** that destabilizes pinned versions and breaks our wrapper, downgrading to bare Anthropic SDK (Option C) is mechanical — same skill files, less framework surface area, accept the engineering cost of building HITL hooks ourselves. Lock-in is genuinely low.

3. **If Phase 2 work surfaces a need for synchronous Chief-of-Staff dispatch** (real-time multi-step flows where Kaleem provides input mid-flow rather than reviewing finished proposals), LangGraph for *that specific surface* becomes worth adding. Be honest about the cost: maintaining two agent stacks (Agent SDK for batch jobs + LangGraph for synchronous flows) means two upgrade paths, two failure modes, and developer cognitive load on every change. Only adopt the second stack if synchronous-supervisor flows are frequent enough to justify, not for a single one-off case.

4. **If observability needs exceed what SDK + LangSmith free tier delivers**, the alternatives (Datadog, Honeycomb, Langfuse) plug into the same OTLP feed. Not a runtime decision.

5. **If minicrew's Linux port fails to land or has serious issues**, revisit Inngest AgentKit (Option F) or Trigger.dev as a managed-runtime replacement. Inference layer stays Agent SDK; orchestrator changes.

---

## Open Risks & Honest Caveats

Things I want to flag in the recommendation that aren't blockers but you should know:

1. **Agent SDK is Anthropic-built, ~6-12 months old as a publicly-named product.** It's stable but not 5-years-old stable. Pin versions. The "production" framing in the docs is real but recent.

2. **The OTLP integration story sounds clean in docs but I haven't validated it end-to-end against LangSmith specifically.** LangSmith advertises framework-agnostic OTLP ingestion; the Agent SDK emits OTLP. They should compose. Test in Phase 1 before depending on it.

3. **Per-call cost tracking from the SDK matches what you'd compute manually from token counts** — but the SDK's cost model assumes its bundled binary's prompt-cache behavior, which differs from bare-SDK. Sanity-check the dollar amounts against Anthropic's bills for the first month.

4. **The 50K-token subprocess overhead figure is from a community blog post, not Anthropic.** Their counter is "use `--bare` and `setting_sources` to prune what loads." Real overhead is somewhere between "minimal" (with discipline) and "50K cold-start" (without). Plan for the worse end of that range and budget accordingly.

5. **The current plan's `claude_usage` table** measures spend at the chat-route level (one row per Claude API call). Agent SDK adds a layer (one `query()` may make multiple Claude calls internally). Track at the `query()` level (use `total_cost_usd`) and roll up to the existing table. Schema doesn't change; capture point does.

6. **LangSmith free tier is 5k traces/month.** A "trace" is roughly one Claude API call with all its child events. Once Phase 2 agents are live, expect 1.5–3k traces/month early (9 agents × daily cron + chatbot + event triggers, single user); a busy month with all event-driven flows firing could push 5k+. Budget LangSmith Plus tier (paid; check current pricing) for steady-state production, or use Langfuse self-hosted as a free OSS alternative.

7. **API churn risk for the SDK is real.** Per the research, multiple breaking changes have shipped in patch releases. The mitigation is to wrap the SDK in a thin internal interface (`agentRun(skillName, input)`) so a future migration to bare SDK is mechanical. Cheap, defensive coding.

8. **I have not built this stack end-to-end.** The recommendation is based on documentation, engineering blogs, and third-party reports. The Phase 2 day-1 spike (described above) is the de-risking step. Cheap insurance.

9. **Repricer's "autonomous within rules" path and Account Health's "red = auto-pause" path are exceptions to the propose-then-execute pattern.** They take direct write actions (SP-API price change, listing pause) during agent execution, not via a separate executor job. For these, transactionality matters: write `audit_log` BEFORE the side-effect call (mark as `pending`) and update to `completed` after success. Otherwise a worker crashing between side-effect-success and audit-write leaves an unauditable change — silently breaking the 30-min undo invariant. The Agent SDK doesn't fix this; it's a discipline issue in your action handler. Same fix would be needed regardless of runtime choice. Bake it into the worker template patterns from day 1 of Phase 2.

10. **minicrew's Linux port (currently in progress on a parallel stream) is being designed against the Claude Code CLI invocation pattern.** Switching to Agent SDK invocation requires updating the minicrew worker template. The dev wrote minicrew, so changes are tractable, but it's a coordination point with the parallel-track work — worth flagging before the port lands so the worker-spawning code targets `query()` instead of `claude -p` from the start.

---

## Sources

### Anthropic Agent SDK / Claude Code
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Run Claude Code programmatically (Agent SDK CLI / headless)](https://code.claude.com/docs/en/headless)
- [Building agents with the Claude Agent SDK — Anthropic engineering](https://claude.com/blog/building-agents-with-the-claude-agent-sdk)
- [Hooks documentation](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Permissions documentation](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Subagents in the SDK](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [Observability with OpenTelemetry](https://code.claude.com/docs/en/agent-sdk/observability)
- [Track cost and usage](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)
- [Migration guide (CLI → SDK)](https://platform.claude.com/docs/en/agent-sdk/migration-guide)
- [claude-agent-sdk-typescript CHANGELOG](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md)
- [Using Claude Code with Pro/Max plan](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
- [Building Effective AI Agents — Anthropic research](https://www.anthropic.com/research/building-effective-agents)
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Why Claude Code subagents waste 50K tokens per turn (DEV)](https://dev.to/jungjaehoon/why-claude-code-subagents-waste-50k-tokens-per-turn-and-how-to-fix-it-41ma)
- [Building automated Claude Code workers with cron and MCP](https://www.blle.co/blog/automated-claude-code-workers)
- [Building fault-tolerant workflows: Claude Agent SDK × Temporal](https://claudelab.net/en/articles/api-sdk/claude-agent-sdk-temporal-durable-ai-workflows-production-guide)

### LangGraph / LangChain ecosystem
- [LangChain & LangGraph 1.0 announcement](https://blog.langchain.com/langchain-langgraph-1dot0/)
- [LangGraph overview docs](https://docs.langchain.com/oss/python/langgraph/overview)
- [Interrupts docs](https://docs.langchain.com/oss/python/langgraph/interrupts)
- [HITL with interrupt() April 2026 (BSWEN)](https://docs.bswen.com/blog/2026-04-16-langgraph-human-in-the-loop/)
- [LangChain blog: Is LangGraph used in production?](https://blog.langchain.com/is-langgraph-used-in-production/)
- [langgraph-supervisor-py on GitHub](https://github.com/langchain-ai/langgraph-supervisor-py)
- [Databricks: Multi-Agent Supervisor Architecture](https://www.databricks.com/blog/multi-agent-supervisor-architecture-orchestrating-enterprise-ai-scale)
- [langgraph-checkpoint-postgres on PyPI](https://pypi.org/project/langgraph-checkpoint-postgres/)
- [@skroyc/langgraph-supabase-checkpointer on npm](https://www.npmjs.com/package/@skroyc/langgraph-supabase-checkpointer)
- [LangSmith pricing](https://www.langchain.com/pricing)
- [LangSmith observability](https://www.langchain.com/langsmith/observability)
- [Fortune: LangChain unicorn at $1.25B](https://fortune.com/2025/10/20/exclusive-early-ai-darling-langchain-is-now-a-unicorn-with-a-fresh-125-million-in-funding/)
- [GitHub issue #3365: docs legacy vs modern](https://github.com/langchain-ai/langgraph/issues/3365)
- [GitHub issue #1422: TS interrupt streaming-only](https://github.com/langchain-ai/langgraphjs/issues/1422)
- [The Hacker News: LangChain/LangGraph CVE March 2026](https://thehackernews.com/2026/03/langchain-langgraph-flaws-expose-files.html)

### Other framework surveys
- [Mastra homepage and production claims](https://mastra.ai/)
- [Mastra TypeScript framework — The New Stack](https://thenewstack.io/mastra-empowers-web-devs-to-build-ai-agents-in-typescript/)
- [Inngest AgentKit overview](https://agentkit.inngest.com/overview)
- [Inngest vs Temporal comparison — Akka](https://akka.io/blog/inngest-vs-temporal)
- [Temporal Human-in-the-Loop AI Agent docs](https://docs.temporal.io/ai-cookbook/human-in-the-loop-python)
- [Microsoft Agent Framework 1.0 GA announcement](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/)
- [Strands Agents 1.0 — AWS Open Source Blog](https://aws.amazon.com/blogs/opensource/introducing-strands-agents-1-0-production-ready-multi-agent-orchestration-made-simple/)
- [2026 AI Agent Framework Showdown — QubitTool](https://qubittool.com/blog/ai-agent-framework-comparison-2026)
- [Best Multi-Agent Frameworks in 2026 — gurusup](https://gurusup.com/blog/best-multi-agent-frameworks-2026)
- [DSPy vs LangGraph — LangWatch](https://langwatch.ai/blog/best-ai-agent-frameworks-in-2025-comparing-langgraph-dspy-crewai-agno-and-more)
