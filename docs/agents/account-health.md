<!-- docs/agents/account-health.md — watches Amazon performance metrics; yellow proposes, red auto-pauses + SMS. -->

# Account Health

Keeps Kaleem's Amazon seller account in good standing. Daily sweep at 6am plus reactive runs on health-event webhooks. Yellow → propose corrective actions. Red → auto-pause affected listings AND raise an urgent briefing AND flag for SMS escalation.

## When it runs

- **Scheduled:** Daily 06:00 (`pharm:account-health`).
- **Reactive:** On SP-API performance notifications (Phase 2 webhook).
- **Manual:** Via `enqueue_job` for ad-hoc checks ("we just had a customer complain — re-run health").

## Inputs (job payload)

```typescript
{
  pharmacy_id: string;
  trigger: 'scheduled' | 'health_event' | 'manual';
  event_payload?: Record<string, unknown>; // SP-API event when reactive
}
```

## Process

1. **Pull latest health metrics.** `health_metrics` rows for this pharmacy. Metrics: ODR (Order Defect Rate), late_ship_rate, cancellation_rate, vtr (Valid Tracking Rate), buybox_pct. Trailing 30-day trendline per metric.

2. **Apply Amazon thresholds.**

| Metric        | Green | Yellow | Red |
|---------------|------:|-------:|----:|
| ODR           | < 1%  | < 2%   | ≥ 2% |
| Late Ship     | < 4%  | < 10%  | ≥ 10% |
| Cancellation  | < 2.5%| < 5%   | ≥ 5% |
| VTR           | ≥ 95% | ≥ 90%  | < 90% |
| Buy Box %     | (directional only — drop ≥ 10pts week-over-week is yellow signal) |

Worst metric drives overall status. Any-red → red, else any-yellow → yellow, else green.

3. **Retrieve memory.**
   - `kind='procedural'` — playbooks per metric (e.g., "Late Ship spike → check wholesaler ETA estimates").
   - `kind='episodic'` — prior health incidents and what resolved them.
   - `kind='preferences'` — Kaleem's tolerance for auto-pause (default ON for red).
   - **If empty:** record; proceed with default Amazon-policy-aligned playbooks.

4. **Apply policy filter.** When red, identify which listings contributed (latest defects / late ships / cancels). Cross-check those listings against any active blocks before recommending pause vs other remedies.

5. **Decide actions by status.**
   - **Green** — log a no-op briefing only if trendline shows degradation; otherwise no briefing.
   - **Yellow** — propose corrective actions: tighten ship-by buffers, switch supplier on slow products, draft customer outreach to clear stale orders. `urgency=3`.
   - **Red** — propose `pause_listing` actions for the contributing listings; `urgency=5`; set `metadata.notify_via='sms'` so the executor escalates by SMS. Also propose any policy-mandated remediation (Plan-of-Action draft for Amazon).

6. **Insert briefing.** `type='account_health'`, `source_agent='account_health'`. Per the status branch above. Rationale cites the metrics, thresholds crossed, contributing listings, memories retrieved.

7. **Insert into `inbox_items`** with `state='pending'`.

8. **Audit log.** Write an `audit_log` entry recording the status determination + any pause proposals.

The agent does NOT call Amazon's API to pause listings directly (Phase 1 — schema only; Phase 2 — executor invoked when Kaleem clicks performs the pause with 30-min undo). Account Health proposes; the executor enacts. The narrow exception is **red status** where the executor is pre-authorized to auto-pause as a protective action — the SMS escalation lets Kaleem unpause within 30 minutes if it's a false alarm.

## Outputs

```json
{
  "status": "yellow",
  "metrics": {
    "odr": 0.012,
    "late_ship_rate": 0.06,
    "cancellation_rate": 0.018,
    "vtr": 0.93,
    "buybox_pct": 0.41
  },
  "actions_taken": [],
  "actions_proposed": [
    { "kind": "tighten_ship_buffer", "listing_id": "uuid" }
  ],
  "briefing_id": "uuid",
  "memories_retrieved": []
}
```

## Dependencies

| Source                  | Phase | Role |
|-------------------------|-------|------|
| `health_metrics`        | Phase 1 schema, Phase 2 data | ODR / Late Ship / VTR / etc. |
| SP-API performance feed | Phase 2 | Reactive trigger + metric pulls |
| `policy_rules`          | Phase 1 | Block-list cross-checks |
| `memory`                | Phase 1 | Playbooks + prior incidents |
| SP-API listing pause (executor) | Phase 2 | Performs the pause |
| SMS service             | Phase 2 | Escalation channel for red |

## Skill prompt

Source: [`minicrew-config/skills/account-health.md`](../../minicrew-config/skills/account-health.md).

## See also

- [product-manager.md](../product-manager.md) — scenarios 2, 8, 14, 15 cover health flows.
- [integrations.md](../integrations.md) — SP-API health webhooks.
