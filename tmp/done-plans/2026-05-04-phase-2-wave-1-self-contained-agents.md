# Plan: Phase 2 Wave 1 — Self-Contained Agents (Bookkeeper, Reflector, Portfolio Manager)

> Reconciled from intent brief + research dossier.
> Implementation target: three new cron-driven agents that read our own Supabase tables, three new executors registered in the unchanged kernel, memory-write plumbing, inbox grouping by agent, plus seven cross-cutting cleanups. Zero external API dependencies.

---

## Summary

Wire **three pre-authored skill prompts** (Bookkeeper, Reflector, Portfolio Manager) into the proven Listing-agent kernel pattern. Each agent runs as a **Render cron service**, reads our own Supabase tables (`orders`, `claude_usage`, `health_metrics`, `briefings`, `audit_log`, `memory`), and writes briefings (and for Reflector + Portfolio Manager, memory rows). Bookkeeper and Reflector are **report-only** (proposed_actions = []), Portfolio Manager **proposes 3 strategic moves** as concrete executor actions: `add_to_watchlist`, `pause_brand`, `flag_anomaly`.

The plan introduces:
- 3 new agent runtimes (`lib/agents/{bookkeeper,reflector,portfolio-manager}.ts`) and 3 cron entries (`scripts/{bookkeeper,reflector,portfolio-manager}.ts`).
- 3 new executors (`lib/executors/{add-to-watchlist,pause-brand,flag-anomaly}.ts`) plus registry update.
- 1 shared helper module (`lib/agents/_shared.ts`) extracting fence-strip + skill-prompt loader from the existing listing-agent.
- 1 memory-write helper (`lib/memory/write.ts`).
- 2 migration files (split per Postgres ALTER TYPE constraint) — add `paused` to `brand_auth_status`, two columns on `brand_authorization`, an agent index on `briefings`.
- Inbox UI re-grouped by `source_agent` then by day inside.
- 4 missing env vars added to `.env.example`.
- Commit untracked `docs/render-deploy-runbook.md`.
- Move shipped Layer-1+2 plan to `tmp/done-plans/`.

Scope: ~12 new code files, ~3 modified, 1 new migration, 1 modified `render.yaml`, 1 modified `package.json`. Net code addition ~700–950 LOC. **Confidence for one-pass implementation: 8.5/10.**

---

## Intent / Why

Phase 2 Layers 1+2 (kernel + Listing agent) is live. Wave 1 of the rest of Phase 2 is the agents that **need zero external data sources** — they read what we already store. This proves the agent-writing-to-memory loop and exercises three new executors before Wave 2 introduces SP-API-shaped mock fixtures (Repricer / Account Health / Customer Success).

**Must not be optimized away:**
- Human-in-loop on every executor write (Kaleem clicks every approve/reject/undo).
- 30-minute undo on every action.
- No external API in Wave 1 (no SP-API, no FDA, no Keepa, no EzriRx, no Voyage).
- OTC-only — two-POS isolation invariant.
- Skill prompts are pre-authored — wire them, don't rewrite.

---

## Source Artifacts
- **Intent / why:** `tmp/plan-artifacts/2026-05-04-phase-2-wave-1-self-contained-agents-brief.md`
- **Research dossier:** `tmp/plan-artifacts/2026-05-04-phase-2-wave-1-self-contained-agents-research-dossier.md`
- **Discussion brief (upstream):** `tmp/briefs/2026-05-04-phase-2-waves-1-2-3-roadmap.md` (Wave 1 section)
- **Original Phase 2 brief (locked decisions):** `tmp/briefs/2026-05-01-phase-2-listing-automation.md`
- **Predecessor plan (mirror its shape):** `tmp/done-plans/2026-05-01-phase-2-layer-1-2-kernel-listing-agent.md` (move from ready-plans as Task 1)

---

## Verified Repo Truths

Each item is `Fact / Evidence / Implication`. Negative claims include `Search Evidence`.

### Kernel surface (carried from Layers 1+2)

- **Fact:** Executor registry is a literal `Record<string, Executor>` at `lib/executors/index.ts:7-10`. Adding an executor = one import + one map entry.
  **Evidence:** `lib/executors/index.ts:1-19`
  **Implication:** Three new executors slot in without abstraction churn.

- **Fact:** `app/api/actions/approve/route.ts` reads `briefing.proposed_actions[action_index].kind` and dispatches via `getExecutor(kind)`. **No route changes needed for new executors.**
  **Evidence:** `app/api/actions/approve/route.ts:64-100`
  **Implication:** Wave 1 adds executors only — kernel unchanged.

- **Fact:** `lib/supabase/admin.ts:8-19` exports `createAdminClient()` — service-role, no `next/headers`. Used by `scripts/listing-agent.ts:9`.
  **Evidence:** `lib/supabase/admin.ts:8`, `scripts/listing-agent.ts:9`
  **Implication:** Three new cron scripts use the same pattern.

- **Fact:** `lib/budget.ts` `recordLLMUsage(supabase, userId, completion)` and `getTodaySpendUsd(supabase, userId)` accept `userId: string | null`; `null` = system spend.
  **Evidence:** `lib/budget.ts:7-31`, `:33-66`
  **Implication:** All three Wave 1 agents use `null` user_id for system spend, identical to listing-agent.

