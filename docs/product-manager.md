<!-- docs/product-manager.md — the 9-agent swarm spec: agents, scenarios, briefing modal, scoring, HITL invariant. -->

# Product Manager — the 9-agent swarm

## Why a swarm

Kaleem's manual workflow has eight distinct cognitive jobs (research what to list, price each listing, source each order, watch account health, handle each customer message, reconcile the books, plan strategy, learn from outcomes) plus a coordination job (turn all of that into one morning queue he can act on). One generalist agent prompted to do all nine ends up mediocre at every one. Splitting into specialists with different cadences, models, and skill prompts — coordinated by a Chief of Staff that owns the inbox — lets each one be sharp and lets us tune them independently.

## The 9 agents

| Agent | When it runs | What it does | Model (Phase 2) |
|---|---|---|---|
| **Chief of Staff** | Always-on (chatbot) | Front-end Kaleem chats with. Curates 8 specialists' output into one Inbox. Routes Kaleem's replies. | `claude-opus-4-7` |
| **Research Analyst** | Daily 6am + ad-hoc | Pulls overnight wholesaler/Keepa/FDA/Trends data, scores opportunities, hands Kaleem 5-10 listing picks with reasoning. | `claude-opus-4-7` (`thinking_budget: high`) |
| **Repricer** | 2x daily + Keepa events | Per live listing: match Buy Box / hold / raise / drop / pause. Within rules: autonomous. Outside rules: proposes for approval. | `claude-sonnet-4-6` |
| **Fulfillment Ops** | On Amazon/eBay order webhook | Queries every wholesaler in real-time, shows Kaleem cross-source comparison table (price, stock, ETA), Kaleem picks. | `claude-haiku-4-5` |
| **Account Health** | Daily 6am + events | Watches ODR, Late Ship, Cancellation, VTR, Buy Box %. Yellow → propose. Red → auto-pause + SMS. | `claude-haiku-4-5` |
| **Customer Success** (triage + draft) | On message webhook | Triages noise, drafts replies in Kaleem's style, escalates medical questions to him personally. | Triage `claude-haiku-4-5`, Draft `claude-sonnet-4-6` |
| **Bookkeeper** | Daily 11pm + payouts | Reconciles payouts, fees, refunds. Daily P&L. Anomaly flags. Report-only — never touches money. | `claude-haiku-4-5` |
| **Portfolio Manager** | Sunday 7am | Year-over-year strategic review. Proposes 3 strategic moves for the week that bind other agents. | `claude-opus-4-7` (`thinking_budget: high`) |
| **Reflector** | Sunday 11pm | Reads the week's decisions + outcomes, distills patterns into procedural playbooks + semantic memory. | `claude-opus-4-7` (`thinking_budget: high`) |

All 9 share **one memory** (`memory` table with `kind` enum). Every decision is logged with full reasoning trail in `audit_log` for replay and 30-min undo.

Per-agent specs live in [agents/](./agents/).

## 18 scenarios

Concrete examples of what each agent does, when, and what it produces. Bucketed by cadence.

### Morning routine (daily 6am cron)

1. **Research Analyst — daily picks fan-out.** 6am: Research Analyst fans out 8 jobs (one per `category_group`: allergy, immune_cold_flu, vitamin_d, magnesium_melatonin, multivitamin_weight, sunscreen_topical, childrens_prenatal, miscellaneous). Each pulls overnight signals, scores candidates, drops 1-2 picks each. Merge step ranks across categories. Kaleem opens the app at 7:30am and sees 5-10 briefings titled like "List Tinactin 1oz at $39.99 — FBA empty 3 days, scarcity premium 5.5x cost." Each has rationale, confidence, urgency, proposed action.

2. **Account Health — green/yellow/red sweep.** 6am: pulls last 24h of ODR / Late Ship / Cancellation / VTR / Buy Box %. Last night's late-shipment spike from 2% → 7% trips yellow. Briefing: "Late Ship rate jumped to 7% (yellow). Two listings contributing — both sourced from Parmed Tuesday. Recommend tightening ship-by buffer + SMS supplier rep." urgency=3.

3. **Bookkeeper — yesterday's P&L.** 11pm prior night ran (technically not morning, but it's what Kaleem reads first thing). Daily P&L: revenue $1,284.50, COGS $612.10, fees $218.44, net $453.96. One anomaly: order #4218 net was -$3.20 (negative margin). Briefing flags it for `review_listing`.

