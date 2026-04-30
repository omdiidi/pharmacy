# Brief: Pharmacy OTC Arbitrage Platform

Synthesizes decisions from discussion session on 2026-04-18.

> **2026-04-30 architecture update:** This brief assumes the Mac mini as primary agent worker (see "Compute" line in the Technical Stack section, "Memory: weekly pg_dump to Mac mini" decision, and the "Mac mini running Linux Mint" line in Existing Tools). After follow-up research and user discussion, the architecture moved to **cloud-only on Render** with backup to Backblaze B2 in a separate cloud account. The brief is preserved as a historical decision record from the April 18 discussion; for current architecture see `tmp/research/2026-04-30-agent-runtime-recommendation.md` v3 and `tmp/ready-plans/2026-04-30-cloud-only-refactor.md`.

## Why

Kaleem (licensed pharmacist, 2 pharmacies in Utah — St. Mark's + Redwood Rd) wants to automate his Amazon + eBay OTC product listing business. Currently he does it by hand: lists ~30 SKUs, fulfills orders by searching ABC Order / Parmed / McKesson / Cardinal wholesaler portals, uses Perplexity for market research, copy-pastes product descriptions. He already makes real money at this (saw 5+ orders in one day on the transcript, Tinactin sold at $51 from $7 cost during a stock-out). The opportunity is clear; automation removes the manual grind and adds intelligence he can't do by hand.

A second MSF-funded friend has offered a $10k Amazon challenge — "show me $10k/month and I'll buy your software" — so the system also proves the thesis for a potential buyer.

## Context

### Business thesis
- **Amazon-first**, **OTC-only**, **FBM-only dropship** (never FBA), **existing ASINs only** (no new product creation)
- **Two pharmacies as one tenant** (shared supplier accounts mostly)
- **OTC completely isolated from Rx / Pioneer PMS** — we never touch prescription data
- Dec 2025 Amazon supplement TIC requirement applies; licensed-pharmacist status gives exceptions on many categories but not TIC / DEA / kratom / CBD / federal bans
- **Licensed pharmacist on Amazon = exceptions** that widen Kaleem's playable universe vs a regular arbitrage seller

### The defensible edge
Stock-out arbitrage. H&PC is FBA-trust-premium-dominated — FBM sellers can't win Buy Box at parity with FBA. BUT when FBA is exhausted, the trust penalty disappears and FBM wins at scarcity premiums. The whole Product Manager is targeted at FBA-empty / FBM-dominant windows. The FBA→FBM Buy Box flip is the highest-signal leading indicator.

Signals to combine:
- **Supply**: EzriRx EDI 832/846 + direct ABC EDI (slower track) + on-demand portal scrape + FDA Drug Shortage API + FDA Recall feed
- **Demand**: Keepa (BSR, offer count, BB price/winner history, FBA/FBM), SP-API `getCompetitiveSummary`, Google Trends, Kaleem's sales history, seasonal index per category archetype
- **Margin**: multi-wholesaler cost comparison, Amazon fees, shipping, Fair Pricing ceiling (25% above 30d BB median)

### Critical constraints from research
1. Amazon Fair Pricing Policy = hard ceiling (~25% above 30d BB median) — scarcity premium is bounded
2. FBA→FBM Buy Box flip = killer leading indicator
3. Hard auto-exclude list: pseudoephedrine, ephedrine, kratom, CBD, lidocaine >4%/5%, DEA-scheduled, disease claims
4. Dec 2025 TIC mandate for supplements (NSF/Eurofins/UL verification annually)
5. Wholesaler invoices (ABC/McKesson/Cardinal/Parmed) face extra Amazon scrutiny — plan escalation
6. Brand-authorization wedge: Pfizer, J&J, Pharmavite actively hunt unauthorized resellers (license status helps but doesn't fully protect)
7. Expired-product complaints = #1 supplement suspension driver — min 9mo shelf life at ship
8. Must blind-ship from wholesaler (Kaleem confirms ABC already does)

### Research artifacts (keep accessible)
- `tmp/research/2026-04-18-product-manager-research.md` — full synthesis (60+ sources)

### Kaleem's existing tools/assets
- Amazon Seller account (active, ~30 listings)
- eBay seller account (active)
- ABC Order ($50/mo GMP fee — buys daily price+inventory file drop into Pioneer; we can ask to route same feed to our SFTP)
- Parmed account (Cencora-owned, likely same EDI path)
- Pioneer (prescription-side — we don't touch)
- Heartland POS (prescription-side — we don't touch)
- Mac mini running Linux Mint (Intel, 8GB — ~~workhorse for agent runtime~~ no longer load-bearing as of 2026-04-30; see top callout)

## Decisions

### Product shape
- **Product Manager / Opportunity Feed replaces the traditional Dashboard** — agent-briefing timeline, not dense table
- **Agent swarm pattern**: 9 specialist agents coordinated by a Chief of Staff, shared long-term memory, reporting to Kaleem via Inbox + Chat
- **Chief of Staff + Business Chatbot** = Kaleem's single conversational interface to everything
- **Inbox pattern** (not dashboard) with state tracking per briefing (pending/seen/acted/archived)
- **Per-agent schedule updates from earlier plan**:
  - Research Analyst: 6am cron daily (not 15min polling)
  - Repricer: 2 sweeps/day (7am + 2pm) + event-driven on Keepa price alerts (NOT 15 min — saves credits)
  - Fulfillment Ops: on SP-API order webhook → **shows Kaleem full source-comparison table, he picks** (not auto-decide)
  - Account Health: daily 6am + event-triggered (NOT hourly)
  - Customer Success: on message webhook with triage-first step (skip noise)
  - Bookkeeper: daily 11pm + on payout events
  - Portfolio Manager + Reflector: weekly, with full-year + multi-year context pre-indexed
- **Human-in-loop across all write actions** — no auto-purchases, no auto-sends. Agents propose; Kaleem approves. 30-min undo window on all executor actions.
- **Agent "intelligence"** = reasoning sessions with long-term memory retrieval, not cron scripts with if/else

### Technical stack
- **Runtime: minicrew** (user's own repo, https://github.com/omdiidi/minicrew) — Linux port being handled by another instance; we treat as stable dependency
- **Compute**: Kaleem's existing Linux Mint Mac mini as primary worker (no new hardware purchase)
- **Database**: Supabase (Postgres + pgvector) — source of truth for queue, business data, and memory
- **Web/API**: Render for hosting
- **LLMs**: Claude API (Opus for deep reasoning, Sonnet/Haiku for routine)
- **Embeddings**: Voyage AI or OpenAI `text-embedding-3-small`
- **Frontend**: Next.js 14 App Router
- **Framework UI**: shadcn/ui (Radix + Tailwind)
- **Third-party data**: Keepa ($55/mo, necessary), EzriRx EDI (fees TBD), SP-API (free, our account), eBay Sell API (free), FDA APIs (free), Google Trends (free)

### Memory
- **Source of truth in Supabase** (4 memory types: episodic, procedural, semantic, preferences)
- **pgvector** for semantic search over memory
- **No local AI models** on the Mac mini (Intel 8GB too constrained)
- **Weekly pg_dump** to Mac mini local disk for disaster-recovery backup

### Monthly cost at steady state
~$310-610/mo (Claude API + Supabase + Render + Keepa + EzriRx fees + SMS). Covered by Kaleem's pharmacy revenue.

## Rejected Alternatives

| Rejected | Why |
|---|---|
| Direct ABC/McKesson/Cardinal API (alone) | No public REST APIs exist; EDI-only behind sales-rep conversations. EzriRx aggregates 30+ wholesalers in one integration. |
| Build custom Amazon scraper | ToS risk + Keepa already has the data for $55/mo. |
| Prophet / ARIMA / LSTM demand forecasting | Overkill for one pharmacist's data volume; seasonal-naive baselines beat ML on <2 years of per-SKU data. |
| Self-roll SP-API history | Would be blind for 30-90 days accumulating history; Keepa gives 1+ year instantly. |
| Dense dashboard UI (Tactical Arbitrage style) | Wrong for one-person pharmacy — too much noise. Agent briefing timeline is better. |
| 15-minute repricing polls | Cooks LLM credits for OTC's low volatility. Event-driven + 2 daily sweeps suffices. |
| Auto-purchase on order fulfillment | Kaleem explicitly refused. Human picks source, human clicks Buy. |
| Local Phi-4 / Qwen for triage | Mac mini too constrained (Intel 8GB). API calls are cheap enough. |
| Cloud Mac mini for failover | Secondary Mac (yours or Kaleem's) via minicrew multi-machine is cheaper + simpler. |
| Race-to-bottom repricer | Destroys OTC margin. Use Seller Snap game-theory pattern with hard floor + Fair Pricing ceiling. |
| Prescription-side integration (Pioneer/Rx) | Out of scope forever. Two-POS architecture: OTC isolated. |
| New Mac mini purchase | Kaleem has existing Linux mini (Intel 8GB). Use what he has. |

## Direction

Phase 1 MVP = **data platform + chat surface + agent definitions** — everything that can ship without waiting on external dependencies (minicrew Linux port, Amazon SP-API gating, EzriRx onboarding).

Sequence:
1. Supabase schema (queue + data + memory tables)
2. Next.js app skeleton + sidebar nav (PharmaDash branding carryover from demo)
3. Business chatbot (Claude API + tools over Supabase)
4. Inbox/Timeline UI (empty at first, fills as agents ship)
5. Minicrew `config.yaml` + skill prompts (files only — runtime comes online later)
6. Weekly pg_dump backup script for Mac mini cron
7. Docs for every component

Once minicrew Linux is ready: install on Kaleem's mini, point at our Supabase, agents start running against real data as sources wire up (Keepa subscription → EzriRx onboarding → SP-API gating → data flows in).