- **Fact:** Sonnet 4.6 over OpenRouter wraps JSON in ```json fences even with `response_format: json_object`.
  **Evidence:** `lib/agents/listing-agent.ts:170-174`
  **Implication:** Defensive fence-strip is mandatory. Plan extracts to `lib/agents/_shared.ts`.

- **Fact:** OpenRouter extension `reasoning: { effort: 'medium' }` requires `as ChatCompletionCreateParamsNonStreaming` cast.
  **Evidence:** `lib/agents/listing-agent.ts:154`, `app/api/chat/route.ts:74` (per Layer 1+2 plan)
  **Implication:** Wave 1 agents reuse the cast pattern. Reflector uses `'high'` per skill; others `'medium'`.

### Schema reality

- **Fact:** `briefing_type` enum has `strategic` already.
  **Evidence:** `supabase/migrations/20260419000004_briefings_schema.sql:6-11`
  **Implication:** No enum migration. All three agents emit `briefing_type='strategic'` and discriminate via `data_snapshot.kind` (string).

- **Fact:** `briefings.source_agent text not null` — already populated; this is what we group by in the UI.
  **Evidence:** `supabase/migrations/20260419000004_briefings_schema.sql:18`
  **Implication:** No new `agent_name` column.

- **Fact:** `memory.kind` enum: `episodic | procedural | semantic | preferences`.
  **Evidence:** `supabase/migrations/20260419000003_memory_schema.sql:7`
  **Implication:** Reflector's writes match the enum directly.

- **Fact:** `brand_authorization.status` enum is `safe | needs_loa | hunts_resellers | transparency_enrolled | unknown` — no `paused` value.
  **Evidence:** `supabase/migrations/20260419000005_policy_schema.sql:22`
  **Implication:** Migration adds `paused`. No `paused_until` column today; migration adds one + a `prior_status` column for undo.

- **Fact:** `products.watchlist_status` already includes the value `watching`.
  **Evidence:** `supabase/migrations/20260419000002_core_schema.sql:35`
  **Implication:** `add_to_watchlist` executor is a pure UPDATE; no enum change.

- **Fact:** `orders` table is currently unpopulated in cloud DB (Phase 1 didn't seed orders).
  **Search Evidence:** No `orders` rows referenced in `scripts/seed-dev-data.ts`.
  **Implication:** Bookkeeper must handle empty-orders case. Skill prompt's `data_source='estimated'` branch covers this.

- **Fact:** `orders` table has column `platform text not null`, NOT `marketplace`.
  **Evidence:** `supabase/migrations/20260419000002_core_schema.sql:81-101`
  **Search Evidence:** `grep -rn 'marketplace' --include='*.ts' lib/ app/` returns zero matches.
  **Implication:** Bookkeeper select must use `platform`. Skill prompt's textual mention of "marketplace" is not rewritten — runtime maps the column name transparently (locked decision 13).

- **Fact:** `claude_usage` partial index `claude_usage_system_day_idx` exists on `(created_at desc) where user_id is null`.
  **Evidence:** `supabase/migrations/20260501000001_pending_listings_and_system_spend.sql:28`
  **Implication:** `getTodaySpendUsd(supabase, null)` is performant.

### Inbox UI

- **Fact:** `components/inbox/timeline.tsx:69-91` groups items by day-bucket only — no agent grouping.
  **Evidence:** `components/inbox/timeline.tsx:69-91`
  **Implication:** Plan adds outer agent grouping; preserves day-bucketing inside each agent section.

- **Fact:** `briefing-card.tsx:201-207` already has a "reject-only" branch for briefings with no `proposed_actions` — renders only a "Dismiss" button.
  **Evidence:** `components/inbox/briefing-card.tsx:201-207`
  **Implication:** Bookkeeper + Reflector empty-actions case works without UI changes; plan only relabels "Dismiss" to "Acknowledge" when source_agent is bookkeeper or reflector for clarity.

### Render / cron

- **Fact:** `render.yaml` has 3 cron services — listing-agent (`runtime: node`, `buildCommand: npm ci`, `npm run agent:listing`) plus two backup crons.
  **Evidence:** `render.yaml:36-69`
  **Implication:** Three more cron entries follow the listing-agent pattern exactly.

- **Fact:** `package.json:14` has `"agent:listing": "tsx scripts/listing-agent.ts"`. `tsx` is in dependencies (line 33), not devDependencies.
  **Evidence:** `package.json:14`, `:33`
  **Implication:** Three more `agent:*` scripts wire identically.

### Sentry

- **Fact:** `lib/logger.ts:36-46` — `initSentry()` early-returns when `SENTRY_DSN` empty. Auto-runs on import (`lib/logger.ts:48`).
  **Evidence:** `lib/logger.ts:36-48`
  **Implication:** No code change for Sentry. Plan documents in `.env.example` and verifies `SENTRY_DSN` is in `pharm1-shared` (it is — `render.yaml:110-111`).

### Skill prompts

- **Fact:** `minicrew-config/skills/{bookkeeper,reflector,portfolio-manager}.md` are authored; bookkeeper has Phase 1 placeholder branch (`Phase 1 placeholder: assume orders.platform_fees is authoritative`).
  **Evidence:** `minicrew-config/skills/bookkeeper.md:22-23`, `reflector.md`, `portfolio-manager.md`
  **Implication:** Wire as system prompt; runtime overrides decisions skill can't make alone (e.g. concrete executor kind for Portfolio Manager moves).

### Negative checks

- **Fact:** No file under `lib/memory/`, `lib/agents/{bookkeeper,reflector,portfolio-manager}.ts`, `lib/executors/{add-to-watchlist,pause-brand,flag-anomaly}.ts`, or `scripts/{bookkeeper,reflector,portfolio-manager}.ts` exists today.
  **Search Evidence:** `find lib/memory lib/agents/bookkeeper.ts lib/agents/reflector.ts lib/agents/portfolio-manager.ts lib/executors/add-to-watchlist.ts lib/executors/pause-brand.ts lib/executors/flag-anomaly.ts scripts/bookkeeper.ts 2>&1 | grep -v "No such"` — empty.
  **Implication:** All those paths are NEW.

- **Fact:** `briefings.briefing_type` no `daily_pnl`, `weekly_strategy`, `weekly_reflection`, `pattern_extracted` values.
  **Search Evidence:** `grep "create type briefing_type" -A 8 supabase/migrations/20260419000004_briefings_schema.sql` shows the enum.
  **Implication:** Plan does NOT add to the enum; uses `strategic` + `data_snapshot.kind` discriminator.

---

## Locked Decisions
1. **Three agents only.** Bookkeeper, Reflector, Portfolio Manager. No others in this wave.
2. **Skill prompts are pre-authored** — wire, don't rewrite.
3. **Bookkeeper + Reflector are report-only** (proposed_actions = []).
4. **Portfolio Manager proposes 3 moves** mixing `add_to_watchlist`, `pause_brand`, `flag_anomaly`. Output adapter handles unmappable moves by emitting them as informational-only items in `data_snapshot.unmapped_moves[]`.
5. **briefing_type stays `strategic`** for all three agents; discriminator is `data_snapshot.kind`.
6. **No new tables.** Daily P&L lives on the briefing's `data_snapshot`. Anomaly flags live as `memory` rows with `kind='semantic'` and `metadata.anomaly_type`.
7. **Migration adds:** `'paused'` to `brand_auth_status` enum, `paused_until` + `prior_status` columns on `brand_authorization`, agent index on `briefings`.
8. **Inbox grouping**: by `source_agent` first (most-recent-briefing-in-section descending), then by day inside.
9. **Reflector reasoning effort = 'high'** (skill says Opus thinking_budget high). Bookkeeper + Portfolio Manager = 'medium'.
10. **Render cron schedules:** Bookkeeper `0 23 * * *`, Portfolio Manager `0 7 * * 0`, Reflector `30 23 * * 0` (Sunday 23:30 UTC, 30 min after Bookkeeper). Reflector runs 30 min after Bookkeeper on Sunday so it doesn't race on writing system-spend `claude_usage` rows.
11. **System spend** via `user_id IS NULL`. Same `MAX_DAILY_CLAUDE_SPEND_USD` daily cap.
12. **Single tenant** — `pharmacy_id = 00000000-0000-0000-0000-000000000001`.
13. **Approve flow ordering carried from Layers 1+2:** executor first, audit_log second. Same revert-on-failure pattern.
14. **Memory-write idempotence** on `(pharmacy_id, source, content)` exact match.
15. **Reflector emits only `procedural`/`semantic`/`preferences` memory.** `episodic` is reserved for first-person event records (orders, agent runs, raw logs) and is not used for distilled patterns.

---

## Known Mismatches / Assumptions

| # | Item | Brief said | Repo reality | Resolution |
|---|---|---|---|---|
| 1 | Daily P&L storage | "new `daily_pnl` table OR `briefings` row — pick one" | We only have `briefings` populated by chat tools and Reflector | Use `briefings` row with `data_snapshot.kind='daily_pnl'`. Justified in brief. |
| 2 | Anomaly flags storage | "new `anomaly_flags` table OR `memory`" | `memory` is read by chat tools + agents already | Use `memory` rows with `kind='semantic'` and `metadata.anomaly_type`. |
| 3 | "Add agent_name column to briefings if not there" | column proposal | `briefings.source_agent text not null` already populated and used | Use `source_agent`. No schema change. |
| 4 | New briefing types `daily_pnl` / `weekly_strategy` / `weekly_reflection` / `pattern_extracted` | implied enum additions | enum has `strategic` already | Use `strategic` + `data_snapshot.kind`. No enum migration. |
| 5 | Sentry DSN wiring | "finish, partially done" | Already complete — `lib/logger.ts:36-46` early-returns when DSN empty, auto-init at import | No-op task. Plan documents + verifies env var in pharm1-shared. |
| 6 | `pause_brand` enum value | implied | `brand_auth_status` lacks `paused` | Migration adds `paused` (plus `paused_until` + `prior_status` columns). |
| 7 | Skill `proposed_actions = [{kind:'review_listing'},...]` | implied executor kinds | None of those executors exist | Bookkeeper/Reflector emit empty proposed_actions; Portfolio Manager output adapter maps free-form moves to the 3 concrete kinds; unmapped moves surface as informational. |
| 8 | Reflector "Opus thinking_budget high" | model + reasoning hint | We're on OpenRouter Sonnet 4.6 | `reasoning: { effort: 'high' }` for Reflector specifically. |
| 9 | Working tree state | clean | `docs/render-deploy-runbook.md` is untracked | Plan commits it as Task 2. |
| 10 | shipped plan still in ready-plans | should be in done-plans | `tmp/ready-plans/2026-05-01-phase-2-layer-1-2-kernel-listing-agent.md` is shipped per CLAUDE.local.md | Plan moves it as Task 1. |
| 11 | Bookkeeper skill mentions column `marketplace` | implied column name | Actual repo column is `platform` (per `core_schema.sql:81-101`) | Runtime maps it transparently — skill is not rewritten (locked decision 13). Bookkeeper select uses `platform`. |
| 12 | `ALTER TYPE ... ADD VALUE` Postgres limitation | single-migration assumed | Postgres forbids enum-add inside a transaction block | Resolution: enum-add lives in its own migration file (`20260504000001_wave1_brand_paused_enum.sql`); structural changes in a second file (`20260504000002_wave1_agents.sql`). Cloud apply order: enum first, structural second. |

---

## Critical Codebase Anchors

Keep open while implementing.

- `lib/executors/index.ts:7-10` — registry to extend
- `lib/executors/types.ts:1-30` — Executor interface to implement
- `lib/executors/list-on-amazon.ts:1-77` — canonical executor shape (forward + reverse + Zod schema)
- `lib/agents/listing-agent.ts:1-272` — canonical agent shape (skill load, candidate query, LLM call, JSON parse, briefing+inbox insert)
- `lib/supabase/admin.ts:8-19` — cron-safe client factory
- `lib/budget.ts:7-66` — record/read patterns
- `lib/llm.ts:1-13` — OpenRouter singleton
- `app/api/actions/approve/route.ts:1-148` — kernel approve route (no changes; uses `getExecutor(kind)`)
- `app/api/actions/undo/route.ts:1-74` — kernel undo route (no changes)
- `app/page.tsx:14-138` — inbox SSR; need to pass `source_agent` through to Timeline and update grouping props
- `components/inbox/timeline.tsx:1-93` — grouping logic to extend
- `components/inbox/briefing-card.tsx:201-207` — empty-actions branch (label-tweak only)
- `scripts/listing-agent.ts:1-19` — canonical cron entry shape
- `render.yaml:36-69` — cron service pattern + envVarGroup
- `supabase/migrations/20260501000001_pending_listings_and_system_spend.sql` — most recent migration; new one follows naming convention
- `minicrew-config/skills/{bookkeeper,reflector,portfolio-manager}.md` — pre-authored prompts to wire as system message

---

## Files Being Changed

```
pharm1/
├── supabase/
│   └── migrations/
│       ├── 20260504000001_wave1_brand_paused_enum.sql         ← NEW (enum add — must run alone, no transaction)
│       └── 20260504000002_wave1_agents.sql                    ← NEW (structural columns + index)
│
├── lib/
│   ├── agents/
│   │   ├── _shared.ts                                          ← NEW (stripJsonFence, loadSkillPrompt, runWithBudgetGate)
│   │   ├── bookkeeper.ts                                       ← NEW
│   │   ├── reflector.ts                                        ← NEW
│   │   ├── portfolio-manager.ts                                ← NEW
│   │   ├── portfolio-manager-output-adapter.ts                 ← NEW (free-form move → executor kind classifier)
│   │   └── listing-agent.ts                                    ← MODIFIED (refactor to use _shared.ts helpers; behavior unchanged)
│   ├── executors/
│   │   ├── add-to-watchlist.ts                                 ← NEW
│   │   ├── pause-brand.ts                                      ← NEW
│   │   ├── flag-anomaly.ts                                     ← NEW
│   │   ├── dismiss-briefing.ts                                 ← NEW (no-op executor for the Skip pseudo-action)
│   │   └── index.ts                                            ← MODIFIED (register 4 new executors)
│   ├── memory/
│   │   └── write.ts                                            ← NEW
│   └── supabase/
│       └── types.ts                                            ← MODIFIED (regenerated after migration)
│
├── components/
│   └── inbox/
│       ├── timeline.tsx                                        ← MODIFIED (group by source_agent then day)
│       └── briefing-card.tsx                                   ← MODIFIED (label tweak: "Acknowledge" for bookkeeper/reflector)
│
├── app/
│   └── page.tsx                                                ← MODIFIED (no functional change; source_agent already passed)
│
├── scripts/
│   ├── bookkeeper.ts                                           ← NEW
│   ├── reflector.ts                                            ← NEW
│   └── portfolio-manager.ts                                    ← NEW
│
├── docs/
│   └── render-deploy-runbook.md                                ← STAGED (currently untracked; commit it)
│
├── tmp/
│   ├── done-plans/
│   │   └── 2026-05-01-phase-2-layer-1-2-kernel-listing-agent.md ← MOVED from ready-plans
│   └── ready-plans/
│       └── (the moved file is gone from here)
│
├── .env.example                                                 ← MODIFIED (4 new vars: DEV_LOGIN_ENABLED, DEV_PASSWORD, NEXT_PUBLIC_DEV_LOGIN_ENABLED, REDACT_ENV)
├── package.json                                                 ← MODIFIED (3 new scripts: agent:bookkeeper, agent:reflector, agent:portfolio-manager)
└── render.yaml                                                  ← MODIFIED (3 new cron services)
```

Total: **13 NEW files, 7 MODIFIED files, 2 new migrations, 1 file moved, 1 staged file**. Net code addition ~700–950 LOC.

---

## Reconciliation Notes

Imported from dossier:
- `briefing_type` stays `strategic`; sub-kind in `data_snapshot.kind` (avoids enum-add migration).
- Daily P&L → briefing row, not new table (read path consistency for chat tools and Reflector).
- Anomaly flags → `memory` rows, not new table (same reason).
- `paused_until` + `prior_status` columns on `brand_authorization` (clean undo).
- Output adapter for Portfolio Manager (skill emits free-form moves; runtime maps to concrete executors).
- Reflector `reasoning: { effort: 'high' }` (skill says Opus thinking_budget high; closest OpenRouter analogue).
- Memory-write idempotence on exact `(pharmacy_id, source, content)` (matches seed-dev-data.ts pattern).
- Inbox grouping by `source_agent` first, then day inside. Sections collapsed past 5 items.
- `_shared.ts` extraction (fence-strip + skill-prompt loader) — avoids 4× copies.

Dropped from dossier (low value at this scope):
- `daily_pnl` and `anomaly_flags` table proposals (rejected per locked decisions 15+16).
- New `briefing_type` enum values (rejected per locked decision 5).
- New `agent_name` column (rejected; `source_agent` is sufficient).

Conflicts surfaced:
- Brief said "Sentry DSN wiring needs finishing" — already done. Plan task is verification + documentation only.
- Brief implied "agent_name column" — repo has `source_agent`. Plan corrects.

Non-goals preserved:
- No SP-API, no FDA, no Keepa, no Voyage embeddings.
- No automated tests.
- No coupling to minicrew.
- No changes to chat route, auth flow, or Phase 1 schema beyond additive migration.

---

## Delta Design

### Migration

Postgres forbids `ALTER TYPE ... ADD VALUE` inside a transaction block, so the migration is **split into two files**. Cloud apply order: enum-add first, structural second.

```sql
-- supabase/migrations/20260504000001_wave1_brand_paused_enum.sql
-- Phase 2 Wave 1 — enum addition (must run outside a transaction).