### In-flight (real-time, event-driven)

4. **Fulfillment Ops — order arrived.** Amazon webhook: ASIN B07XF9... ordered, ship-by Friday. Job fires within 30s. Queries ABC, Parmed, McKesson, Cardinal (via EzriRx). ABC: $4.85, ship today, 18-month shelf-life, TIC current → recommended. Parmed: $4.62 but only 8-month shelf-life → excluded. Briefing surfaces comparison table. Kaleem clicks ABC; executor performs the buy with deep-link.

5. **Customer Success — buyer message.** Customer message webhook: "Is this safe with my blood thinner?" Triage classifies as `medical_question`. Routes to Kaleem personally — does NOT enqueue Customer Draft. Briefing urgency=5, `proposed_actions: [{ kind: 'kaleem_reply_personally' }]`. Kaleem (the licensed pharmacist) replies in his own words.

6. **Customer Success — shipping question.** Customer message: "Where's my order?" Triage classifies `shipping`, enqueues Customer Draft. Draft pulls tracking number, last scan, ETA from `orders` and Kaleem's tone profile from `memory.kind='preferences'`. Produces: "Hey — your order shipped Monday via USPS, tracking 9400... should land Thursday. — Kaleem". Kaleem clicks Approve; executor sends.

7. **Repricer — Keepa Buy Box drop event.** Keepa webhook fires: BB on a Tinactin listing dropped from $39.99 → $24.99 (FBA seller restocked). Repricer evaluates. Within autopilot band? No — a 38% price cut is outside Kaleem's normal pattern. Proposes drop with explicit out-of-band rationale: "FBA-trusted seller (B0CXM...) matched at $24.99. Margin still 27% on our $7.20 cost. Recommend match." urgency=4, confidence=0.81. Kaleem approves; executor pushes the new price via SP-API.

8. **Account Health — red event auto-pause.** SP-API performance notification: ODR jumped to 2.4% (red). Account Health auto-pauses the two listings driving it (Phase 2 executor) AND raises urgent briefing: "ODR breached 2% — listings X and Y paused. Plan-of-Action draft attached." urgency=5, `metadata.notify_via='sms'`.

### Scheduled

9. **Repricer — twice-daily sweep.** Noon + 8pm: Repricer iterates through every active listing. Most stay at hold (BB unchanged, margin healthy). 3 propose adjustments — small ones within autopilot bands → auto-approved + audit-logged. 1 proposes a raise (offer count dropped 35%, FBA-out flag) → flagged for approval since it's a scarcity bump above 100% over cost.

10. **Portfolio Manager — Sunday 7am strategic review.** Pulls trailing 365 days of orders, current portfolio segments (top sellers / dead inventory / rising stars), last 30 days of agent activity. Identifies: vitamin_d category up 34% YoY, magnesium dead (78 days no sale on 4 SKUs), Repricer drop-proposals on supplements dismissed 6/7 times. Proposes 3 binding directives: (a) "Weight vitamin_d +30% in Research Analyst scoring next week", (b) "Pause magnesium dead listings", (c) "Repricer: hold supplements regardless of BB delta". Kaleem reviews Sunday/Monday; approval binds the agents.

11. **Reflector — Sunday 11pm distill.** Reads the week's `audit_log` and `briefings`. Patterns found: Repricer drop-proposals on supplements dismissed 6/7 times. Writes `procedural` memory: "When supplement BB drops within 5%, prefer hold over match. Kaleem dismissed 6/7 last week." Updates `preferences.supplement_repricing_bias = 'hold'`. Briefing summarizes patterns + memories written so Kaleem can spot-check.

12. **Bookkeeper — Amazon settlement payout.** Bi-weekly payout webhook fires. Bookkeeper pulls Amazon Settlement Report (Phase 2 SP-API), line-matches each fee/reimbursement to our `orders.platform_fees` field. 3 discrepancies found — 2 explained by FBA-removal credits (memory says these post 7-14 days late), 1 unexplained ($12.40 reimbursement with no order ID). Briefing flags the unexplained one.

### Reactive (event-driven, non-routine)

13. **Research Analyst — FDA shortage event.** FDA Drug Shortage feed updates: "amoxicillin 500mg suspension — current shortage". Research Analyst's reactive job (Phase 2) fires. Cross-references: do we have OTC adjacencies (children's pain relievers, fever reducers) where parents are buying around the Rx? Surfaces 2 candidate listings with elevated urgency.

