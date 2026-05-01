# Brief: Phase 2 — pharmacy-to-marketplace listing automation (the real meat)

> **Reframe:** Earlier framing of "arbitrage engine" was downstream of the actual product. The product is **listing automation for pharmacies**: a pharmacist picks OTC products, the system gets them live on Amazon (and own-store, eBay), keeps them priced sensibly, and fulfills orders with minimal touch. Arbitrage opportunities (stock-out premiums) fall out of solving listing-and-management friction.

## Why

Phase 1 shipped the shell — Inbox, Chat, auth, Supabase schema, 9 skill prompts as files, weekly backups. The shell is empty: no agents running, no live data, no actual product flow. Phase 2 builds the value loop the project exists for.

The fundamental gap (stated by Dev): **"prove that it's easy for pharmacies to post any items they want on their Amazon and their own store, and it just gets done and is super easy to manage."** That's the north star. Repricing, sourcing, account health, customer triage — all of those are *consequences* of having products listed and orders flowing. If listing is hard, nothing downstream matters.

## Context

**What's already there (Phase 1 shipped, commit `e61ea77`):**
- Next.js 14 App Router on Render. Local dev fully running on port 3000.
- Supabase Postgres with 23 tables across queue / data / memory / policy / audit.
- `proposed_actions`, `audit_log`, `inbox_items` tables exist but are unused.
- 5 chat tools (query_products, query_orders, search_memory, get_recent_briefings, enqueue_job) wired to OpenRouter (Sonnet 4.6 reasoning medium).
- 9 skill prompt files at `minicrew-config/skills/*.md` — authored, not yet runnable (minicrew Linux port pending in a separate stream).
- `briefings`, `inbox_items` tables seeded with 3 mock rows each.
- Dev sign-in shortcut at `/api/auth/dev-login` (NODE_ENV gate, password `000000`).

**What's not there:**
- No proposal-approval-execute loop. Inbox cards render but have no buttons that mutate state.
- No agents running. No cron, no worker.
- No live data sources. SP-API not connected. EzriRx not connected. Keepa not subscribed.
- No tests (Phase 1 punted them).

**External blockers (each can be mocked so none gates code):**
| Blocker | Owner | ETA |
|---|---|---|
| SP-API gating | Kaleem submits app | 1–4 wk Amazon |
| EzriRx onboarding | Kaleem signs up (he has an account) | days |
| Keepa subscription | Dev pays $54/mo when needed | same day |
| minicrew Linux port | Dev's other repo | unknown |

**Settled constraints:**
- Human-in-loop on every executor write. Kaleem clicks every Buy / Approve / Send.
- 30-min undo window on every action.
- OTC-only. Never touch Pioneer / Heartland / Rx.
- OpenRouter for inference (Sonnet 4.6 / Grok 4.3). Not Anthropic direct.
- minicrew is the eventual orchestrator but Phase 2 Layer 2 deliberately doesn't depend on it.

## Decisions

- **Product framing is listing automation, not arbitrage** — arbitrage is a use case that emerges from solving listing friction. Reorders the agent priority list. *Source: Dev verbatim, this session.*

- **Layered Phase 2 sequence: kernel → listing agent → repricer → fulfillment → research-lite** — proposal-approval-execute kernel first because every agent depends on it; listing agent first among real agents because that's the stated gap; repricer second because it's narrow and proves the propose-only pattern; fulfillment third because EzriRx is now obtainable; research-analyst last and simplified.

- **Repricer is propose-only forever** — never auto-changes prices. Inbox card shows recommended price + reasoning; Kaleem clicks accept. *Source: Dev verbatim — "this shouldn't be changing the prices automatically itself."*

- **Research Analyst is single-pass, not 8-fan-out** — first-principles version is a recommendation, not a research paper. Drop the parallel sub-agent fanout entirely; single LLM call returns N candidate products with one-line reasoning each. Can scale up later if the simple version isn't good enough. *Source: Dev verbatim — "eight fan out subagents is a little heavy."*