alter type brand_auth_status add value if not exists 'paused';
```

```sql
-- supabase/migrations/20260504000002_wave1_agents.sql
-- Phase 2 Wave 1 — structural deltas for self-contained agents.

-- 1. brand_authorization paused_until + prior_status (clean undo).
alter table brand_authorization add column if not exists paused_until date;
alter table brand_authorization add column if not exists prior_status brand_auth_status;

-- 2. Index for "what briefings did this agent produce in the last N days"
-- (Reflector queries last 7 days of briefings filtered by source_agent).
create index if not exists briefings_pharmacy_agent_created_idx
  on briefings (pharmacy_id, source_agent, created_at desc);
```

### Shared agent helpers

```ts
// lib/agents/_shared.ts
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { getTodaySpendUsd } from '@/lib/budget';

export const DEFAULT_PHARMACY_ID = '00000000-0000-0000-0000-000000000001';
export const AGENT_MODEL = 'anthropic/claude-sonnet-4.6';

export function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export async function loadSkillPrompt(name: string): Promise<string> {
  const skillPath = path.resolve(__dirname, '../../minicrew-config/skills', `${name}.md`);
  return await readFile(skillPath, 'utf8');
}

export async function dailyBudgetGate(
  supabase: SupabaseClient<Database>,
  agentName: string,
): Promise<{ capped: boolean; today: number; cap: number }> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error(`[${agentName}] OPENROUTER_API_KEY missing; cron exiting`);
    process.exit(2);
  }
  const rawCap = process.env.MAX_DAILY_CLAUDE_SPEND_USD;
  const parsedCap = rawCap && rawCap.trim() !== '' ? Number(rawCap) : NaN;
  const cap = Number.isFinite(parsedCap) && parsedCap > 0 ? parsedCap : 50;
  const today = await getTodaySpendUsd(supabase, null);
  if (today >= cap) {
    console.log(`[${agentName}] daily cap reached: $${today} >= $${cap}; exiting`);
    return { capped: true, today, cap };
  }
  return { capped: false, today, cap };
}

export type CallAgentLLMArgs = {
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  systemPrompt: string;
  userPayload: unknown;
};

