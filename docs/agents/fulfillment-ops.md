<!-- docs/agents/fulfillment-ops.md — fires on order webhook, builds wholesaler comparison table, Kaleem picks. -->

# Fulfillment Ops

Fires the moment an Amazon or eBay order webhook arrives. Queries every wholesaler in real-time, builds a cross-source comparison table, and presents Kaleem with the cheapest viable option that meets shelf-life and certification constraints. Does **not** auto-purchase — Kaleem clicks the supplier.

## When it runs

- **Reactive:** SP-API order webhook fires → enqueue `pharm:fulfillment-source` immediately. Briefing appears in Kaleem's Inbox within ~30 seconds with `urgency=5`.
- **Manual:** Re-run via `enqueue_job` if the first sourcing attempt's chosen supplier fails (out of stock, ETA slipped) and Kaleem needs an alternative.

## Inputs (job payload)

```typescript
{
  order_id: string;
  product_id: string;     // resolved from ASIN/UPC at ingest
  quantity: number;
  pharmacy_id: string;
  due_by: string;         // marketplace ship-by deadline (ISO)
}
```

## Process

1. **Pull order + product context.** `orders` row (sold_price, ship_to, marketplace). `products` row (UPC, category, supplement-flag).

2. **Query all wholesalers concurrently.** ABC, Parmed, McKesson, Cardinal — via the EzriRx aggregator (Phase 2 wiring). Phase 1 stub returns cached `wholesaler_stock_snapshots` rows. Per source: current unit price, available stock, ETA to ship, lot expiry / shelf-life remaining. Record what each source returned (or timeout) into the reasoning trail.

3. **Retrieve memory.**
   - `kind='semantic'` — wholesaler reliability notes (who blind-ships cleanly, who short-pads invoices).
   - `kind='episodic'` — past sourcing decisions for this product. Which supplier did Kaleem pick last time? Was there an exception?
   - `kind='preferences'` — preferred-supplier ordering, standing exclusions.
   - **If empty:** record in reasoning trail; proceed using only live wholesaler data.

4. **Apply policy filter.**
   - Confirm the product isn't on a newly-blocked list (FDA recall, DEA reschedule).
   - **Shelf-life:** Amazon requires ≥ 9-12 months remaining at receipt — exclude any candidate below this threshold.
   - **TIC certification (supplements):** cross-check `tic_certifications` (Dec 2025 Amazon supplement requirement). Mark candidates without current TIC as `tic_status='missing'` and recommend against them.

5. **Build comparison table.** Columns: `supplier`, `unit_price`, `stock`, `eta`, `shelf_life_months`, `tic_status`, `recommended_y_n`. Rank by `recommended_y_n` desc, then `unit_price` asc, then `eta` asc. Annotate the top recommendation with explicit reasoning.

6. **Compute expected margin** for each candidate. `margin_pct = (sold_price − unit_price − Amazon fees − shipping) / sold_price`. Surface this on the briefing.

7. **Insert briefing.** `type='order_to_fulfill'`, `source_agent='fulfillment_ops'`. `proposed_actions` = one entry per viable candidate: `{ kind: 'purchase_from', supplier, unit_price, eta, candidate_id }`. `urgency=5` (orders are time-critical). Confidence based on shelf-life + TIC + reliability. `data_snapshot` is the comparison table rows.

8. **Insert into `inbox_items`** with `state='pending'`, `urgency=5`.

Kaleem clicks the supplier; the executor performs the buy with a deep-link to the wholesaler portal. The Repricer does NOT auto-purchase.

## Outputs

```json
{
  "order_id": "uuid",
  "candidates": [
    {
      "supplier": "ABC",
      "unit_price": 4.85,
      "stock": 120,
      "eta": "2026-05-02",
      "shelf_life_months": 18,
      "tic_status": "current",
      "recommended_y_n": true
    }
  ],
  "recommended_supplier": "ABC",
  "briefing_id": "uuid",
  "memories_retrieved": []
}
```

## Dependencies

| Source                       | Phase | Role |
|------------------------------|-------|------|
| SP-API order webhook         | Phase 2 | Trigger |
| EzriRx aggregator            | Phase 2 | Live wholesaler stock + price |
| `wholesaler_stock_snapshots` | Phase 1 schema | Cached fallback when live query times out |
| `policy_rules`               | Phase 1 | Recall + shelf-life + TIC checks |
| `tic_certifications`         | Phase 1 | Supplement TIC compliance |
| `memory`                     | Phase 1 | Supplier reliability + Kaleem's preferences |
| Wholesaler portals (executor) | Phase 2 | Deep-link buy after Kaleem clicks |

## Skill prompt

Source: [`minicrew-config/skills/fulfillment-ops.md`](../../minicrew-config/skills/fulfillment-ops.md).

## See also

- [product-manager.md](../product-manager.md) — scenarios 4 (live order routing) and the HITL invariant.
- [integrations.md](../integrations.md) — EzriRx + SP-API config; static-IP question for SFTP.