14. **Research Analyst — FDA recall.** FDA Recall Enforcement Report adds an Eos lip balm SKU. Reactive Research Analyst job: do we have any active listings? Yes — two. Brings them to a `briefing_type='fda_recall_triggered'` with proposed action `{ kind: 'pause_listing' }` urgency=5. (And Account Health raises a corresponding flag.)

15. **Account Health — TIC certification gap.** Daily sweep: cross-checks active supplement listings against `tic_certifications`. Garden of Life multivitamin SKU — TIC expired 3 weeks ago. `briefing_type='tic_certification_gap'`, urgency=4. Proposes pause + email to brand for renewal.

16. **Portfolio Manager — manual pull.** Kaleem in chat: "What's my magnesium category looking like?" Chief of Staff calls `enqueue_job` with type `pharm:portfolio-manager` payload `{ category: 'magnesium', mode: 'on_demand' }`. Briefing returns within ~2 min with category-scoped review.

17. **Customer Success — refund threat.** Customer message: "If I don't get my refund I'm filing A-to-z." Triage classifies `refund`, urgency bumped to 4. Customer Draft pulls order, return-window policy, drafts a reply that issues the refund per policy. Kaleem reviews; approves; executor refunds and replies.

18. **Repricer — competitor disappears.** Sweep notices: ASIN's only other FBM seller went out of stock 3 days ago. Offer count 5 → 1 (just us). Proposes raise from $24.99 → $34.99 (still within Fair Pricing 30d-BB-median × 1.25 ceiling). Out of autopilot band so requires approval. urgency=3, confidence=0.74.

## Briefing modal — canonical inbox card structure

Every briefing produced by any agent fits this shape. The Inbox renders cards from this; the audit log replays from this.

```typescript
type Briefing = {
  id: string;
  pharmacy_id: string;
  source_agent:
    | 'research_analyst' | 'repricer' | 'fulfillment_ops'
    | 'account_health' | 'customer_success' | 'bookkeeper'
    | 'portfolio_manager' | 'reflector';
  source_job_id: string | null;          // minicrew job id (null when manually inserted)

  briefing_type:
    | 'hot_arbitrage' | 'new_opportunity' | 'restock' | 'seasonal'
    | 'reprice_up' | 'reprice_down' | 'suspend' | 'watchlist'
    | 'order_to_fulfill' | 'customer_message' | 'account_health' | 'strategic'
    | 'rx_shortage_adjacency' | 'fda_recall_triggered' | 'tic_certification_gap';

  title: string;                          // one line, headline
  summary: string;                        // 1-3 sentences in natural language
  rationale: string;                      // longer "why" explanation

  confidence: number;                     // 0-1, see § Confidence scoring
  urgency: number;                        // 1-5, see § Urgency scoring

  related_entity_type: string | null;     // e.g. 'product', 'listing', 'order'
  related_entity_id: string | null;

  proposed_actions: Array<{
    kind: string;                         // 'list', 'reprice', 'pause_listing', 'purchase_from', 'send_reply', 'binding_directive', ...
    [k: string]: unknown;                 // shape-per-kind
  }>;

  data_snapshot: Record<string, unknown>; // full data at briefing time for replay (50KB soft cap; overflow → Supabase Storage)
  reasoning_trail: {
    signals_consulted: string[];          // signal IDs / table refs
    memories_retrieved: string[];         // memory IDs
    policy_filters_applied: string[];     // which policy_rules rows fired
    notes?: string;
  };

  created_at: string;
};

type InboxItem = {
  id: string;
  pharmacy_id: string;
  briefing_id: string;                    // unique with pharmacy_id (no duplicates on agent retries)
  state: 'pending' | 'seen' | 'acted' | 'archived' | 'dismissed';
  seen_at: string | null;
  acted_at: string | null;
  action_taken: string | null;            // which proposed_actions.kind fired
  action_params: Record<string, unknown> | null;
  dismissed_reason: string | null;        // free text — feeds Reflector preference patterns
  created_at: string;
};
```

The Inbox UI renders, per card: `title`, `summary`, urgency pill, confidence bar, source-agent badge, then expandable rationale + reasoning trail + data snapshot. Action buttons map to `proposed_actions` entries. Dismiss has a free-text reason field; Reflector reads dismissals to learn patterns.

