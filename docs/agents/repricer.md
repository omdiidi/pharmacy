<!-- docs/agents/repricer.md — keeps live listings at the right price; match BB / hold / raise / drop / pause. -->

# Repricer

Keeps each live listing at the right price. Per listing decides: match Buy Box / hold / raise / drop / pause based on live Amazon signals, Kaleem's pricing rules, and current supplier cost.

## When it runs

- **Scheduled sweep:** Twice daily (`pharm:repricer-sweep`) — typically noon and 8pm — across all active listings for the pharmacy.
- **Reactive:** On Keepa BB-change webhook for any tracked ASIN (Phase 2). Single-listing mode.
- **Manual:** Via `enqueue_job` when Kaleem asks "look at the Tinactin listing's price."

Within Kaleem's autopilot bands, the Repricer's proposals can flow through quickly (still HITL — Kaleem clicks). Outside the bands, it flags with explicit out-of-band rationale and bumps urgency by 1.

## Inputs (job payload)

```typescript
{
  listing_id?: string;     // single-listing mode
  pharmacy_id?: string;    // sweep mode (evaluate all active listings)
  trigger: 'scheduled' | 'keepa_event' | 'manual';
  previous_decision_id?: string; // most recent reprice briefing for this listing, for continuity
}
```

## Process

1. **Pull current listing state.** `listings` row: current price, source supplier, last known supplier cost, platform, status. Linked `products` row: ASIN/UPC, category.

2. **Pull live signals.** Latest Buy Box from `signals` (Keepa). Offer count, FBA presence, Amazon-as-seller flag, BSR. Most recent `wholesaler_stock_snapshots` for this product across all sources.

3. **Retrieve memory.**
   - `kind='preferences'` — `min_margin_floor_pct`, `max_scarcity_premium_pct`, autopilot bands.
   - `kind='procedural'` — repricing playbooks for this category (Reflector writes these).
   - `kind='episodic'` — prior repricing decisions on this listing. Did Kaleem's last approval go up or down? Did he dismiss similar moves?
   - **If empty:** record in reasoning trail; fall back to conservative defaults (floor 15%, ceiling 25% over BB median).

4. **Apply policy filter.** Confirm product isn't newly recalled or blocked since the listing went live. Cross-check Fair Pricing ceiling (30d BB median × 1.25) — never propose above ceiling.

5. **Decision matrix.**

| Decision    | Trigger |
|-------------|---------|
| **Match BB**| Our cost supports matching and BB winner is FBA-trusted |
| **Hold**    | Already winning the box at acceptable margin |
| **Raise**   | Scarcity event detected (FBA empty, offer count drop ≥ 30%, BB jumped) — propose up to scarcity-premium ceiling |
| **Drop**    | BB undercut us and margin still allows; OR sell-through too slow vs trailing 30d |
| **Pause**   | Margin would go below `min_margin_floor_pct`; OR product entered Tier 0 block list |

6. **Compute new price + expected margin.** `new_price` candidate; expected `sold_price` after Amazon fees + shipping. `margin_pct = (sold_price − supplier_cost − fees − shipping) / sold_price`. Confidence 0-1 based on signal recency + memory agreement.

7. **Insert briefing.** `type ∈ { 'reprice_up', 'reprice_down', 'suspend' }`. `proposed_actions = [{ kind: 'reprice', listing_id, from_price, to_price, platform }]` (or `{ kind: 'pause_listing', listing_id }` for suspend). Rationale cites signals consulted, memories retrieved, policy filters applied, decision-matrix branch taken. `data_snapshot` with the BB / offer-count / supplier-cost rows.

8. **Insert into `inbox_items`** with `state='pending'`.

The Repricer does NOT push the price. It proposes. Kaleem clicks every executor write; 30-min undo applies.

## Outputs

```json
{
  "listing_id": "uuid",
  "decision": "match_bb",
  "current_price": 19.99,
  "proposed_price": 18.49,
  "margin_pct": 0.32,
  "confidence": 0.78,
  "rationale": "BB held by FBA-trusted seller at 18.49; our cost 11.20 supports match at 32% margin; within autopilot band.",
  "briefing_id": "uuid",
  "signals_used": [],
  "memories_retrieved": []
}
```

## Dependencies

| Source              | Phase | Role |
|---------------------|-------|------|
| `signals` (Keepa)   | Phase 2 | BB, offer count, FBA flag |
| `wholesaler_stock_snapshots` | Phase 2 | Current supplier cost |
| `listings`          | Phase 1 | Current state |
| `products`          | Phase 1 | ASIN, category |
| `policy_rules`      | Phase 1 | Fair Pricing ceiling, recall block |
| `memory`            | Phase 1 | Preferences, playbooks, prior decisions |
| Amazon SP-API (executor) | Phase 2 | Pushes the price after Kaleem approves |

## Skill prompt

Source: [`minicrew-config/skills/repricer.md`](../../minicrew-config/skills/repricer.md).

## See also

- [product-manager.md](../product-manager.md) — confidence and urgency scoring; HITL invariant.
- [integrations.md](../integrations.md) — Keepa + SP-API config.
