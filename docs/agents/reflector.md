<!-- docs/agents/reflector.md — Sunday 11pm; reads the week, distills patterns into procedural + semantic memory. -->

# Reflector

Reads the week's decisions and outcomes; distills patterns into procedural playbooks and semantic facts. Writes to the `memory` table — every other agent reads what Reflector writes.

Runs on `claude-opus-4-7` with `thinking_budget: high`. Its output shapes how the swarm behaves next week.

## When it runs

- **Scheduled:** Sunday 23:00 (`pharm:reflector`) — after Portfolio Manager but before the new week starts.
- **Day-1 bulk ingest:** When Phase 2 first lights up, a one-shot Reflector pass reads any historical data Kaleem brings (manual exports, etc.) and seeds initial memory.
- **Manual:** Via `enqueue_job` for one-off reflection ("re-reflect on this past week — I noticed something").

## Inputs (job payload)

```typescript
{
  pharmacy_id: string;
  week_of: string;          // ISO date for start of just-finished week
  trigger: 'scheduled' | 'manual';
}
```

## Process

1. **Pull the week's audit log.** `audit_log` for trailing 7 days. Group by agent, by action_kind, by outcome (success / failure / undone).

2. **Pull the week's briefings + inbox state.** `briefings` joined with `inbox_items` for trailing 7 days. Per briefing: did `inbox_items.state` end as `acted` or `dismissed`? When `acted`, what was the post-action result (sale? margin? customer reply?)? Compute per-agent acted-rate, per-type acted-rate, per-confidence-band acted-rate.

3. **Detect patterns.**
   - **Dismissal patterns:** an agent's proposals consistently dismissed within a slice (category, supplier, price range, message classification).
   - **Approval patterns:** a slice where proposals are nearly always approved — codify the rule.
   - **Outcome patterns:** actions that look correct at briefing time but consistently underperform afterward.
   - **Calibration drift:** confidence scores that don't match acted-rate (over- or under-confident).

   For each pattern, articulate the rule in plain English and identify whether it should land as `procedural` (a how-to playbook update) or `semantic` (a fact about this pharmacy's preferences).

4. **Apply policy filter.** Never write a memory that contradicts Tier 0 (e.g., never write a procedural rule that re-includes a blocked product). When a pattern brushes a Tier 1 flag, write a semantic memory tagging the boundary rather than encoding behavior that crosses it.

5. **Update Kaleem's preferences memory** if a clear preference emerged. The preferences row (`kind='preferences'`) is shared by all agents. Only update fields where the week's evidence is strong (e.g., consistent dismissal of price-drop proposals on supplements ≥ 5 times → set `preferences.supplement_repricing_bias = 'hold'`). Append a `last_reasoned_at` timestamp + the evidence.

6. **Write memories.** Each pattern → one row in `memory`:
   - `kind` = `procedural` (playbook updates) or `semantic` (facts).
   - `source = 'reflector'`.
   - `pharmacy_id` = the input.
   - `content` = plain-English rule + supporting data.
   - `importance` 0-1 based on frequency × actionability (rare-but-decisive can rate high).
   - `related_entity_type` / `related_entity_id` when the pattern is about a specific product, supplier, or category.

   Phase 1 stores text only. Phase 1.5 backfills `embedding` via Voyage `voyage-3`.

   **If memory query for prior reflections returns empty:** record in reasoning trail; proceed — this is the first reflection.

7. **Output a "weekly reflection" briefing.** `type='strategic'`, `source_agent='reflector'`. Summarize: patterns found, memories written, preferences updated, suggested follow-ups for next week. `proposed_actions` = optional `{ kind: 'review_memory', memory_ids }` for Kaleem to spot-check the most consequential writes. `urgency=2` (informational; Portfolio Manager Sunday-7am will incorporate).

8. **Insert into `inbox_items`** with `state='pending'`.

Reflector DOES write to memory — that's the point — but does NOT execute any business action. Kaleem can still reject specific memory writes via the `review_memory` proposed action.

## Outputs

```json
{
  "week_of": "2026-04-27",
  "patterns_found": [
    {
      "pattern": "Repricer drop-proposals on supplements dismissed 6/7 times",
      "kind": "procedural",
      "memory_id": "uuid"
    }
  ],
  "memories_written": ["uuid", "uuid"],
  "preferences_updated": {
    "supplement_repricing_bias": "hold"
  },
  "briefing_id": "uuid"
}
```

## Why Reflector matters

Reflector is what makes the system get smarter weekly. Every dismissal Kaleem makes — with its dismissal reason — is a labeled training example. Every approved-then-failed action is a calibration miss. Reflector reads the gap between what the agents proposed and what actually happened, codifies the lesson into shared memory, and the swarm's behavior shifts the next week.

Without Reflector, the agents are static instruction-followers. With Reflector, they're a closed loop.

## Dependencies

| Source                  | Phase | Role |
|-------------------------|-------|------|
| `audit_log`             | Phase 1 | Per-agent action trail with outcomes |
| `briefings` + `inbox_items` | Phase 1 | Acted/dismissed/reason for each briefing |
| `memory` (write)        | Phase 1 | Output target |
| `policy_rules`          | Phase 1 | Boundary check on proposed memory writes |
| Voyage embeddings       | Phase 1.5 | Backfill `memory.embedding` for vector search |

## Skill prompt

Source: [`minicrew-config/skills/reflector.md`](../../minicrew-config/skills/reflector.md).

## See also

- [product-manager.md](../product-manager.md) — § Memory ↔ briefing linkage.
- [architecture.md](../architecture.md) — § Memory model (kinds, embeddings, retrieval).
- [agents/portfolio-manager.md](./portfolio-manager.md) — Sunday-morning cousin that consumes Reflector's writes.