The undo window is on `audit_log` (not the briefing): when Kaleem clicks an action button, the executor writes an `audit_log` row with `undo_window_expires_at = now() + 30min`. A small "Undo" toast on the Inbox lets Kaleem reverse it within that window.

## Confidence scoring

Each agent computes its own confidence (0.0-1.0) before publishing a briefing. The general formula is:

```
confidence = w_signal × signal_strength
           + w_memory × memory_hit_rate
           + w_policy × policy_clarity
           + w_history × historical_calibration
```

Component definitions:

- **`signal_strength`** — how recent and consistent the inputs are. Keepa data from 4 hours ago > yesterday's snapshot. Multiple sources agreeing > one outlier. Empty signal feed pulls this to ~0.3 even if everything else is high.
- **`memory_hit_rate`** — fraction of memory queries that returned a relevant playbook. If `search_memory` returned empty, this drops to 0 (and the reasoning trail records "memory query empty, proceeding with defaults").
- **`policy_clarity`** — does the policy filter give a clean yes/no, or are we in a Tier 1 grey zone? Tier 0 violation = not published at all. Tier 1 grey = pulls confidence down by ~0.2.
- **`historical_calibration`** — Reflector's per-agent acted-rate vs expected (Phase 1.5+). If Repricer's drop-proposals are dismissed 60% of the time, future drop-proposals get a 0.6× confidence multiplier until calibration recovers.

Weights vary per agent (a Repricer drop on a familiar listing leans hard on memory; a Research Analyst pick on a new ASIN leans hard on signals). Each skill prompt encodes its own weighting in plain English.

**Phase 1 estimate, calibrate with real data.** Confidence calibration converges only after 4-8 weeks of acted/dismissed ground truth via the Reflector loop.

## Urgency scoring

1-5, integer. Explicit per-tier:

| Urgency | Meaning | Examples |
|---------|---------|----------|
| **1** | Informational, no time pressure | Weekly bookkeeping summary on a clean week. Reflector's "patterns found" report. |
| **2** | Should review this week | Customer Draft for a benign question. Bookkeeper anomaly summary. Watchlist add. |
| **3** | Today's queue | Yellow Account Health. Routine Repricer adjustment outside autopilot. Most Research Analyst picks. |
| **4** | High priority — review within hours | Refund threat. Out-of-band Repricer raise on scarcity event. TIC certification gap. Portfolio Manager Sunday brief (Sunday-prep cadence). |
| **5** | Drop everything | Active order to fulfill (ship-by deadline). Red Account Health. Medical-question customer message. FDA recall on active listing. |

Skills explicitly emit urgency in their result JSON; the Inbox sorts by `urgency desc, created_at desc`.

## Human-in-loop invariant

Kaleem keeps 100% of the decisions. Every executor write — listing change, price update, supplier purchase, customer reply, Plan-of-Action submission — requires an explicit Kaleem click. There is no auto-purchase, no auto-send, no auto-list path.

The 30-minute undo window applies to every action recorded in `audit_log`. Within 30 minutes, Kaleem can reverse: a listing pause is unpaused, a price change is reverted, a draft sent is recalled where the marketplace allows.

The narrow exception is **Account Health red auto-pause**: when ODR/Late-Ship/Cancellation crosses the red threshold, listings are auto-paused (this is a protective action, not a destructive one) AND the briefing fires AND an SMS escalates to Kaleem. He can unpause with one click; the 30-min undo applies. We auto-pause-but-never-auto-delete because Amazon penalizes deleted-then-recreated listings.

Agents propose. Kaleem decides. The system never forgets the trail.

## Memory ↔ briefing linkage

Every briefing's `reasoning_trail.memories_retrieved` references the memory rows it consulted. This closes the loop:

1. Kaleem acts (or dismisses with reason) on an Inbox item.
2. Reflector (Sunday 11pm) reads the week's `audit_log` and `briefings`.
3. Reflector identifies patterns (e.g., "supplement drop-proposals dismissed 6/7 times").
4. Reflector writes `procedural` or `semantic` memory rows codifying the pattern.
5. Next week, agents' `search_memory` calls return those rows; their reasoning trails reference them; their proposals shift to match Kaleem's preferences.
6. Confidence scores reflect the historical calibration baked in.

The system gets smarter weekly because every dismissal is a labeled training example.
