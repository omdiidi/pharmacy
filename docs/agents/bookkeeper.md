<!-- docs/agents/bookkeeper.md — daily P&L reconciliation, anomaly flagging; report-only, never touches money. -->

# Bookkeeper

Reconciles, produces a clean P&L, and flags anomalies. **Report-only — never touches money** and proposes no executor actions that move funds.

## When it runs

- **Scheduled:** Daily at 23:00 (`pharm:bookkeeper`) for the previous calendar day.
- **Reactive:** On Amazon settlement payout (Phase 2).
- **Manual:** Via `enqueue_job` for arbitrary date ranges ("reconcile last month").

## Inputs (job payload)

```typescript
{
  pharmacy_id: string;
  date_range: { start: string; end: string };  // default = previous calendar day
  trigger: 'scheduled' | 'payout' | 'manual';
  payout_id?: string;                           // Phase 2 SP-API settlement ref
}
```

## Process

1. **Pull orders in range.** `orders` rows where `sold_at` (or settlement date) falls in `date_range`. Per-row fields: `sold_price`, `supplier_cost`, `shipping_cost`, `platform_fees`, `net_profit`, `marketplace`, `status`. Aggregate by day for rolling P&L.

2. **Reconcile against settlement.**
   - **Phase 2:** pull Amazon Settlement Report via SP-API; line-match each order's fees + reimbursements to our `platform_fees` field. Record discrepancies (line-level) where settlement differs.
   - **Phase 1 placeholder:** assume `orders.platform_fees` is authoritative; flag `data_source='estimated'` in the reasoning trail.

3. **Compute daily P&L.**
   - `revenue` = sum of `sold_price`
   - `cogs` = sum of `supplier_cost`
   - `fees` = sum of `platform_fees` + `shipping_cost`
   - `net` = `revenue − cogs − fees` (cross-check against sum of `orders.net_profit`)

4. **Retrieve memory.**
   - `kind='procedural'` — bookkeeping playbooks (categorizing Amazon reimbursements, FBA-removal credits).
   - `kind='episodic'` — prior anomalies and their resolutions (was that fraud signal real or a benign settlement-timing artifact?).
   - `kind='semantic'` — known fee categories.
   - **If empty:** record; proceed with standard categorization rules.

5. **Apply policy filter.** Confirm no orders in the window reference Tier 0 blocked products (would indicate a listing-control failure). If found, raise a separate `account_health` briefing in addition to the P&L.

6. **Anomaly detection.**
   - Trailing 30-day mean + stddev of daily `net`. Flag any day outside ±2σ.
   - Per-row anomalies: orders where `net_profit` is negative but listing wasn't on a clearance/loss-leader flag.
   - Per-product anomalies: same product appearing across multiple negative-margin orders.

7. **Insert briefing** (only if anomalies found OR weekly summary day).
   - `type='strategic'`, `source_agent='bookkeeper'`.
   - `proposed_actions` = read-only suggestions: `{ kind: 'review_listing', listing_id }` or `{ kind: 'review_supplier_cost', product_id }`. **Never anything that moves money.**
   - `urgency=3` for anomaly summary, `urgency=2` for clean weekly summary.

8. **Insert into `inbox_items`** with `state='pending'` (skip if no anomalies and not weekly summary day).

9. **Audit log.** Always write an `audit_log` entry with the daily P&L hash, even on no-anomaly days, so weekly review can replay.

The Bookkeeper is read-only on the books. Never proposes `purchase_from`, `refund`, or any fund-moving action.

## Outputs

```json
{
  "date": "2026-04-29",
  "revenue": 1284.50,
  "cogs": 612.10,
  "fees": 218.44,
  "net": 453.96,
  "anomalies": [
    { "kind": "negative_margin_order", "order_id": "uuid", "net_profit": -3.20 }
  ],
  "discrepancies": [],
  "briefing_id": "uuid",
  "memories_retrieved": []
}
```

## Dependencies

| Source                  | Phase | Role |
|-------------------------|-------|------|
| `orders`                | Phase 1 | Per-order P&L |
| Amazon Settlement Report (SP-API) | Phase 2 | Settlement reconciliation |
| `policy_rules`          | Phase 1 | Tier 0 cross-check |
| `memory`                | Phase 1 | Categorization playbooks, prior anomaly resolutions |
| `audit_log`             | Phase 1 | Daily P&L hash trail |

## Phase 2 notes

The day-1 spike target for validating the Agent SDK + minicrew runtime is the Bookkeeper. It's the simplest agent — daily cron, single-pass reasoning, one DB write, no executor branch — so it's the cleanest first proof of the stack composing end-to-end.

## Skill prompt

Source: [`minicrew-config/skills/bookkeeper.md`](../../minicrew-config/skills/bookkeeper.md).

## See also

- [product-manager.md](../product-manager.md) — scenarios 3, 12 cover the daily P&L flow.
- [integrations.md](../integrations.md) — SP-API Settlement Report.
