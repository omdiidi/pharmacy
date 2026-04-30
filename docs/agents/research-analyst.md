<!-- docs/agents/research-analyst.md — daily 6am picks producer; fan-out across category groups; opportunity scoring. -->

# Research Analyst

Produces the morning briefing: which products should Kaleem list today, at what price, with what confidence, and why.

## When it runs

- **Scheduled:** Daily at 06:00 (`pharm:research-analyst` enqueued by cron).
- **Ad-hoc:** Via `enqueue_job` from the chatbot when Kaleem asks "do a fresh research pass on \<category\>" or "what's hot in vitamin D today."

Both modes fan out into 8 parallel sub-jobs (one per `category_group`), then a merge job ranks across categories.

## Inputs (job payload)

```typescript
{
  category_group:
    | 'allergy'
    | 'immune_cold_flu'
    | 'vitamin_d'
    | 'magnesium_melatonin'
    | 'multivitamin_weight'
    | 'sunscreen_topical'
    | 'childrens_prenatal'
    | 'miscellaneous';
  date: string;                      // ISO date
  previous_analysis_ids: string[];   // briefing UUIDs from last 7 days, for continuity
  pharmacy_id: string;
}
```

The merge job receives the array of sub-job results and produces the final ranked briefing list.

## Process

1. **Gather current signals.**
   - `signals` table: latest Keepa, FDA shortage, Google Trends rows in this category.
   - `wholesaler_stock_snapshots`: supply state across ABC / Parmed / McKesson / Cardinal (via EzriRx).
   - `orders`: Kaleem's own sales history in this category, 30/90/365-day rolling windows.

2. **Retrieve relevant memory.**
   - `search_memory` query "arbitrage signals in {category_group}" with `kind='procedural'` (playbooks).
   - `kind='semantic'` (brand-hunt list, wholesaler reliability notes).
   - `kind='preferences'` (risk tolerance, scarcity-premium ceiling).
   - **If memory query returns empty:** record explicitly in reasoning trail and proceed with signal-only scoring.

3. **Apply policy filter (Tier 0 from `policy_rules`).**
   - **Block:** pseudoephedrine, ephedrine, kratom, CBD, lidocaine > 4-5%, DEA-scheduled, Transparency w/o codes, FDA-recalled.
   - **Flag (Tier 1):** TIC-missing supplements (cross-check `tic_certifications`), brand-hunt list (cross-check `brand_authorization` for LOA).

4. **Score candidates.**
   - **FBM-competitive score** — FBA empty or FBM dominant (FBM-only marketplaces win the box).
   - **Scarcity score** — offer count drop ≥ 30%, FBA → FBM flip, Amazon-out flag.
   - **Margin** — after Amazon fees + shipping + COGS from cheapest wholesaler.
   - **Fair Pricing ceiling** — never propose above `30d Buy Box median × 1.25`.
   - **Combined opportunity score 0-100.**

5. **LLM web search (Perplexity-style).** "Best-selling OTC \<category\> April" type queries. Cross-reference against our data. Surface candidates not in our signal feeds.

6. **Rank top 5-10 candidates.** Score × urgency × confidence; filter blocked / watched-pause.

7. **Per pick, produce a briefing.**
   - Title (one line).
   - Summary (2-3 sentences — the "why now").
   - Rationale (full reasoning trail).
   - Confidence 0-1.
   - Urgency 1-5.
   - Proposed action: `{ kind: 'list', product_id, price, platform: 'amazon' }`.
   - `data_snapshot` with the signal rows used (50KB soft cap).

8. **Insert into `briefings`** with `source_agent='research_analyst'`, then `inbox_items` with `state='pending'`.

The agent does NOT execute. It proposes. Kaleem clicks every executor write.

## Outputs

```json
{
  "category_group": "allergy",
  "briefings_created": ["uuid", "uuid"],
  "picks_summary": [
    { "title": "List Tinactin 1oz at $39.99", "urgency": 4, "confidence": 0.82 }
  ],
  "signals_used": [],
  "memories_retrieved": [],
  "runtime_seconds": 42
}
```

Each entry in `briefings_created` is the canonical Briefing shape — see [product-manager.md](../product-manager.md#briefing-modal--canonical-inbox-card-structure).

## Dependencies

| Source             | Phase | What it provides |
|--------------------|-------|------------------|
| `signals` table    | Phase 1 schema, Phase 2 data | Keepa BB / offer count / BSR / FBA flag rows |
| `wholesaler_stock_snapshots` | Phase 1 schema, Phase 2 data | Supply state, prices, expirations |
| Keepa API          | Phase 2 | Buy Box history, offer count, BSR |
| openFDA Drug Shortage | Phase 2 | Rx shortage adjacencies (Tier 1 flag, surfaces opportunities) |
| openFDA Recall Enforcement | Phase 2 | Tier 0 auto-block on active recalls |
| Google Trends      | Phase 2 | Demand-rise signals |
| `policy_rules`     | Phase 1 | Tier 0/1/2 auto-exclude rules |
| `tic_certifications` | Phase 1 | Amazon Dec 2025 supplement requirement |
| `brand_authorization` | Phase 1 | IP/LOA reseller-risk classification |
| WebSearch (Agent SDK tool) | Phase 2 | Perplexity-style category research |

## Skill prompt

Source: [`minicrew-config/skills/research-analyst.md`](../../minicrew-config/skills/research-analyst.md). Marked first-draft; expect rewrite when the runtime lands and IO contract dry-runs validate.

## See also

- [product-manager.md](../product-manager.md) — full swarm context including scoring methodology and 18 scenarios.
- [integrations.md](../integrations.md) — Keepa, FDA, EzriRx config.
- `tmp/research/2026-04-18-product-manager-research.md` — opportunity scoring research synthesis (60+ source review).