- **Listing agent is the first real agent** — supersedes earlier Repricer-first recommendation given the reframe. Flow: agent proposes "list product X on Amazon at price $Y" → inbox card with full reasoning → Kaleem approves → SP-API `createFeed` publishes the listing → audit_log entry with 30-min undo. While SP-API approval pends, runs in mock mode (writes to a `pending_listings` table; "publish" is a stub).

- **Fulfillment Ops is high priority because EzriRx is unblocked** — Kaleem already has an EzriRx account, so the integration is a matter of him sharing credentials, not waiting for Amazon. Sequence after Listing + Repricer because order-volume requires listings to exist first.

- **Kaleem onboarding starts in parallel today** — SP-API gating is 1–4 wk Amazon-side; if we don't kick it off now the delay lands later when we're ready. Capture as a Dev-facing playbook (`docs/kaleem-onboarding.md`) that a fresh agent can run the waterfall from.

## Rejected alternatives

- **Repricer as first real agent** (my earlier recommendation) — overruled by the listing-first reframe. The narrowest agent isn't the right first agent if it doesn't address the stated gap.
- **Research Analyst with 8 fan-out subagents** — too complex for first principles; defer or drop entirely.
- **Repricer auto-execution within rules** — explicitly rejected; propose-only forever per Dev.
- **Wait for SP-API approval before building Phase 2** — wastes 1–4 weeks; mocks let us prove the loop on our timeline.
- **Build all 9 agents on minicrew first** — couples to external dep; one-agent-on-Vercel-cron is good enough for Layer 2.
- **Multi-tenant from day 1** — single pharmacy in Phase 2; multi-pharmacy data model already exists (RLS scaffolded), just don't activate it.

## Direction

Phase 2 in 4 layers, built sequentially. Each layer is independently demoable.

**Layer 1 — Kernel (proposal → approval → execute → audit → undo)**
- `proposed_actions` rows render as approve/reject buttons in inbox cards
- Approval writes `audit_log` row with `undo_window_expires_at = now() + 30 min`
- Executor dispatcher with stub implementations per action type (logs "would call X")
- Undo button on every action within window — reverses by writing a compensating audit_log row
- Independent of any agent; runs against seeded mock proposals

**Layer 2 — Listing agent against mocks**
- Cron-triggered (Vercel cron / Supabase Edge function — no minicrew dep yet)
- Reads `products` table for unlisted OTC SKUs
- Single LLM call (Sonnet 4.6) proposes listing details: title, bullet points, suggested price, reasoning
- Writes `proposed_actions` row → inbox surfaces it
- Kaleem approves → executor calls SP-API `createFeed` (stubbed until SP-API approved)
- Once SP-API live, swap stub for real call. Undo within 30 min = `deleteFeed` or similar reversal.

**Layer 3 — Repricer (propose-only)**
- Cron-triggered, reads live listings from `listings` table
- Proposes price changes when Buy Box flips, FBA stock-out detected, or scarcity premium opens
- Inbox card shows: current price, recommended price, reasoning, expected delta
- Kaleem clicks accept → SP-API `submitFeed` price update
- Never auto-changes. Even within "rules," still proposes.

**Layer 4 — Fulfillment Ops + Research Analyst (lite)**
- Fulfillment: order webhook → query EzriRx + direct sources → inbox card with comparison table → Kaleem picks supplier → SP-API marks shipped after PO confirmation
- Research Analyst: weekly cron, single-pass, returns 5 candidate products to consider listing with one-line reasoning each. No fan-out.

**Layers 5+ (deferred to Phase 2.5 / Phase 3):** Account Health, Customer Triage, Bookkeeper, Portfolio, Reflector. Each follows the same pattern (cron → propose → inbox → approve → execute → audit). Order TBD based on what Phase 1–4 reveals.

**Parallel track: Kaleem onboarding waterfall** — Dev-facing playbook at `docs/kaleem-onboarding.md`. Self-contained, sequenced, drop-into-fresh-agent ready. Captures every credential the system needs and where it goes in `.env`.

---

## Suggested next step

`/plan` Phase 2 Layer 1 (kernel) + Layer 2 (listing agent against mocks) as one ready-plan. Layers 3–4 get separate plans once Layer 2 proves the pattern. Don't try to plan all four layers upfront — too much will change once we see Layer 1+2 land.
