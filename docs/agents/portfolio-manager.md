<!-- docs/agents/portfolio-manager.md — Sunday 7am strategic review; proposes 3 binding directives for the week. -->

# Portfolio Manager

Year-over-year strategic review every Sunday morning. Synthesizes what's working, what's dying, what's emerging — and proposes three strategic moves for the week that bind the other agents.

Runs on `claude-opus-4-7` with `thinking_budget: high`. Takes the time to reason carefully — its output shapes how the swarm behaves all week.

## When it runs

- **Scheduled:** Sunday 07:00 (`pharm:portfolio-manager`).
- **Manual:** Via `enqueue_job` for ad-hoc strategic pulls — "what's our magnesium category looking like?" can trigger a category-scoped review.

## Inputs (job payload)

```typescript
{
  pharmacy_id: string;
  week_of: string;            // ISO date for start of upcoming week
  trigger: 'scheduled' | 'manual';
  category?: string;          // optional, for ad-hoc category-scoped runs
}
```

## Process

1. **Pull last 365 days of orders.** Aggregate by product, by category, by month. Compute year-over-year growth per product (this-month vs same-month-last-year).

2. **Identify portfolio segments.**
   - **Top sellers** — top 10 by trailing-90-day net profit.
   - **Dead inventory** — products with 0 sales in last 60 days but active listings (inventory + listing fees still bleeding).
   - **Rising stars** — fastest YoY growth, even if absolute volume is small.
   - **Category trends** — which `category_group` is up vs down vs flat.

3. **Pull last 30 days of agent activity.** `briefings` joined with `inbox_items` for trailing 30 days. Per agent: how many briefings created, how many `acted_at` (Kaleem approved), how many dismissed. Surface patterns: is Repricer's drop-in-supplements proposals consistently dismissed? Is Research Analyst over-indexing on allergy?

4. **Retrieve memory.**
   - `kind='procedural'` — prior strategic playbooks.
   - `kind='semantic'` — known constraints ("Kaleem doesn't want to expand into pet meds").
   - `kind='preferences'` — capital-allocation guardrails, risk tolerance.
   - `kind='episodic'` — prior strategic moves and their outcomes.
   - **If empty:** record; proceed using only order-history + briefing-activity data.

5. **Apply policy filter.** When proposing strategic moves, confirm no proposed expansion crosses Tier 0 (e.g., "expand into pseudoephedrine analogs" is invalid). Cross-check brand-hunt proposals against `brand_authorization` LOA status and `tic_certifications` for supplements.

6. **Synthesize three strategic moves.** Each move is a binding directive for one or more agents in the coming week. Per move:
   - `move`: short imperative ("Pull back on dead-inventory listings in magnesium category").
   - `rationale`: 2-4 sentences with supporting data points.
   - `target_agent`: which specialist binds to this directive.
   - `expected_outcome`: what we'd see in next week's review if this works.
   - `success_metric`: how we'll know.

   Prefer moves that compound — "Research Analyst weights vitamin_d category +30% next week" (binds Research Analyst's scoring) is stronger than a one-shot directive.

7. **Insert briefing.** `type='strategic'`, `source_agent='portfolio_manager'`. `proposed_actions` = three strategic moves, each as `{ kind: 'binding_directive', target_agent, move, rationale, success_metric }`. `urgency=4` (Sunday-prep cadence). Confidence 0-1 based on data sufficiency + memory agreement. `data_snapshot` = top sellers, dead inventory, agent activity summary.

8. **Insert into `inbox_items`** with `state='pending'`.

Kaleem reviews Sunday/Monday. Approval binds the targeted agents next week (Reflector reads the audit log to confirm directives are being honored). The Portfolio Manager does NOT execute the moves itself.

## Outputs

```json
{
  "week_of": "2026-05-04",
  "top_sellers": [
    { "product_id": "uuid", "ttm_net": 4218.10, "yoy_growth": 0.34 }
  ],
  "dead_inventory": [
    { "product_id": "uuid", "days_since_sale": 78, "carrying_cost_estimate": 12.40 }
  ],
  "strategic_moves": [
    {
      "move": "Weight vitamin_d category +30% in Research Analyst scoring",
      "rationale": "...",
      "target_agent": "research_analyst",
      "success_metric": "≥3 vitamin_d picks acted on in week"
    }
  ],
  "briefing_id": "uuid",
  "memories_retrieved": []
}
```

## Dependencies

| Source                  | Phase | Role |
|-------------------------|-------|------|
| `orders`                | Phase 1 | 365-day history |
| `briefings` + `inbox_items` | Phase 1 | Per-agent acted-rate analysis |
| `policy_rules`, `brand_authorization`, `tic_certifications` | Phase 1 | Strategic-move feasibility |
| `memory`                | Phase 1 | Constraints, preferences, prior strategy |
| WebSearch (Agent SDK)   | Phase 2 | Category-trend cross-checks |

## Skill prompt

Source: [`minicrew-config/skills/portfolio-manager.md`](../../minicrew-config/skills/portfolio-manager.md).

## See also

- [product-manager.md](../product-manager.md) — scenarios 10, 16 cover the strategic-review flow.
- [agents/reflector.md](./reflector.md) — closes the loop on whether directives produced their expected outcomes.