export async function callAgentLLM(
  openrouter: OpenAI,
  args: CallAgentLLMArgs,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return await openrouter.chat.completions.create({
    model: args.model ?? AGENT_MODEL,
    messages: [
      { role: 'system', content: args.systemPrompt },
      { role: 'user', content: JSON.stringify(args.userPayload) },
    ],
    response_format: { type: 'json_object' },
    reasoning: { effort: args.reasoningEffort ?? 'medium' },
    // OpenRouter extension — same cast pattern as listing-agent.ts:153 (ChatCompletionCreateParamsNonStreaming type doesn't include 'reasoning' field).
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
}
```

### Memory-write helper

```ts
// lib/memory/write.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

export type MemoryKind = 'episodic' | 'procedural' | 'semantic' | 'preferences';

export type WriteMemoryArgs = {
  pharmacyId: string;
  kind: MemoryKind;
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
  importance?: number;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
};

export async function writeMemory(
  supabase: SupabaseClient<Database>,
  args: WriteMemoryArgs,
): Promise<{ id: string; inserted: boolean }> {
  // Idempotent on (pharmacy_id, source, content) exact match.
  const { data: existing } = await supabase
    .from('memory')
    .select('id')
    .eq('pharmacy_id', args.pharmacyId)
    .eq('source', args.source)
    .eq('content', args.content)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return { id: existing.id, inserted: false };

  const { data, error } = await supabase
    .from('memory')
    .insert({
      pharmacy_id: args.pharmacyId,
      kind: args.kind,
      source: args.source,
      content: args.content,
      metadata: args.metadata ?? {},
      importance: args.importance ?? 0.5,
      related_entity_type: args.relatedEntityType ?? null,
      related_entity_id: args.relatedEntityId ?? null,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`writeMemory failed: ${error?.message ?? 'no row returned'}`);
  }
  return { id: data.id, inserted: true };
}
```

### Executors

#### `add_to_watchlist`

```ts
// lib/executors/add-to-watchlist.ts
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const Params = z.object({
  product_ids: z.array(z.string().uuid()).min(1).max(20),
  reason: z.string().min(1).max(500),
});

export const addToWatchlist: Executor = {
  kind: 'add_to_watchlist',
  async forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult> {
    const v = Params.parse(params);
    const supabase = createAdminClient();
    // Capture prior watchlist_status per row so undo can restore.
    const { data: priors } = await supabase
      .from('products')
      .select('id, watchlist_status')
      .eq('pharmacy_id', ctx.pharmacyId)
      .in('id', v.product_ids);
    const priorMap: Record<string, string> = {};
    for (const r of priors ?? []) priorMap[r.id] = r.watchlist_status ?? 'none';

    const { error } = await supabase
      .from('products')
      .update({ watchlist_status: 'watching' })
      .eq('pharmacy_id', ctx.pharmacyId)
      .in('id', v.product_ids);
    if (error) throw new Error(`add_to_watchlist.forward: ${error.message}`);

    console.log(`[STUB] would notify research_analyst of ${v.product_ids.length} new watch items`);
    return { product_ids: v.product_ids, prior_status: priorMap };
  },
  async reverse(_params, forwardResult, ctx) {
    const priorMap = (forwardResult.prior_status ?? {}) as Record<string, string>;
    const supabase = createAdminClient();
    for (const [id, prior] of Object.entries(priorMap)) {
      await supabase
        .from('products')
        .update({ watchlist_status: prior })
        .eq('pharmacy_id', ctx.pharmacyId)
        .eq('id', id);
    }
    return { reverted: true, count: Object.keys(priorMap).length };
  },
};
```

#### `pause_brand`

```ts
// lib/executors/pause-brand.ts
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const Params = z.object({
  brand: z.string().min(1).max(200),
  reason: z.string().min(1).max(500),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // ISO date
});

export const pauseBrand: Executor = {
  kind: 'pause_brand',
  async forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult> {
    const v = Params.parse(params);
    const supabase = createAdminClient();

    // Look for existing row (pharmacy-specific override or global default).
    const { data: existing } = await supabase
      .from('brand_authorization')
      .select('id, status')
      .eq('pharmacy_id', ctx.pharmacyId)
      .eq('brand', v.brand)
      .limit(1)
      .maybeSingle();

    if (existing) {
      const priorStatus = existing.status;
      const { error } = await supabase
        .from('brand_authorization')
        .update({ status: 'paused', paused_until: v.until, prior_status: priorStatus, notes: v.reason })
        .eq('id', existing.id);
      if (error) throw new Error(`pause_brand.forward(update): ${error.message}`);
      return { brand_authorization_id: existing.id, prior_status: priorStatus, created: false };
    }

    // Insert new pharmacy-scoped row.
    const { data, error } = await supabase
      .from('brand_authorization')
      .insert({
        pharmacy_id: ctx.pharmacyId,
        brand: v.brand,
        status: 'paused',
        paused_until: v.until,
        prior_status: 'unknown',
        notes: v.reason,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`pause_brand.forward(insert): ${error?.message}`);
    return { brand_authorization_id: data.id, prior_status: 'unknown', created: true };
  },
  async reverse(_params, forwardResult, ctx: ExecutorContext) {
    const supabase = createAdminClient();
    const result = forwardResult as {
      brand_authorization_id: string;
      prior_status: 'safe' | 'needs_loa' | 'hunts_resellers' | 'transparency_enrolled' | 'unknown' | 'paused';
      created: boolean;
    };
    const id = result.brand_authorization_id;
    if (result.created) {
      await supabase
        .from('brand_authorization')
        .delete()
        .eq('id', id)
        .eq('pharmacy_id', ctx.pharmacyId);
      return { reverted: true, deleted: true };
    }
    await supabase
      .from('brand_authorization')
      .update({ status: result.prior_status, paused_until: null, prior_status: null })
      .eq('id', id)
      .eq('pharmacy_id', ctx.pharmacyId);
    return { reverted: true, deleted: false };
  },
};
```

Pharmacy-scoping every reverse query is a Wave 1 precedent for the Phase 2 multi-tenant readiness path.

#### `flag_anomaly`

```ts
// lib/executors/flag-anomaly.ts
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeMemory } from '@/lib/memory/write';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const Params = z.object({
  anomaly_type: z.string().min(1).max(100),
  related_entity_type: z.string().min(1).max(100),
  related_ids: z.array(z.string().uuid()).min(1).max(20),
  severity: z.enum(['info', 'warn', 'critical']),
  reason: z.string().min(1).max(2000),
});

export const flagAnomaly: Executor = {
  kind: 'flag_anomaly',
  async forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult> {
    const v = Params.parse(params);
    const supabase = createAdminClient();
    const memoryIds: string[] = [];
    for (const id of v.related_ids) {
      const result = await writeMemory(supabase, {
        pharmacyId: ctx.pharmacyId,
        kind: 'semantic',
        source: 'portfolio_manager',
        content: `Anomaly flagged: ${v.anomaly_type} on ${v.related_entity_type} ${id} (severity=${v.severity}). ${v.reason}`,
        metadata: {
          anomaly_type: v.anomaly_type,
          severity: v.severity,
          flagged_at: new Date().toISOString(),
        },
        importance: v.severity === 'critical' ? 0.9 : v.severity === 'warn' ? 0.6 : 0.3,
        relatedEntityType: v.related_entity_type,
        relatedEntityId: id,
      });
      if (result.inserted) memoryIds.push(result.id);
    }
    return { memory_ids: memoryIds };
  },
  async reverse(_params, forwardResult) {
    const supabase = createAdminClient();
    const ids = (forwardResult.memory_ids ?? []) as string[];
    if (ids.length === 0) return { reverted: true, count: 0 };
    const { error } = await supabase.from('memory').delete().in('id', ids);
    if (error) throw new Error(`flag_anomaly.reverse: ${error.message}`);
    return { reverted: true, count: ids.length };
  },
};
```

#### `dismiss_briefing`

```ts
// lib/executors/dismiss-briefing.ts
// No-op executor — backs the listing-agent's "Skip" pseudo-action that previously had
// no registered handler (see Pre-Existing Issues Surfaced).
import type { Executor } from './types';

export const dismissBriefing: Executor = {
  kind: 'dismiss_briefing',
  async forward() {
    return { dismissed: true };
  },
  async reverse() {
    return { restored: true };
  },
};
```

#### Registry update

```ts
// lib/executors/index.ts (modified)
import { listOnAmazon } from './list-on-amazon';
import { addToWatchlist } from './add-to-watchlist';
import { pauseBrand } from './pause-brand';
import { flagAnomaly } from './flag-anomaly';
import { dismissBriefing } from './dismiss-briefing';
import { type Executor, UnknownExecutorError } from './types';

const registry: Record<string, Executor> = {
  list_on_amazon: listOnAmazon,
  add_to_watchlist: addToWatchlist,
  pause_brand: pauseBrand,
  flag_anomaly: flagAnomaly,
  dismiss_briefing: dismissBriefing,
};
export function getExecutor(kind: string): Executor {
  const ex = registry[kind];
  if (!ex) throw new UnknownExecutorError(kind);
  return ex;
}
export type { Executor, ExecutorContext, ExecutorResult } from './types';
export { UnknownExecutorError } from './types';
```

### Bookkeeper agent

```ts
// lib/agents/bookkeeper.ts
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { openrouter } from '@/lib/llm';
import { recordLLMUsage } from '@/lib/budget';
import {
  AGENT_MODEL, DEFAULT_PHARMACY_ID, callAgentLLM, dailyBudgetGate,
  loadSkillPrompt, stripJsonFence,
} from './_shared';

const Output = z.object({
  date: z.string(),
  revenue: z.number(),
  cogs: z.number(),
  fees: z.number(),
  net: z.number(),
  anomalies: z.array(z.object({ kind: z.string(), detail: z.record(z.unknown()) })),
  data_source: z.enum(['estimated', 'settled']),
  reasoning: z.string(),
});

export async function runBookkeeper(
  supabase: SupabaseClient<Database>,
  opts: { pharmacyId?: string; date?: Date } = {},
) {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;
  const target = opts.date ?? (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d; })();
  const start = new Date(target); start.setUTCHours(0,0,0,0);
  const end = new Date(target); end.setUTCHours(23,59,59,999);

  const gate = await dailyBudgetGate(supabase, 'bookkeeper');
  if (gate.capped) return { briefing_id: null, capped: true };

  const { data: orders } = await supabase
    .from('orders')
    .select('id, sold_price, supplier_cost, shipping_cost, platform_fees, net_profit, status, platform, sold_at')
    .eq('pharmacy_id', pharmacyId)
    .gte('sold_at', start.toISOString())
    .lte('sold_at', end.toISOString());

  const { data: usage } = await supabase
    .from('claude_usage')
    .select('estimated_cost_usd, model, created_at')
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());

  const { data: health } = await supabase
    .from('health_metrics')
    .select('platform, metric, value, captured_at')
    .eq('pharmacy_id', pharmacyId)
    .gte('captured_at', start.toISOString())
    .lte('captured_at', end.toISOString());

  // Pull last 7 days of pending_listings for the trailing carrying-cost lens.
  const seven = new Date(start); seven.setUTCDate(seven.getUTCDate() - 7);
  const { data: pendingListings } = await supabase
    .from('pending_listings')
    .select('id, status, created_at, proposed_price')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', seven.toISOString());

  const userPayload = {
    pharmacy_id: pharmacyId,
    date_range: { start: start.toISOString(), end: end.toISOString() },
    trigger: 'scheduled',
    orders: orders ?? [],
    claude_usage: usage ?? [],
    health_metrics: health ?? [],
    pending_listings: pendingListings ?? [],
    note: (orders?.length ?? 0) === 0
      ? 'No orders in window — emit zero P&L with data_source=estimated.'
      : 'Standard P&L reconciliation.',
  };

  const skill = await loadSkillPrompt('bookkeeper');
  const completion = await callAgentLLM(openrouter, {
    model: AGENT_MODEL,
    reasoningEffort: 'medium',
    systemPrompt: skill,
    userPayload,
  });
  await recordLLMUsage(supabase, null, completion);

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = Output.parse(JSON.parse(stripJsonFence(raw)));

  const summary = `${parsed.date}: net $${parsed.net.toFixed(2)} (revenue $${parsed.revenue.toFixed(2)}, cogs $${parsed.cogs.toFixed(2)}, fees $${parsed.fees.toFixed(2)}). ${parsed.anomalies.length} anomalies. data_source=${parsed.data_source}.`;

  const { data: briefing, error: bErr } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: pharmacyId,
      source_agent: 'bookkeeper',
      briefing_type: 'strategic',
      title: `Daily P&L for ${parsed.date}`,
      summary,
      rationale: parsed.reasoning,
      confidence: 0.8,
      urgency: parsed.anomalies.length > 0 ? 3 : 2,
      proposed_actions: [],
      data_snapshot: { kind: 'daily_pnl', ...parsed },
    })
    .select('id')
    .single();
  if (bErr || !briefing) throw new Error(`bookkeeper briefing insert failed: ${bErr?.message}`);

  await supabase.from('inbox_items').insert({
    pharmacy_id: pharmacyId,
    briefing_id: briefing.id,
    state: 'pending',
  });

  return { briefing_id: briefing.id, capped: false, anomaly_count: parsed.anomalies.length };
}
```

### Reflector agent

```ts
// lib/agents/reflector.ts
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { openrouter } from '@/lib/llm';
import { recordLLMUsage } from '@/lib/budget';
import { writeMemory } from '@/lib/memory/write';
import {
  AGENT_MODEL, DEFAULT_PHARMACY_ID, callAgentLLM, dailyBudgetGate,
  loadSkillPrompt, stripJsonFence,
} from './_shared';

