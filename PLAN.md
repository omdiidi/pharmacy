# PharmaDash — Master Plan

**Status:** Planning complete, Phase 1 MVP implementation pending
**Last updated:** 2026-04-19
**Owner:** Dev + Nick (one unit)
**Pharmacist partner:** Kaleem (2 Utah pharmacies, licensed on Amazon)

This is the single-entry-point plan for the project. For deep-dives, follow the links; for an overview, read this file top to bottom.

---

## TL;DR

We're building an AI-augmented platform that automates Kaleem's manual Amazon/eBay OTC arbitrage workflow. A swarm of specialized agents (coordinated by a Chief-of-Staff + Business Chatbot) reads wholesaler stock, Amazon market data, FDA shortages, and his own sales history; recommends what to list, at what price, and when; and surfaces a daily action queue Kaleem reviews and approves. Kaleem keeps 100% of decisions; the system does 100% of the busywork. The defensible edge is **stock-out arbitrage** — FBA-empty windows where FBM-only licensed pharmacies like his can win the Buy Box at scarcity premiums.

---

## The business context

### Who is Kaleem?
Licensed pharmacist, owns two pharmacies in Utah (St. Mark's + Redwood Road). Already sells ~30 OTC products on Amazon manually — fulfills orders by searching AmerisourceBergen (ABC) / Parmed / McKesson / Cardinal wholesaler portals one at a time, copy-pastes descriptions, uses Perplexity for market research. Makes real money (saw 5+ orders in one day during our research; Tinactin sold at $51 from $7 cost during a stock-out window).

### The opportunity
- Amazon's **FBA trust premium** means FBM dropshippers like Kaleem normally can't win the Buy Box at parity
- But when FBA stock is exhausted, the trust penalty disappears — and that's when FBM wins, at premium prices
- Kaleem's licensed-pharmacy status widens his playable catalog vs random arbitrage sellers
- Wholesalers (ABC, McKesson, Cardinal, Parmed, IPC) provide supply signals via EDI; EzriRx aggregates 30+ into one integration
- No existing tool combines all these signals with a pharmacist's judgment — there's an unfilled niche

### Business constraints
- **Amazon-first, eBay second, own-store third** (Amazon ships Phase 1; eBay follows; own-store is Phase 3+)
- **OTC only** — never touches prescription / Pioneer / Rx systems
- **FBM-only dropship** — no FBA stocking commitment
- **Existing ASINs only** — we piggyback on Amazon's product pages, don't create new listings
- **Human-in-loop on all writes** — no auto-purchases, no auto-sends, 30-min undo on every action
- **Two pharmacies as one tenant** for v1 (Kaleem's consolidated OTC business)

### Parallel tracks (different funding, different focus)
1. **Pharmacy OTC platform** (this project) — funded from pharmacy revenue once it works
2. **Marketing / TikTok store / AI video** — Thursday meeting topic, Phase 2
3. **Halal/kosher private-label vitamins** — Vitamin D + multivitamin, Utah supplier, Phase 2
4. **Drug research / compound isolation** — separate grant funding, separate stream

---

## Architecture at 30,000 feet

```
┌─────────────────────────────────────────────────────────────────┐
│                 SUPABASE (cloud — source of truth)               │
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
│ • Weekly: encrypted pg_dump → B2                                 │
│ • Monthly: restore-test from latest backup                       │
└──────────────────────────────────────────────────────┬──────────┘
                                                       │ encrypted dump
                                                       ▼
                                       ┌─────────────────────────────┐
                                       │ Backblaze B2 (separate      │
                                       │ cloud account, Object Lock  │
                                       │ + write-only API token)     │
                                       │ 12-week lifecycle retention │
                                       └─────────────────────────────┘
```

**What runs where:**
- **Render web service:** Next.js UI + Business Chatbot + auth + SP-API webhook handler + scheduled cron → enqueue jobs.
- **Render worker service:** minicrew worker, polling Supabase queue, invoking Claude Agent SDK for each job. Also handles SFTP/EDI polling (with Render Pro static egress IP if any wholesaler requires it).
- **Render Cron Jobs:** Weekly encrypted pg_dump → Backblaze B2; monthly restore-test.
- **Supabase:** Postgres + pgvector + auth. Source of truth for queue, business data, memory, audit log.
- **Backblaze B2 (separate cloud account):** off-cloud encrypted backup target with Object Lock + write-only API token. 12-week lifecycle retention.

**No on-prem dependency.** All system compute lives on Render. (Earlier architecture used Kaleem's Mac mini as primary worker; removed 2026-04-30 — see Key decisions log.)

**Agent runtime:** [minicrew](https://github.com/omdiidi/minicrew) — the Dev's own job-queue-on-Supabase pattern, currently being ported to Linux separately. When ready, we deploy as a Render worker service alongside the web service, point at our Supabase, and agents run.

---

## The agent swarm

Kaleem's chatbot and inbox are fronts for 9 specialized agents. All share a common memory (episodic, procedural, semantic, preferences). Chief of Staff curates their output into a single inbox.

| Agent | When it runs | What judgment it makes | Human-in-loop |
|---|---|---|---|
| **Chief of Staff** | Continuous (event) | Curate specialists' output into Inbox, rank by urgency, route Kaleem's replies | Owns all Kaleem-facing surfaces (Inbox + Chat). Nothing reaches him unfiltered. |
| **Research Analyst** | Daily 6am + ad-hoc | Produce top 5-10 listing opportunities with reasoning, recommended price, confidence. Uses Perplexity-style web research + Keepa + EDI + Kaleem's sales history + seasonal index + policy filter + memory | Briefings go to Inbox; each has List Now / Adjust / Skip / Why? / Snooze. Skip reasons train preferences. |
| **Repricer** | 2 daily sweeps + Keepa event | For every live listing: match BB / hold / raise / drop / pause. Actually publishes via SP-API + eBay | Within rules: autonomous, logs to Inbox. Outside rules: proposes → Kaleem approves. 30-min undo. |
| **Fulfillment Ops** | On SP-API order webhook | Shows Kaleem full cross-wholesaler comparison table (prices, stock, bulk, margins, ETA). Kaleem picks, system deep-links | Kaleem always picks source and clicks Purchase. System watches for order confirmation. |
| **Account Health** | Daily 6am + event | Watch ODR / Late Ship / Cancel / VTR / BB%; trigger protective actions | Yellow: proposes → approve. Red: auto-pauses new listings + SMS. Never auto-deletes. |
| **Customer Success** | On message webhook (triage first) | Draft reply, handle returns, escalate medical questions to Kaleem personally | Drafts queue for approval; never auto-sends. Medical → pharmacist only. |
| **Bookkeeper** | Daily 11pm + payout event | Reconcile payouts, fees, refunds. Daily P&L. Anomaly flags | Report-only. Never touches money. |
| **Portfolio Manager** | Weekly Sun 7am | Strategic review with full-year + multi-year context. Next week's guardrails | Weekly strategy brief → Kaleem decides → decisions bind other agents for the week |
| **Reflector** | Weekly Sun 11pm + Day-1 bulk ingest | Distill episodic memory → procedural playbooks + semantic facts. Recalibrate predictions | "Lessons Learned" digest; major shifts escalate |

**Detail:** `docs/agents/*.md` (one file per agent) — authored in Phase 1, runtime validates when minicrew lands.

---

## Data + memory

**Source of truth:** Supabase (Postgres + pgvector). Everything lives in one DB.

**Core business tables:**
- `pharmacies`, `user_pharmacy_access` (multi-tenant boundary)
- `products` (catalog, keyed by ASIN/UPC/NDC with partial unique indexes)
- `listings` (per platform per product, status + current price)
- `orders` (full P&L: revenue, supplier cost, shipping, fees, net profit)
- `wholesaler_stock_snapshots` (multi-source time series)
- `signals` (Keepa, FDA shortage, Google Trends, etc.)
- `health_metrics` (Amazon + eBay seller health)

**Memory (the thing that makes agents "intelligent not scripted"):**
- `memory` table with `kind` enum: `episodic | procedural | semantic | preferences`
- HNSW pgvector index on `embedding` (embeddings deferred to Phase 1.5; Phase 1 uses trigram text search)
- `source` column tracks who wrote each row
- `related_entity_*` for linking memories to products/listings/orders/brands

**Briefings + Inbox:**
- `briefings` — structured agent reports (title, summary, rationale, confidence, urgency, proposed_actions, data_snapshot, reasoning_trail)
- `inbox_items` — Kaleem-facing state (pending / seen / acted / archived / dismissed)
- `audit_log` — every executor action with full reasoning trail + 30-min undo window

**Policy filter (Tier 0/1/2 — applied before any scoring):**
- `policy_rules` — ingredient blocklist, category blocks, ROI floors, shelf-life minimums
- `brand_authorization` — per-brand safe / needs-LOA / hunts-resellers / transparency-enrolled
- `tic_certifications` — Dec 2025 Amazon supplement requirement tracking

**Detail:** `docs/architecture.md`

---

## Phase 1 MVP scope (what ships now)

The MVP is everything we can build without waiting on external dependencies. Agent runtime, SP-API gating, EzriRx onboarding all land later; Phase 1 is the platform that receives their output.

**Ships:**
1. **Complete Supabase schema** (all tables, all indexes, all triggers, all enums, all RPCs)
2. **Next.js 14 app** with sidebar nav matching PharmaDash aesthetic
3. **Three real pages:** Inbox (agent briefing timeline), Chat (Business Chatbot), Preview (single page with tiles for Phase 2 routes)
4. **Business Chatbot** — Claude Opus + 5 tools (query_products, query_orders, search_memory, get_recent_briefings, enqueue_job), real SSE streaming with abort signal, auth gate + allowlist + rate limit + daily budget guard + Sentry
5. **Auth flow** — Supabase magic-link, email allowlist, `user_pharmacy_access` bootstrap on first sign-in
6. **Minicrew config + 9 skill prompts** — authored as files, ready when runtime lands
7. **Weekly encrypted pg_dump backup to Backblaze B2** (separate cloud account, Object Lock + write-only API token) with sha256 log + monthly restore-test cron. Both as Render Cron Jobs.
8. **Health check endpoint** for Render zero-downtime deploys
9. **Observability** — Sentry + `claude_usage` tracking + daily spend cap

**Doesn't ship in Phase 1:**
- Running agents (minicrew Linux port is external)
- Real SP-API / eBay API integration (needs gating + wiring — Phase 2)
- EzriRx integration (needs Kaleem's onboarding — Phase 2)
- Keepa integration (needs subscription — Phase 2)
- The "intelligent briefing modal" (4-panel drill-down) — Phase 2 when real data arrives
- Opportunity feed as dense table — Phase 2
- Multi-wholesaler source-comparison UI (Fulfillment Ops handoff) — Phase 2
- Products / Orders / Inventory / Listings / Analytics / CRM real pages — Phase 2
- Voyage AI embeddings — Phase 1.5 (Phase 1 uses trigram text)
- Row Level Security policies — Phase 2 when staff accounts exist

**Detailed plan:** `tmp/ready-plans/2026-04-19-phase-1-mvp.md` (44 tasks, 3 reviewer passes, confidence 9/10 for one-pass implementation)

---

## Phase 2 and beyond

**Phase 1.5** (between Phase 1 ship and Phase 2 start)
- Voyage AI embeddings integration, backfill memory.embedding
- Refinements from Kaleem's real use of the chatbot
- Additional chatbot tools as new questions surface

**Phase 2** (when external dependencies land — minicrew Linux, SP-API gating, EzriRx, Keepa)
- Deploy minicrew worker as a Render worker service alongside the web service
- Activate Research Analyst, Repricer, Fulfillment Ops, Account Health — the 4 most user-facing agents
- SP-API integration — live listings, orders, pricing, health metrics
- EzriRx EDI integration — multi-wholesaler stock + price + ordering
- Keepa integration — historical BSR, offer count, Buy Box winner signals
- FDA Drug Shortage + Recall API integrations
- Google Trends for tracked ingredients
- **The intelligent briefing modal** (4-panel SAS pattern with "Why this score?" panel)
- **Dense opportunity feed** with BSR sparklines, risk pills, score badges
- Real Products / Orders / Inventory / Listings / Analytics / CRM pages
- Customer Success, Bookkeeper, Portfolio Manager, Reflector agents

**Phase 3**
- Own-store (e-commerce on Kaleem's website)
- Halal/kosher private-label vitamin launch
- TikTok store + AI video gen for marketing
- Multi-pharmacy split if useful
- Staff accounts + RLS policies

**Research track** (separate funding)
- Compound isolation (Laurendide ethanol, Strombolophilin 8)
- Derivative generation via AI docking
- Patent filings for non-cancer indications

---

## UI status (as of 2026-04-19)

**Decided:**
- Next.js 14 + Tailwind + shadcn/ui + lucide-react icons
- Visual language inherited from the Replit PharmaDash demo (blue accents, white cards on light gray, rounded corners)
- Left sidebar + main content layout
- Branding: PharmaDash (carryover)
- Three real surfaces in Phase 1: Inbox / Chat / Preview / Sign-in

**Open (not blocking Phase 1):**
- Exact design tokens / typography ramp
- Briefing card detailed design
- Chat surface: embedded in layout vs full-screen
- Mobile responsiveness depth
- Dark mode (probably skip)
- Loading / empty / error state treatments
- Onboarding copy / first-sign-in welcome flow

**Intentionally deferred to Phase 2:**
- The intelligent briefing modal design (depends on real data)
- Opportunity feed design (depends on agent output)
- Analytics dashboards
- Per-product detail pages
- Multi-wholesaler comparison table

**Approach:** Phase 1 ships with sensible shadcn defaults inheriting the Replit demo aesthetic. The big UI investment happens in Phase 2 when real data arrives and the briefing modal + opportunity feed matter. UI design deep-work is the last thing on the Phase 1 critical path.

---

## Integrations

| Integration | Status | Timeline | Detail |
|---|---|---|---|
| **Supabase** | Phase 1 | Immediate | Core data, queue, memory, auth |
| **Anthropic Claude API** | Phase 1 | Immediate | Chatbot + agent reasoning |
| **Render** | Phase 1 | Immediate | Web hosting |
| **minicrew** | Phase 1 config / Phase 2 runtime | Waiting on Linux port | Job queue runtime |
| **Keepa API** | Phase 2 | ~$55/mo when subscribed | Amazon historical data — FBA→FBM flip, BSR, offer count history |
| **Amazon SP-API** | Phase 2 | 1-4 week gating | Listings, orders, pricing, health metrics, notifications |
| **eBay Sell APIs** | Phase 2 | Sign-up | Cross-platform |
| **EzriRx EDI** | Phase 2 | Pharmacist onboarding | Multi-wholesaler aggregator (30+ wholesalers, one integration) |
| **ABC Direct EDI** | Phase 2 parallel track | Rep conversation + paperwork | Better margins than EzriRx for ABC catalog |
| **FDA Drug Shortage API** | Phase 2 | Free, no key | Rx shortage → OTC adjacency signals |
| **FDA Recall feed** | Phase 2 | Free | Auto-block recalled ASINs |
| **Google Trends API** | Phase 2 | Free | Demand acceleration signals |
| **Voyage AI embeddings** | Phase 1.5 | ~$0.50/mo at our volume | Semantic memory search |
| **Backblaze B2** | Phase 1 | ~$1–3/mo at our volume | Off-cloud encrypted backup target (Object Lock + write-only API token, separate cloud account from Supabase) |
| **Sentry** | Phase 1 | Free tier | Error observability |
| **Twilio SMS** | Phase 2 | ~$10-20/mo | Urgent briefing pushes |

**Detail:** `docs/integrations.md`

---

## Critical constraints (the things that shape decisions)

### Amazon-side
1. **Fair Pricing Policy ceiling** ~25% above trailing 30-day Buy Box median — our price recommender caps at this to avoid listing suppression
2. **FBA trust premium** — we lose Buy Box at parity to FBA. Target FBA-empty / FBM-dominant ASINs instead
3. **FBA→FBM Buy Box flip** = highest-signal leading indicator of stock-out arbitrage windows
4. **Dec 2025 supplement TIC mandate** — all supplements need NSF/Eurofins/UL Solutions Certificate of Analysis, renewed annually
5. **Blind-ship requirement** — wholesaler boxes must show Kaleem's pharmacy branding, not ABC/McKesson/etc. Kaleem has confirmed ABC blind-ships for him today.
6. **Wholesaler invoice scrutiny** — ABC/McKesson/Cardinal/Parmed are not on Amazon's pre-recognized wholesaler list; ungating invoices face extra review
7. **Brand authorization wedge** — Pfizer/J&J/Pharmavite/Pure Encapsulations/Garden of Life actively pursue unauthorized resellers even with valid invoices. Licensed-pharmacy status helps but isn't a full shield
8. **Expired-product complaints** are the #1 supplement suspension driver — minimum 9-month shelf life required at dispatch

### Federal / State
9. **Hard auto-exclude ingredients** — pseudoephedrine, ephedrine, phenylpropanolamine (DEA), kratom, CBD, lidocaine >4%/5%, DEA-scheduled, disease claims
10. **FDA disclaimer required** on supplement listings; structure-function claims only

### Operational
11. **No auto-purchases, no auto-sends** — Kaleem explicitly refused. System proposes; he clicks Buy
12. **30-minute undo window** on every executor action — mistakes are always recoverable
13. **Two-POS architecture** — Pioneer stays for Rx; this system is OTC-only. They never touch
14. **Pharmacist-license exception** widens playable universe vs random arbitrage sellers — some gated categories open up, brand-IP claims are taken more seriously

---

## Key decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-04-18 | Product Manager / Opportunity Feed replaces traditional Dashboard as home | Kaleem needs "what to do today" not "what happened yesterday" |
| 2026-04-18 | Agent swarm pattern with Chief of Staff coordination | Scaling to multiple specialist agents without overwhelming Kaleem |
| 2026-04-18 | List on existing ASINs only | Pictures + descriptions already there; faster to launch |
| 2026-04-18 | Inventory tab = wholesaler stock view (not pharmacy physical stock) | Core arbitrage signal lives in multi-wholesaler stock, not his shelf |
| 2026-04-18 | Memory on Supabase with weekly local backup | Source of truth cloud-side; backup for disaster recovery *(superseded 2026-04-30 — backup now to Backblaze B2 in separate cloud account; see row below)* |
| 2026-04-18 | No local AI models on Mac mini | Intel 8GB too constrained; API calls cheap enough *(rendered moot 2026-04-30 — Mac mini removed from architecture)* |
| 2026-04-18 | Use minicrew as agent runtime | Dev's own repo, purpose-built for this pattern |
| 2026-04-18 | Keepa subscription = yes | $55/mo for the FBA→FBM flip signal alone is worth it |
| 2026-04-18 | EzriRx as wholesaler aggregator | One integration = 30+ wholesalers; direct ABC EDI is parallel slower track |
| 2026-04-19 | Repricer = 2 daily sweeps + events (not 15-min polling) | Saves Claude credits; OTC is low-volatility |
| 2026-04-19 | Fulfillment Ops shows full source comparison, Kaleem picks | No auto-source-selection; he decides |
| 2026-04-19 | Voyage AI embeddings deferred to Phase 1.5 | No agents writing memory in Phase 1, trigram text search suffices |
| 2026-04-19 | Placeholder pages collapsed to one `/preview` route | Reduces scope without losing Phase 2 visibility |
| 2026-04-19 | npm (not pnpm) | Simpler, Render default, no benefit from pnpm here |
| 2026-04-19 | UI polish is last on Phase 1 critical path | Backend/data/agent work first; UI refined during/after build with real data to show |
| 2026-04-30 | **Cloud-only deployment; Mac mini removed from architecture** | Removes pharmacy-WiFi single point of failure; backup goes to Backblaze B2 (separate cloud account, Object Lock + write-only token) for stronger air-gap than on-prem mini. Render handles static egress IP if wholesaler reps confirm fixed-IP requirement. Supersedes 2026-04-18 "Memory on Supabase with weekly local backup" and "No local AI models on Mac mini" rows above — both rendered moot by removal of the mini. |
| 2026-04-30 | **Inference layer = Claude Agent SDK (TypeScript), not Claude Code CLI** | Same engine, library form. Native HITL hooks (PreToolUse, PermissionRequest) + OpenTelemetry + skill files load identically. Anthropic-recommended production path. See `tmp/research/2026-04-30-agent-runtime-recommendation.md` v3. |

---

## Documentation map

**Planning artifacts**
- `PLAN.md` — this file (master overview)
- `tmp/ready-plans/2026-04-19-phase-1-mvp.md` — concrete implementation plan (44 tasks, v4 after 3 reviewer passes)
- `tmp/briefs/2026-04-19-pharmacy-otc-platform.md` — discussion brief (decisions + rejected alternatives)
- `tmp/research/2026-04-18-product-manager-research.md` — research synthesis (60+ sources)

**Working docs**
- `docs/kaleem-todos.md` — running list of questions to ask + things for Kaleem to do
- `docs/emails/abc-order-data-exchange.md` — drafted email for Kaleem's ABC rep

**To be written during Phase 1 build** (as per the plan's T36-T41 tasks)
- `docs/architecture.md` — unified system design
- `docs/product-manager.md` — agent swarm full spec
- `docs/chatbot.md` — Business Chatbot spec
- `docs/integrations.md` — all external integrations consolidated
- `docs/agents/*.md` — 9 files, one per agent
- `docs/mvp-scope.md` — Phase 1 ship scope condensed
- `docs/open-questions.md` — running unresolved list
- `README.md` — project overview + local development quickstart

---

## Next steps

1. ~~**Set up this repo's GitHub remote**~~ **DONE** — origin points to `https://github.com/omdiidi/pharmacy.git`
2. **Kaleem's tomorrow meeting** — use `docs/kaleem-todos.md` as the conversation guide; get ABC email sent, confirm TIC status on his top supplement brands, confirm blind-ship policy across all his wholesalers, sign NDA so we can start sharing credentials
3. **Start Phase 1 implementation** — `/implement tmp/ready-plans/2026-04-19-phase-1-mvp.md` kicks off the 44-task build
4. **Sunday planning meeting** — lock payment structure, process cadence, working agreement
5. **When minicrew Linux port lands** — deploy as a Render worker service, point at our Supabase, first agent job can fire

---

## How to read this repo

- **Start here** (`PLAN.md`) for the big picture
- **`tmp/ready-plans/`** for the concrete implementation plan
- **`tmp/briefs/`** for decision context
- **`tmp/research/`** for the research that informed decisions
- **`docs/`** for working documents and agent/integration specs (filled in during Phase 1 build)
- **`minicrew-config/`** for agent skill prompts and job type definitions (filled in during Phase 1)
- **`supabase/`** for DB schema (filled in during Phase 1)
- **`app/`, `lib/`, `components/`** for Next.js app code (Phase 1)