const PatternSchema = z.object({
  summary: z.string(),
  kind: z.enum(['procedural', 'semantic', 'preferences']),
  importance: z.number().min(0).max(1),
  metadata: z.record(z.unknown()).optional(),
  related_entity_type: z.string().nullable().optional(),
  related_entity_id: z.string().uuid().nullable().optional(),
});
const Output = z.object({
  week_of: z.string(),
  patterns: z.array(PatternSchema),
  preferences_update: z.record(z.unknown()).nullable(),
  reasoning: z.string(),
});

export async function runReflector(
  supabase: SupabaseClient<Database>,
  opts: { pharmacyId?: string; weekOf?: Date } = {},
) {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;
  const now = opts.weekOf ?? new Date();
  const weekEnd = new Date(now);
  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  weekStart.setUTCHours(0, 0, 0, 0);

  const gate = await dailyBudgetGate(supabase, 'reflector');
  if (gate.capped) return { briefing_id: null, capped: true };

  const { data: audit } = await supabase
    .from('audit_log')
    .select('id, actor, action, target_entity_type, target_entity_id, params, result, undo_window_expires_at, undone_at, created_at')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', weekStart.toISOString())
    .lte('created_at', weekEnd.toISOString())
    .order('created_at', { ascending: true });

  const { data: briefings } = await supabase
    .from('briefings')
    .select('id, source_agent, briefing_type, title, summary, confidence, urgency, created_at, related_entity_type, related_entity_id')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', weekStart.toISOString())
    .lte('created_at', weekEnd.toISOString());

  const inboxIds = (briefings ?? []).map((b) => b.id);
  type InboxRow = { briefing_id: string; state: string };
  const inbox: InboxRow[] = inboxIds.length > 0
    ? (await supabase.from('inbox_items')
         .select('id, briefing_id, state, acted_at, action_taken, dismissed_reason')
         .in('briefing_id', inboxIds)).data ?? []
    : [];
  const stateByBriefing = new Map(inbox.map((r) => [r.briefing_id, r.state]));

  // Kaleem-driven actions only: every approve/reject targets inbox_items; exclude compensating undo:* rows.
  const filteredAudit = (audit ?? []).filter(
    (a) => a.target_entity_type === 'inbox_items' && !(a.action ?? '').startsWith('undo:'),
  );

  const userPayload = {
    pharmacy_id: pharmacyId,
    week_of: weekStart.toISOString(),
    trigger: 'scheduled',
    audit_log: filteredAudit,
    briefings: (briefings ?? []).map((b) => ({ ...b, inbox_state: stateByBriefing.get(b.id) ?? 'unknown' })),
    note: filteredAudit.length === 0 && (briefings?.length ?? 0) === 0
      ? 'First reflection — no patterns yet. Emit empty patterns and a placeholder summary.'
      : 'Standard weekly reflection.',
  };

  const skill = await loadSkillPrompt('reflector');
  const completion = await callAgentLLM(openrouter, {
    model: AGENT_MODEL,
    reasoningEffort: 'high', // skill says Opus thinking_budget high
    systemPrompt: skill,
    userPayload,
  });
  await recordLLMUsage(supabase, null, completion);

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = Output.parse(JSON.parse(stripJsonFence(raw)));

  const memoryIds: string[] = [];
  for (const pattern of parsed.patterns) {
    const result = await writeMemory(supabase, {
      pharmacyId,
      kind: pattern.kind,
      source: 'reflector',
      content: pattern.summary,
      metadata: pattern.metadata ?? {},
      importance: pattern.importance,
      relatedEntityType: pattern.related_entity_type ?? null,
      relatedEntityId: pattern.related_entity_id ?? null,
    });
    memoryIds.push(result.id);
  }

  if (parsed.preferences_update) {
    await writeMemory(supabase, {
      pharmacyId,
      kind: 'preferences',
      source: 'reflector',
      content: `Preferences update for ${parsed.week_of}: ${JSON.stringify(parsed.preferences_update)}`,
      metadata: parsed.preferences_update,
      importance: 0.7,
    });
  }

  const { data: briefing, error } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: pharmacyId,
      source_agent: 'reflector',
      briefing_type: 'strategic',
      title: `Weekly reflection for ${parsed.week_of}`,
      summary: `${parsed.patterns.length} patterns extracted. ${parsed.preferences_update ? 'Preferences updated.' : 'No preferences change.'}`,
      rationale: parsed.reasoning,
      confidence: 0.7,
      urgency: 2,
      proposed_actions: [],
      data_snapshot: { kind: 'weekly_reflection', ...parsed, memory_ids: memoryIds },
    })
    .select('id')
    .single();
  if (error || !briefing) throw new Error(`reflector briefing insert failed: ${error?.message}`);

  await supabase.from('inbox_items').insert({
    pharmacy_id: pharmacyId,
    briefing_id: briefing.id,
    state: 'pending',
  });

  return { briefing_id: briefing.id, capped: false, memory_count: memoryIds.length };
}
```

### Portfolio Manager agent + output adapter

```ts
// lib/agents/portfolio-manager-output-adapter.ts
import { z } from 'zod';

const AddToWatchlist = z.object({
  kind: z.literal('add_to_watchlist'),
  params: z.object({ product_ids: z.array(z.string().uuid()).min(1).max(20), reason: z.string() }),
});
const PauseBrand = z.object({
  kind: z.literal('pause_brand'),
  params: z.object({ brand: z.string().min(1), reason: z.string(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
});
const FlagAnomaly = z.object({
  kind: z.literal('flag_anomaly'),
  params: z.object({
    anomaly_type: z.string(),
    related_entity_type: z.string(),
    related_ids: z.array(z.string().uuid()).min(1),
    severity: z.enum(['info', 'warn', 'critical']),
    reason: z.string(),
  }),
});

export const ProposedActionSchema = z.discriminatedUnion('kind', [AddToWatchlist, PauseBrand, FlagAnomaly]);
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

const StrategicMoveSchema = z.object({
  move: z.string(),
  rationale: z.string(),
  target_agent: z.string(),
  success_metric: z.string(),
  proposed_action: ProposedActionSchema.nullable(),
});

export const PortfolioManagerOutputSchema = z.object({
  week_of: z.string(),
  top_sellers: z.array(z.object({ product_id: z.string().uuid(), ttm_net: z.number() })).optional(),
  dead_inventory: z.array(z.object({ product_id: z.string().uuid(), days_since_sale: z.number() })).optional(),
  strategic_moves: z.array(StrategicMoveSchema).max(3),
  reasoning: z.string(),
});
```

```ts
// lib/agents/portfolio-manager.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { openrouter } from '@/lib/llm';
import { recordLLMUsage } from '@/lib/budget';
import {
  AGENT_MODEL, DEFAULT_PHARMACY_ID, callAgentLLM, dailyBudgetGate,
  loadSkillPrompt, stripJsonFence,
} from './_shared';
import { PortfolioManagerOutputSchema, ProposedActionSchema } from './portfolio-manager-output-adapter';

export async function runPortfolioManager(
  supabase: SupabaseClient<Database>,
  opts: { pharmacyId?: string; weekOf?: Date } = {},
) {
  const pharmacyId = opts.pharmacyId ?? DEFAULT_PHARMACY_ID;
  const now = opts.weekOf ?? new Date();
  const thirtyAgo = new Date(now); thirtyAgo.setUTCDate(thirtyAgo.getUTCDate() - 30);

  const gate = await dailyBudgetGate(supabase, 'portfolio-manager');
  if (gate.capped) return { briefing_id: null, capped: true };

  const { data: audit } = await supabase
    .from('audit_log').select('action, target_entity_type, target_entity_id, params, created_at')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', thirtyAgo.toISOString());

  const { data: briefings } = await supabase
    .from('briefings').select('id, source_agent, briefing_type, title, urgency, confidence, related_entity_type, related_entity_id, created_at')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', thirtyAgo.toISOString());

  const { data: products } = await supabase
    .from('products').select('id, name, brand, category, watchlist_status')
    .eq('pharmacy_id', pharmacyId);

  const { data: memory } = await supabase
    .from('memory').select('kind, source, content, importance, related_entity_type, related_entity_id, metadata, created_at')
    .eq('pharmacy_id', pharmacyId)
    .order('importance', { ascending: false })
    .limit(50);

  const userPayload = {
    pharmacy_id: pharmacyId,
    week_of: now.toISOString(),
    trigger: 'scheduled',
    products: products ?? [],
    audit_log_30d: audit ?? [],
    briefings_30d: briefings ?? [],
    memory_top_50: memory ?? [],
    available_executor_kinds: ['add_to_watchlist', 'pause_brand', 'flag_anomaly'],
    note: 'Emit at most 3 strategic_moves. For each move, set proposed_action to one of the available_executor_kinds — or null if the move is informational only or targets an agent not yet shipped.',
  };

  const skill = await loadSkillPrompt('portfolio-manager');
  const completion = await callAgentLLM(openrouter, {
    model: AGENT_MODEL,
    reasoningEffort: 'medium',
    systemPrompt: skill,
    userPayload,
  });
  await recordLLMUsage(supabase, null, completion);

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = PortfolioManagerOutputSchema.parse(JSON.parse(stripJsonFence(raw)));

  // Build proposed_actions: only moves with valid proposed_action survive validation.
  const proposed_actions: Array<{ label: string; variant: string; kind: string; params: unknown }> = [];
  const unmapped: Array<{ move: string; rationale: string; target_agent: string }> = [];
  for (let i = 0; i < parsed.strategic_moves.length; i++) {
    const m = parsed.strategic_moves[i];
    if (!m.proposed_action) {
      unmapped.push({ move: m.move, rationale: m.rationale, target_agent: m.target_agent });
      continue;
    }
    const validated = ProposedActionSchema.safeParse(m.proposed_action);
    if (!validated.success) {
      unmapped.push({ move: m.move, rationale: m.rationale, target_agent: m.target_agent });
      continue;
    }
    proposed_actions.push({
      label: m.move.slice(0, 80),
      variant: i === 0 ? 'primary' : 'secondary',
      kind: validated.data.kind,
      params: validated.data.params,
    });
  }

  const { data: briefing, error } = await supabase
    .from('briefings')
    .insert({
      pharmacy_id: pharmacyId,
      source_agent: 'portfolio_manager',
      briefing_type: 'strategic',
      title: `Weekly strategy for ${parsed.week_of}`,
      summary: `${parsed.strategic_moves.length} moves proposed (${proposed_actions.length} actionable). ${unmapped.length} informational.`,
      rationale: parsed.reasoning,
      confidence: 0.7,
      urgency: 4,
      proposed_actions,
      data_snapshot: { kind: 'weekly_strategy', ...parsed, unmapped_moves: unmapped },
    })
    .select('id')
    .single();
  if (error || !briefing) throw new Error(`portfolio-manager briefing insert failed: ${error?.message}`);

  await supabase.from('inbox_items').insert({
    pharmacy_id: pharmacyId,
    briefing_id: briefing.id,
    state: 'pending',
  });

  return { briefing_id: briefing.id, capped: false, action_count: proposed_actions.length, unmapped_count: unmapped.length };
}
```

### Cron entries

Three thin scripts mirroring `scripts/listing-agent.ts`:

```ts
// scripts/bookkeeper.ts
import { createAdminClient } from '@/lib/supabase/admin';
import { runBookkeeper } from '@/lib/agents/bookkeeper';
async function main() {
  const supabase = createAdminClient();
  const r = await runBookkeeper(supabase);
  console.log(`[bookkeeper] done — briefing_id=${r.briefing_id} capped=${r.capped} anomalies=${r.anomaly_count ?? 0}`);
}
main().catch((e) => { console.error('[bookkeeper] fatal:', e); process.exit(1); });
```

(Reflector and Portfolio Manager scripts are identical-shape.)

### Inbox UI grouping

```ts
// components/inbox/timeline.tsx (modified)
function dayBucket(iso: string | null | undefined): string { /* unchanged */ }

function agentLabel(source: string | null | undefined): string {
  switch (source) {
    case 'bookkeeper': return 'Bookkeeper';
    case 'reflector': return 'Reflector';
    case 'portfolio_manager': return 'Portfolio Manager';
    case 'listing_agent': return 'Listing Agent';
    case 'repricer': return 'Repricer';
    case 'research_analyst': return 'Research Analyst';
    case 'account_health': return 'Account Health';
    default: return source ?? 'Unknown agent';
  }
}

export function Timeline({ items }: { items: BriefingItem[] }) {
  if (!items || items.length === 0) { /* empty state unchanged */ }

  // Group by source_agent first, then by dayBucket inside.
  const byAgent = new Map<string, Map<string, BriefingItem[]>>();
  const agentLatest = new Map<string, number>();
  for (const item of items) {
    const a = item.source_agent ?? 'unknown';
    const d = dayBucket(item.created_at);
    const inner = byAgent.get(a) ?? new Map<string, BriefingItem[]>();
    const dayArr = inner.get(d) ?? [];
    dayArr.push(item);
    inner.set(d, dayArr);
    byAgent.set(a, inner);
    const t = item.created_at ? new Date(item.created_at).getTime() : 0;
    if (!agentLatest.has(a) || agentLatest.get(a)! < t) agentLatest.set(a, t);
  }
  const orderedAgents = Array.from(byAgent.keys()).sort((a, b) => (agentLatest.get(b) ?? 0) - (agentLatest.get(a) ?? 0));

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {orderedAgents.map((agent) => {
        const inner = byAgent.get(agent)!;
        return (
          <section key={agent} className="space-y-4">
            <h2 className="text-sm font-semibold tracking-wide text-foreground">{agentLabel(agent)}</h2>
            {Array.from(inner.entries()).map(([day, dayItems]) => (
              <div key={day} className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{day}</h3>
                <div className="space-y-3">
                  {dayItems.map((item) => <BriefingCard key={item.id} item={item} />)}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
```

`BriefingItem` already includes `source_agent` (passed through from `app/page.tsx:107`). No type change needed.

### .env.example additions

```
# Demo-only: gates the password sign-in shortcut on Render.
DEV_LOGIN_ENABLED=
DEV_PASSWORD=
NEXT_PUBLIC_DEV_LOGIN_ENABLED=

# Comma-separated env var names whose values are redacted in Sentry events
REDACT_ENV=
```

### Cron schedule layout (UTC)

| Agent / Job | Schedule | Cadence | Day-of-week notes |
|---|---|---|---|
| pharm1-listing-agent | `0 13 * * *` | Daily 13:00 UTC | every day |
| pharm1-bookkeeper | `0 23 * * *` | Daily 23:00 UTC | every day |
| pharm1-portfolio-manager | `0 7 * * 0` | Sunday 07:00 UTC | weekly |
| pharm1-reflector | `30 23 * * 0` | Sunday 23:30 UTC | weekly (30 min after Bookkeeper to avoid race on system-spend writes) |
| pharm1-backup-weekly | `0 9 * * 0` | Sunday 09:00 UTC | weekly |
| pharm1-backup-restore-test | `0 10 1 * *` | 1st-of-month 10:00 UTC | monthly |

No two crons fire at the same UTC instant. Sunday is the busiest day (07:00 PM, 09:00 backup, 23:00 Bookkeeper, 23:30 Reflector). Render free tier runs crons sequentially across services so back-to-back execution is fine.

### render.yaml additions (3 cron services)

```yaml
  - type: cron
    name: pharm1-bookkeeper
    runtime: node
    plan: starter
    region: oregon
    buildCommand: npm ci
    schedule: "0 23 * * *"   # daily 23:00 UTC
    startCommand: npm run agent:bookkeeper
    envVars:
      - fromGroup: pharm1-shared

  - type: cron
    name: pharm1-portfolio-manager
    runtime: node
    plan: starter
    region: oregon
    buildCommand: npm ci
    schedule: "0 7 * * 0"    # Sundays 07:00 UTC
    startCommand: npm run agent:portfolio-manager
    envVars:
      - fromGroup: pharm1-shared

  - type: cron
    name: pharm1-reflector
    runtime: node
    plan: starter
    region: oregon
    buildCommand: npm ci
    schedule: "30 23 * * 0"  # Sundays 23:30 UTC (30 min after Bookkeeper to avoid claude_usage write race)
    startCommand: npm run agent:reflector
    envVars:
      - fromGroup: pharm1-shared
```

### package.json additions

```jsonc
"scripts": {
  ...
  "agent:listing": "tsx scripts/listing-agent.ts",
  "agent:bookkeeper": "tsx scripts/bookkeeper.ts",
  "agent:reflector": "tsx scripts/reflector.ts",
  "agent:portfolio-manager": "tsx scripts/portfolio-manager.ts"
}
```

---

## Architecture Overview

```
┌──────────────────┐  ┌────────────────────┐  ┌──────────────────────┐
│ Render Cron:     │  │ Render Cron:       │  │ Render Cron:          │
│ pharm1-          │  │ pharm1-            │  │ pharm1-               │
│ bookkeeper       │  │ portfolio-manager  │  │ reflector             │
│ daily 23 UTC     │  │ Sun 07 UTC         │  │ Sun 23 UTC            │
└────────┬─────────┘  └─────────┬──────────┘  └──────────┬───────────┘
         │                       │                         │
         ▼                       ▼                         ▼
┌───────────────────────────────────────────────────────────────────┐
│ scripts/{bookkeeper,portfolio-manager,reflector}.ts                │
│   createAdminClient() → run<Agent>(supabase) → exit 0/1            │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│ lib/agents/<name>.ts                                               │
│  1. dailyBudgetGate(system spend)                                  │
│  2. read inputs (orders / audit_log / briefings / memory / ...)    │
│  3. callAgentLLM(skillPrompt, userPayload, reasoningEffort)        │
│  4. recordLLMUsage(supabase, null, completion)                     │
│  5. parse + Zod-validate                                           │
│  6. Reflector + PortfolioManager: writeMemory(...) loop            │
│  7. INSERT briefings (data_snapshot.kind = ...) + inbox_items      │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│ Supabase: briefings + inbox_items + memory + audit_log             │
└───────────────────────────────┬───────────────────────────────────┘
                                │ SSR
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│ Inbox UI (app/page.tsx → Timeline)                                 │
│  Group by source_agent (latest first), then by day-bucket inside   │
│   - Bookkeeper / Reflector cards: Acknowledge (reject-only)        │
│   - Portfolio Manager cards: Approve (3 executor actions)          │
└───────────────────────────────┬───────────────────────────────────┘
                                │ click Approve
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│ POST /api/actions/approve (UNCHANGED)                              │
│  → getExecutor(kind).forward(params, ctx)                          │
│  Three new executors (add_to_watchlist / pause_brand / flag_       │
│  anomaly) write to products / brand_authorization / memory.        │
│  Audit_log row with 30-min undo window.                            │
└───────────────────────────────────────────────────────────────────┘
```

---

## Tasks

Implementation order. Each task is one commit-shaped unit.

### Phase A — Cleanups (do these first; small, low-risk)
1. **Move** `tmp/ready-plans/2026-05-01-phase-2-layer-1-2-kernel-listing-agent.md` → `tmp/done-plans/`. Single `git mv`. (Skill should have done this on /implement; flag explicitly per brief.)
2. **Stage + commit** `docs/render-deploy-runbook.md` (currently untracked).
3. **Modify** `.env.example`: append the four missing vars (`DEV_LOGIN_ENABLED`, `DEV_PASSWORD`, `NEXT_PUBLIC_DEV_LOGIN_ENABLED`, `REDACT_ENV`) with one-line comments.

### Phase B — Schema migration
4. **Create two migration files** per Delta Design:
   - `supabase/migrations/20260504000001_wave1_brand_paused_enum.sql` — single statement: `alter type brand_auth_status add value if not exists 'paused';`
   - `supabase/migrations/20260504000002_wave1_agents.sql` — column additions + index (the rest of the original migration body).
   The split is mandatory because Postgres forbids `ALTER TYPE ... ADD VALUE` inside a transaction block.
5. **Apply migrations**: apply the enum-add migration first via Supabase Management API as a single-statement call (avoids transaction wrap), then apply the structural migration. `supabase db reset` locally handles both because the Supabase CLI commits each migration file independently. Use the Supabase PAT pattern from CLAUDE.local.md Seq 3.
6. **Regenerate types**: `supabase gen types typescript --local > lib/supabase/types.ts`. Commit.

### Phase C — Shared helpers
7. **Create** `lib/agents/_shared.ts` with `stripJsonFence`, `loadSkillPrompt`, `dailyBudgetGate`, `callAgentLLM`, plus `DEFAULT_PHARMACY_ID` + `AGENT_MODEL` constants. `dailyBudgetGate` includes an `OPENROUTER_API_KEY` precondition (exits with code 2 if unset) and robust empty-string parsing for `MAX_DAILY_CLAUDE_SPEND_USD` (empty-string env var falls back to default 50, not 0). Robustified during refactor.
8. **Refactor** `lib/agents/listing-agent.ts` to use `_shared.ts` helpers (fence-strip, skill load, budget gate). Behavior unchanged. The `dailyBudgetGate` swap also fixes a latent bug at `listing-agent.ts:51` where `Number(process.env.MAX_DAILY_CLAUDE_SPEND_USD ?? 50)` evaluated to `NaN` when the env var was empty-string (NaN >= anything is false → no cap enforcement). **Validate** with `npm run agent:listing` against cloud — output matches prior shape, claude_usage row created.

### Phase D — Memory-write helper
9. **Create** `lib/memory/write.ts` with `writeMemory(...)` per Delta Design. Idempotent on `(pharmacy_id, source, content)`.

### Phase E — Three new executors
10. **Create** `lib/executors/add-to-watchlist.ts`. Forward captures `prior_status` per product, updates to `watching`. Reverse restores from forwardResult.
11. **Create** `lib/executors/pause-brand.ts`. Forward upserts `brand_authorization` with `status='paused', paused_until, prior_status, notes=reason`. Reverse: if forward inserted, delete; if updated, restore prior status + clear `paused_until` + `prior_status`.
12. **Create** `lib/executors/flag-anomaly.ts`. Forward calls `writeMemory` per related_id with `kind='semantic'`, `metadata.anomaly_type/severity`. Reverse deletes those memory rows.
12b. **Create** `lib/executors/dismiss-briefing.ts` — no-op forward returning `{ dismissed: true }`, reverse returning `{ restored: true }`. Register in `lib/executors/index.ts`. (Fixes pre-existing bug — see "Pre-Existing Issues Surfaced" section.)
13. **Modify** `lib/executors/index.ts` — register all 4 new executors (`add_to_watchlist`, `pause_brand`, `flag_anomaly`, `dismiss_briefing`).

### Phase F — Bookkeeper
14. **Create** `lib/agents/bookkeeper.ts` per Delta Design. Reads orders / claude_usage / health_metrics / pending_listings for the prior UTC day. Empty-orders branch emits zero P&L. `proposed_actions = []`.
15. **Create** `scripts/bookkeeper.ts` (cron entry).
16. **Modify** `package.json` — add `agent:bookkeeper` script.

### Phase G — Reflector
17. **Create** `lib/agents/reflector.ts` per Delta Design. Reads last-7-day audit_log (filtered to rows targeting `inbox_items` excluding compensating `undo:*` rows — every approve/reject already targets inbox_items) + briefings + their inbox_items.state. Calls LLM with `reasoning: high`. Writes memory rows + summary briefing.
18. **Create** `scripts/reflector.ts`.
19. **Modify** `package.json` — add `agent:reflector` script.

### Phase H — Portfolio Manager
20. **Create** `lib/agents/portfolio-manager-output-adapter.ts` with the discriminated-union schema for `ProposedAction` and the full `PortfolioManagerOutputSchema`.
21. **Create** `lib/agents/portfolio-manager.ts` per Delta Design. Reads last-30d audit_log + briefings + products + top 50 memory rows by importance. Output adapter maps `strategic_moves[].proposed_action` to validated kernel actions; unmappable moves land in `data_snapshot.unmapped_moves[]`. Caps `proposed_actions.length ≤ 3`.
22. **Create** `scripts/portfolio-manager.ts`.
23. **Modify** `package.json` — add `agent:portfolio-manager` script.

### Phase I — Inbox UI grouping
24. **Modify** `components/inbox/timeline.tsx` — group by `source_agent` (latest-briefing-first ordering) then by day inside. Add `agentLabel()` mapping. Preserve existing empty-state branch.
24b. **Modify** `components/inbox/briefing-card.tsx:201-207` to label the reject-only button "Acknowledge" when `item.source_agent` is `bookkeeper` or `reflector` (always report-only), or when `item.source_agent` is `portfolio_manager` and `proposed_actions` is empty (informational-only week); otherwise keep "Dismiss":
    ```tsx
    {(() => {
      const isReportOnly =
        item.source_agent === 'bookkeeper' ||
        item.source_agent === 'reflector' ||
        (item.source_agent === 'portfolio_manager' && (!item.proposed_actions || item.proposed_actions.length === 0));
      return isReportOnly ? 'Acknowledge' : 'Dismiss';
    })()}
    ```
    Portfolio Manager briefings render "Acknowledge" only when all 3 strategic moves were informational (proposed_actions empty); otherwise the briefing has actionable buttons + a "Dismiss" for the reject path.
25. **Verify** `app/page.tsx` already passes `source_agent` through to `BriefingItem` (it does — `:107`); no change.
26. **Optional UX polish** (if time): collapse agent sections past 5 items behind a "show more" affordance. **Mark as nice-to-have**; don't block on it.

### Phase J — Render config
27. **Modify** `render.yaml` — add 3 cron services (bookkeeper / portfolio-manager / reflector), all `runtime: node`, `buildCommand: npm ci`, fromGroup `pharm1-shared`.

### Phase K — Verify
28. `npm run typecheck` passes (TypeScript strict).
29. `npm run lint` passes.
30. **Local agent runs** (against cloud Supabase) — execute each agent once via its `npm run agent:*` script:
    - Bookkeeper → 1 briefing with `data_snapshot.kind='daily_pnl'`, `proposed_actions=[]`. Inbox card renders Acknowledge button only.
    - Reflector demoable: produces ≥1 `strategic`-type briefing with `data_snapshot.kind = 'weekly_reflection'`; memory rows ≥0 depending on patterns found. On first run with empty audit_log, briefing summary explicitly states "first reflection — no patterns yet". Inbox card has reject-only Acknowledge.
    - Portfolio Manager → 1 briefing with `proposed_actions` (between 0 and 3 entries).
31. **Manual UI test on cloud**: sign in via dev-login, confirm inbox now groups by agent, click Approve on a Portfolio Manager `add_to_watchlist` move, verify `products.watchlist_status='watching'`, `audit_log` row, UndoBanner appears, click Undo → `prior_status` restored, compensating audit row written.
32. **Render deploy**: push commit, confirm 3 new cron services appear in Blueprint, manually trigger each cron from Render UI, verify briefing rows in Supabase Studio.

---

## Validation

### Automated
- `npm run typecheck` passes (TS strict).
- `npm run lint` passes.
- `supabase db reset` applies all 7 migrations cleanly.
- `npm run agent:bookkeeper`, `agent:reflector`, `agent:portfolio-manager` each exit 0 with summary log.
- Existing `npm run agent:listing` still passes (regression — refactor to `_shared.ts` must not break it).

### Manual (UI on cloud)
- Inbox shows agent sections (Bookkeeper, Reflector, Portfolio Manager, Listing Agent), each with day groupings inside.
- Bookkeeper card: P&L summary + "Acknowledge" only. Click → `state='dismissed'`.
- Reflector card: weekly reflection summary + "Acknowledge" only.
- Portfolio Manager card: 3 buttons (one primary "List on …" or "Pause Brand …" etc, plus two secondary). Click `add_to_watchlist` → `products.watchlist_status='watching'` + audit_log row + UndoBanner. Click Undo → status restored.
- Click `pause_brand` move → `brand_authorization.status='paused'` + UndoBanner + Undo restores `prior_status`.
- Click `flag_anomaly` move → memory rows inserted with `kind='semantic'` and `metadata.anomaly_type` set + UndoBanner + Undo deletes those memory rows.

### SQL spot-checks
```sql
-- After Bookkeeper run:
select id, source_agent, briefing_type, data_snapshot->>'kind' as kind, data_snapshot->>'net' as net
  from briefings where source_agent = 'bookkeeper' order by created_at desc limit 1;
-- expect: briefing_type='strategic', kind='daily_pnl', net is a number string

-- After Reflector run:
select kind, source, content from memory where source = 'reflector' order by created_at desc limit 5;

-- After Portfolio Manager run:
select source_agent, jsonb_array_length(proposed_actions) as actions, data_snapshot->>'kind' as kind
  from briefings where source_agent = 'portfolio_manager' order by created_at desc limit 1;
-- expect: actions in [0..3], kind='weekly_strategy'

-- After approve add_to_watchlist:
select id, watchlist_status from products where id = $product_id;
-- expect: watchlist_status='watching'
select action, target_entity_id, undo_window_expires_at, undone_at
  from audit_log where target_entity_type='inbox_items' order by created_at desc limit 1;
-- expect: action='add_to_watchlist', undo_window_expires_at ~30min future, undone_at null

-- After approve pause_brand:
select brand, status, paused_until, prior_status, notes
  from brand_authorization where pharmacy_id = $pid and brand = $brand;
-- expect: status='paused', paused_until=$until, prior_status set
```

---

## Pre-Existing Issues Surfaced (handled in this plan)

- **`dismiss_briefing` pseudo-action has no executor.** Listing agent emits `proposed_actions[].kind: 'dismiss_briefing'` for the "Skip" button (`lib/agents/listing-agent.ts:218-222`), but no executor with that kind is registered — clicking "Skip" would 500 out of `getExecutor(kind)`. Wave 1 fix: register a tiny `dismissBriefing` no-op executor in `lib/executors/index.ts`. Forward returns `{ dismissed: true }`; reverse returns `{ restored: true }`. Cost: ~15 LOC. Justification: we're already touching the registry to add three executors, so handling this pre-existing bug in the same commit is cheaper than leaving it open.

---

## Known Limitations

- **`flag_anomaly` undo is a no-op when forward was idempotent-skipped.** If `flag_anomaly` forward finds all memory rows already exist (idempotent skip in `writeMemory`), it pushes nothing into `memory_ids` and reverse becomes a no-op (`return { reverted: true, count: 0 }`). The compensating audit_log row still records the undo intent, so the audit trail is consistent. Acceptable for Wave 1; Wave 2 may add an `existed_already` discriminator if user-visible feedback ("nothing to undo — anomaly already flagged") becomes desirable.

---

## Open Questions

All resolved before implementation:
1. **P&L storage location** — RESOLVED: `briefings.data_snapshot` row, not new table. Justified in brief locked-decision 15.
2. **Anomaly flag storage** — RESOLVED: `memory` rows with `kind='semantic'`. Justified in brief locked-decision 16.
3. **briefing_type enum additions** — RESOLVED: not adding; use `strategic` + `data_snapshot.kind`.
4. **Memory-write idempotence key** — RESOLVED: `(pharmacy_id, source, content)` exact match.
5. **Reflector reasoning level** — RESOLVED: `'high'` (skill says Opus thinking_budget high).
6. **Portfolio Manager unmappable moves** — RESOLVED: surface in `data_snapshot.unmapped_moves[]`; emit no proposed action.
7. **`pause_brand` schema** — RESOLVED: add `paused` enum value + `paused_until` + `prior_status` columns; upsert by `(pharmacy_id, brand)`.
8. **Inbox grouping order** — RESOLVED: agent sections ordered by most-recent-briefing descending; day-bucket preserved inside.

---

## Deprecation

Nothing to remove. Wave 1 is purely additive aside from:
- The `tmp/ready-plans/2026-05-01-phase-2-layer-1-2-kernel-listing-agent.md` file moves to `tmp/done-plans/`.
- The fence-strip and skill-load code in `lib/agents/listing-agent.ts` is replaced by import from `_shared.ts`. No public API change.

---

## Confidence

**8.5/10** for one-pass implementation success.

**What raises confidence:**
- Listing-agent shape is proven and live. Three new agents mirror it exactly.
- Kernel (approve/reject/undo/audit) is unchanged — just registers 3 more executors.
- All schema infrastructure exists; the one migration is small (one enum-add + 2 nullable columns + 1 index).
- Skill prompts pre-authored.
- Sentry wiring already complete.
- Supabase Management API + cloud workflow proven (CLAUDE.local.md Seq 3).
- Output adapter for Portfolio Manager isolates the only "novel" pattern (free-form move → executor kind) behind a Zod-validated boundary.

**What lowers confidence:**
- Empty cloud orders/audit_log on first run — agents must handle empty-input gracefully. Plan covers this; reviewer should sanity-check the empty-input branches.
- `pause_brand` reverse logic differs by whether forward inserted or updated — bug magnet. Tests would help; manual click-through must cover both paths.
- Inbox grouping touches a tested file (`timeline.tsx`); easy to break day-bucket rendering. Plan keeps day-bucketing as a nested loop, but the styling diff needs a manual look.
- Cron schedule conflict: Render free-tier doesn't run cron jobs concurrently per plan, and three new crons join two existing weekly + listing crons. No conflict at the scheduled times we picked, but a daily Bookkeeper at 23 UTC overlaps if the Listing Agent at 13 UTC ever shifts. Document the schedule choices.
