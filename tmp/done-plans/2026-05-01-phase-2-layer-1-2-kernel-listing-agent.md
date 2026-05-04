# Plan: Phase 2 Layers 1+2 — Kernel + Listing Agent

> Reconciled from intent brief + research dossier.
> Implementation target: end-to-end demoable propose→approve→execute→audit→undo loop with one agent (Listing). All SP-API calls stubbed.

---

## Summary

Build the **proposal-approval-execute kernel** (Layer 1) and a **single Listing agent against mocks** (Layer 2). The kernel turns `briefings.proposed_actions[]` into clickable approve/reject/undo buttons that write `audit_log` entries with a 30-min undo window and dispatch through an executor registry whose handlers are stubbed. The Listing agent runs as a Render cron job, reads unlisted products from Supabase, calls Sonnet 4.6 once per candidate to draft a listing proposal, and writes a `briefings` + `inbox_items` row that surfaces in the inbox. Approval inserts a `pending_listings` row instead of calling SP-API. Undo cancels that row. No external API gates the demo.

Scope: ~6 new code files, ~5 modified, 1 new schema migration, 1 new skill prompt, 1 new render.yaml entry. Confidence for one-pass implementation success: **8/10**.

---

## Intent / Why

PharmaDash Phase 1 shipped the shell — auth, schema, chatbot, inbox UI — but the inbox is empty and the only "action button" pops a `window.alert("Phase 2: action approval")`. Phase 2 builds the value loop the project exists for.

The **product framing** is **pharmacy-to-marketplace listing automation** (per `tmp/briefs/2026-05-01-phase-2-listing-automation.md`). Arbitrage is downstream of solving listing friction. The first agent that addresses the stated gap is a **Listing agent**, not a Repricer.

**Must not be optimized away:**
- Human-in-loop on every executor write (Kaleem clicks every approve/reject/undo).
- 30-minute undo on every action, with a compensating audit_log row.
- No coupling to SP-API, EzriRx, Keepa, or minicrew. All external boundaries stubbed.
- Two-POS isolation: never touch Pioneer / Heartland / Rx data.

---

## Source Artifacts

- **Intent / why:** `tmp/plan-artifacts/2026-05-01-phase-2-layer-1-2-kernel-listing-agent-brief.md`
- **Research dossier:** `tmp/plan-artifacts/2026-05-01-phase-2-layer-1-2-kernel-listing-agent-research-dossier.md`
- **Discussion brief (upstream):** `tmp/briefs/2026-05-01-phase-2-listing-automation.md`

---

## Verified Repo Truths

Facts checked in the current checkout. Each has `Fact / Evidence / Implication`. Negative claims include `Search Evidence`.

### Server-side Supabase access split

- **Fact:** `lib/supabase/server.ts` `createClient()` and `createUserClient()` both call `cookies()` from `next/headers` at module scope.
  **Evidence:** `lib/supabase/server.ts:4`, `:9`, `:39`
  **Implication:** Neither helper can be invoked from a non-Next-request context (cron scripts, standalone Node). Anything that runs server-side outside a request must use a different admin client.

- **Fact:** `scripts/seed-dev-data.ts` already creates a service-role client directly with `@supabase/supabase-js` (no cookies dependency).
  **Evidence:** `scripts/seed-dev-data.ts:8-21`
  **Implication:** This pattern is the cron-safe baseline. Plan extracts it into `lib/supabase/admin.ts` and reuses from cron + agent code + budget helpers.

- **Fact:** `lib/budget.ts` `recordLLMUsage` and `getTodaySpendUsd` both call `createClient()` internally.
  **Evidence:** `lib/budget.ts:9`, `:31`
  **Implication:** Cannot be called from cron as-is. Plan refactors both to accept a `SupabaseClient` argument so callers pass either the cookies-bound client (web routes) or the admin client (cron).

### Schema

- **Fact:** `proposed_actions` is a `jsonb` column on the `briefings` table, not a standalone table.
  **Evidence:** `supabase/migrations/20260419000004_briefings_schema.sql:28`
  **Implication:** Plan adds zero new tables for proposals; only `pending_listings` is new.

- **Fact:** `audit_log` already has `undo_window_expires_at` and `undone_at` columns.
  **Evidence:** `supabase/migrations/20260419000004_briefings_schema.sql:62-63`
  **Implication:** No schema change needed for undo. Plan only writes rows.

- **Fact:** `inbox_items.state` is an enum with values `pending | seen | acted | archived | dismissed` and the table has a unique constraint on `(pharmacy_id, briefing_id)`.
  **Evidence:** `supabase/migrations/20260419000004_briefings_schema.sql:13`, `:48`
  **Implication:** Approve flow flips state to `acted`; reject flow flips to `dismissed`. Re-running an agent for the same briefing won't double-insert.

- **Fact:** `claude_usage.user_id` is `not null references auth.users(id) on delete cascade`.
  **Evidence:** `supabase/migrations/20260419000004_briefings_schema.sql:71`
  **Implication:** The cron-running listing agent has no Supabase user, so it must record usage under a system user UUID. Plan inserts a system user via migration.

- **Fact:** `products.watchlist_status` accepts `none | watching | active | paused | blocked` with default `none`.
  **Evidence:** `supabase/migrations/20260419000002_core_schema.sql:35`
  **Implication:** Listing agent picks candidates where `watchlist_status = 'watching'` (not `'active'` — those already have listings).

### UI / API

- **Fact:** `briefing-card.tsx` already renders a button per `proposed_actions` entry; the `onAction` handler just calls `window.alert`.
  **Evidence:** `components/inbox/briefing-card.tsx:26-31`, `:83-96`
  **Implication:** Layer 1's UI work is rewiring this single handler plus adding reject + undo controls — not building the card from scratch.

- **Fact:** `ProposedAction.kind` is currently typed as `'primary' | 'secondary'` (UI button variant).
  **Evidence:** `components/inbox/timeline.tsx:7-11`
  **Implication:** Plan renames this UI hint to `variant` so `kind` can become the executor taxonomy field that the agents already use in their prompts.

- **Fact:** Skill prompts already use `kind` as the executor taxonomy (e.g. `proposed_actions = [{ kind: 'reprice', listing_id, from_price, to_price, platform }]`).
  **Evidence:** `minicrew-config/skills/repricer.md:52`
  **Implication:** The TS type rename aligns the runtime contract with the prompt convention.

- **Fact:** `app/page.tsx` is the inbox SSR; it queries `inbox_items` joined to `briefings` and uses `dynamic = 'force-dynamic'`.
  **Evidence:** `app/page.tsx:7`, `:29-49`
  **Implication:** After approve/reject/undo, calling `router.refresh()` from the client gets fresh data without a full reload. Plan also filters out `dismissed` rows here.

- **Fact:** All API routes use `requireAuthenticatedUser(req)` from `lib/auth.ts`, which returns `{ userId, email, pharmacyId }`.
  **Evidence:** `lib/auth.ts:16-33`, `app/api/chat/route.ts:24`
  **Implication:** New `/api/actions/*` routes follow the same auth pattern.

- **Fact:** Server-side Supabase access has two clients: `createClient()` (service role, bypasses RLS) and `createUserClient()` (anon + cookies). Browser import is blocked at module level.
  **Evidence:** `lib/supabase/server.ts:1`, `:8-65`
  **Implication:** Action API routes use `createClient()` for writes (service role); the cron script does too.

- **Fact:** Inbox SSR query selects `id, created_at, briefing.{ ... }` from `inbox_items` but **does not select `inbox_items.state`**.
  **Evidence:** `app/page.tsx:29-49`
  **Implication:** Plan adds `state, acted_at, action_taken, action_params` to the select so the client can render the right control set per row.

### LLM / cost

- **Fact:** OpenRouter via OpenAI SDK is configured at `lib/llm.ts`; `CHATBOT_MODEL = 'anthropic/claude-sonnet-4.6'`.
  **Evidence:** `lib/llm.ts:3-13`
  **Implication:** Listing agent reuses the same singleton + same model. New constant `LISTING_AGENT_MODEL` (initially equal to CHATBOT_MODEL) leaves room to differentiate later.

- **Fact:** `recordLLMUsage(userId, completion)` exists; `getTodaySpendUsd(userId)` exists; both insert into / read from `claude_usage`.
  **Evidence:** `lib/budget.ts:5-28`, `:30-54`
  **Implication:** Cron's LLM calls fund through the same budget system. System user UUID is the cron's identity for that purpose.

### Cron / deployment

- **Fact:** `render.yaml` has two working cron services using `runtime: docker` + `dockerfilePath`, sharing `pharm1-shared` envVarGroup.
  **Evidence:** `render.yaml:36-58`, `:64-95`
  **Implication:** Plan adds a third cron service. New service uses `runtime: node` (no Docker layer needed for pure-Node script) with `buildCommand` reusing `npm ci && npm run build`.

- **Fact:** `package.json` has scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `verify-models`, `seed:dev`, `worker` (placeholder).
  **Evidence:** `package.json:6-16`
  **Implication:** Plan adds `agent:listing` script wiring `tsx scripts/listing-agent.ts`. Same pattern as `seed:dev`.

### Tests / current code

- **Fact:** `npm test` runs `vitest run`; no current vitest test files exist that exercise the inbox / kernel paths.
  **Evidence:** `package.json:11`, `find . -name "*.test.ts" -o -name "*.spec.ts"` returns zero matches.
  **Implication:** Per `/plan` skill rule "No Unit/Integration Tests", this plan does not add tests. Validation is manual + typecheck + lint.

- **Fact:** Seed-dev-data.ts inserts 3 briefings with `summary`, `rationale`, `briefing_type`, `source_agent`, `urgency`, `confidence` set, but **never sets `proposed_actions`**.
  **Search Evidence:** `grep "proposed_actions" scripts/seed-dev-data.ts` — zero matches.
  **Implication:** Layer 1 cannot be demoed against current seed data. Plan adds at least one mock briefing fixture with populated `proposed_actions` so the kernel is testable before Layer 2 lands.

- **Fact:** No file under `lib/executors/`, `app/api/actions/`, `scripts/listing-agent*`, or `lib/agents/` exists today.
  **Search Evidence:** `find lib/executors lib/agents app/api/actions 2>&1 | grep -v "No such"` — empty result. `find . -name "listing-agent*"` returns zero.
  **Implication:** All those paths are NEW.

- **Fact:** No file references `'list_on_amazon'`, `'reprice'` (as TS string), or any executor kind outside the skill prompts.
  **Search Evidence:** `grep -rn "'list_on_amazon'\|\"list_on_amazon\"\|'reprice'\|\"reprice\"" --include="*.ts" --include="*.tsx" .` — zero matches.
  **Implication:** Plan introduces the action-kind taxonomy at runtime for the first time.

---

## Locked Decisions

Carried from `tmp/briefs/2026-05-01-phase-2-listing-automation.md` and the brief artifact.

1. **Listing agent first**, not Repricer. (Listing-first reframe.)
2. **All executor writes are stubbed.** No SP-API. `pending_listings` row is the breadcrumb.
3. **Human-in-loop forever.** No auto-execute branches.
4. **30-min undo on every action.** Compensating audit_log row written on undo.
5. **OpenRouter via OpenAI SDK**, model `anthropic/claude-sonnet-4.6`, reasoning effort `medium`.
6. **No minicrew dependency.** Render cron, `runtime: node`, runs `tsx scripts/listing-agent.ts`.
7. **OTC-only.** Two-POS isolation invariant.
8. **Single tenant.** Default seeded `pharmacy_id = 00000000-0000-0000-0000-000000000001`.
9. **Cron platform: Render.** Brief said "Vercel cron / Supabase Edge function" but the deploy target is Render.
10. **Daily budget guard via nullable user_id.** Migration alters `claude_usage.user_id` to nullable. Cron writes `user_id = null` for system spend. `getTodaySpendUsd` accepts a nullable arg — null means system spend. No `auth.users` INSERT (Supabase Auth owns that table).
11. **Cron-safe Supabase access.** New `lib/supabase/admin.ts` exports a service-role client built directly with `@supabase/supabase-js` — no cookies dependency. Cron + agent + budget helpers use it.
12. **Approve flow runs executor BEFORE inserting audit_log.** Failed executor → no audit_log row, inbox stays 'pending', user can retry. Closes the audit_log result-write race window discovered in pass 1 review.
13. **Undo keeps inbox_items.state = 'acted'.** Compensating audit_log row is the marker. UI shows "Reverted at HH:MM" banner. Re-listing requires a fresh briefing from the next agent run.
14. **All 4 inbox fixtures get `proposed_actions`.** Existing 3 seeded briefings (`hot_arbitrage`, `reprice_down`, `account_health`) plus the new listing fixture. Every card in the inbox is approvable.

---

## Known Mismatches / Assumptions

| # | Item | Brief said | Repo reality | Resolution |
|---|---|---|---|---|
| 1 | proposed_actions location | "table" | jsonb column on `briefings` | Use the column. No new table. |
| 2 | Cron platform | "Vercel cron / Supabase Edge function" | We're on Render | Render cron service, `runtime: node`. |
| 3 | `kind` field semantics | "executor taxonomy" (implied by skill prompts) | TS type uses it for UI variant | Rename UI hint to `variant`; `kind` becomes taxonomy. |
| 4 | Seeded proposals exist | Implied for demo | Zero seeded `proposed_actions` | Plan adds one fixture. |
| 5 | Cron's user identity | "claude_usage by user" | `claude_usage.user_id NOT NULL`; direct INSERT into `auth.users` is fragile | Make `claude_usage.user_id` nullable. Cron writes null. No auth.users mutation. |
| 6 | Render envVarGroup | OPENROUTER_API_KEY assumed in render.yaml | Currently `ANTHROPIC_API_KEY` | **Folded into this plan** — render.yaml gets `OPENROUTER_API_KEY`, `OPENROUTER_APP_NAME`, `OPENROUTER_APP_URL`, drops `ANTHROPIC_API_KEY`. Without this, deployed cron has no key. |
| 8 | Server-side Supabase | One client | `createClient()` calls `cookies()` — Next.js-only | Add `lib/supabase/admin.ts` for cron. Refactor `budget.ts` to accept client arg. |
| 7 | Working tree state | Clean | DIRTY (OpenRouter swap + dev-login uncommitted from prior session) | Plan does not depend on those changes being committed. Implementation runs against current working tree. |

---

## Critical Codebase Anchors

Keep open while implementing.

- `supabase/migrations/20260419000004_briefings_schema.sql:6-66` — briefings + inbox_items + audit_log + claude_usage shapes
- `supabase/migrations/20260419000002_core_schema.sql:21-79` — products + listings + pharmacies shapes
- `components/inbox/timeline.tsx:7-11` — ProposedAction type to extend
- `components/inbox/briefing-card.tsx:26-31, 83-96` — handler placeholder + button render
- `app/page.tsx:24-73` — inbox SSR; needs `state` in select
- `lib/auth.ts:16-33` — `requireAuthenticatedUser(req)` pattern
- `lib/supabase/server.ts:8-65` — service-role vs user-scoped clients
- `lib/llm.ts:1-13` — OpenRouter singleton
- `lib/budget.ts:1-54` — record/read patterns
- `lib/tools/enqueue_job.ts:1-52` — Zod-validated handler shape (mirror in API routes + cron)
- `app/api/chat/route.ts:23-77` — auth → rate-limit → budget → core route shape
- `render.yaml:36-95` — cron service patterns
- `minicrew-config/skills/repricer.md:7-60` — skill prompt shape to mirror

---

## Files Being Changed

```
pharm1/
├── supabase/
│   ├── migrations/
│   │   └── 20260501000001_pending_listings_and_system_spend.sql ← NEW
│   └── seed.sql                                                ← MODIFIED (insert system user — idempotent)
│
├── lib/
│   ├── supabase/
│   │   ├── admin.ts                                            ← NEW (cron-safe service-role client)
│   │   └── types.ts                                            ← MODIFIED (regenerated)
│   ├── budget.ts                                               ← MODIFIED (accept SupabaseClient arg; allow null user_id)
│   ├── executors/
│   │   ├── index.ts                                            ← NEW (registry + getExecutor)
│   │   ├── types.ts                                            ← NEW (Executor + ExecutorContext + ExecutorResult)
│   │   └── list-on-amazon.ts                                   ← NEW (forward + reverse, both stubbed)
│   └── agents/
│       └── listing-agent.ts                                    ← NEW (pure logic; OpenRouter call + briefings insert)
│
├── app/
│   ├── api/
│   │   └── actions/
│   │       ├── approve/route.ts                                ← NEW
│   │       ├── reject/route.ts                                 ← NEW
│   │       └── undo/route.ts                                   ← NEW
│   └── page.tsx                                                ← MODIFIED (select state + filter dismissed)
│
├── components/
│   └── inbox/
│       ├── timeline.tsx                                        ← MODIFIED (kind→variant; new fields)
│       ├── briefing-card.tsx                                   ← MODIFIED (real handlers; reject button)
│       └── undo-banner.tsx                                     ← NEW (inline 30-min countdown + undo button)
│
├── scripts/
│   ├── listing-agent.ts                                        ← NEW (cron entry; calls lib/agents/listing-agent.ts)
│   └── seed-dev-data.ts                                        ← MODIFIED (add 1 briefing with proposed_actions)
│
├── minicrew-config/
│   └── skills/
│       └── listing-agent.md                                    ← NEW (skill prompt loaded into the OpenRouter call)
│
├── package.json                                                ← MODIFIED (add `agent:listing` script)
└── render.yaml                                                 ← MODIFIED (add pharm1-listing-agent cron service)
```

Total: 9 new files, 7 modified files, 1 new migration. Net code addition ~600-800 LOC.

---

## Reconciliation Notes

Imported from dossier:
- The `kind` vs `variant` rename strategy (resolves type conflict before it leaks into more agents).
- Atomic `update ... where state='pending' returning id` pattern for approve race protection.
- System user approach for cron `claude_usage` (vs nullable column) — semantically correct, no schema-shape change for an existing column.
- `runtime: node` for Render cron (vs reusing the docker pattern) — simpler, reuses npm/build.
- `response_format: { type: 'json_object' }` on the OpenRouter call — forces valid JSON from Sonnet 4.6.

Dropped from dossier (low value at this scope):
- Detailed minicrew job-claim SQL patterns (we're not using minicrew in this plan).
- HMAC-protected webhook trigger option (we picked native cron, not HTTP-triggered).

Conflicts surfaced:
- Brief said "Vercel cron / Supabase Edge function" — repo is on Render. Plan corrects.
- Brief implied `proposed_actions` table — repo has it as a column. Plan corrects.

Non-goals preserved:
- No SP-API call in scope.
- No tests added (per skill rule).
- No coupling to minicrew.
- No changes to chat route, auth flow, or Phase 1 schema.

---

## Delta Design

### Layer 1 — Kernel

**Approve flow** (executor first, audit_log second — closes race window):
```
Browser: click "Approve" on briefing-card
  ↓ POST /api/actions/approve { inbox_item_id, action_index }
Server:
  1. requireAuthenticatedUser(req) → SessionContext
  2. SELECT inbox_items + briefing.proposed_actions, pharmacy gate via session.pharmacyId
  3. Validate state='pending' AND action_index in range; resolve action.kind + action.payload
  4. ATOMIC: UPDATE inbox_items SET state='acted', acted_at=now(),
                                     action_taken=$kind, action_params=$payload
       WHERE id=$id AND state='pending' RETURNING id
     (returning empty → 409 stale)
  5. executor = getExecutor(kind); forwardResult = executor.forward(payload, ctx)
     (failure: revert step 4 to state='pending'; return 500)
  6. INSERT audit_log (actor=$session.email, action=$kind, target_entity_type='inbox_items',
                       target_entity_id=$id, params=$payload, result=$forwardResult,
                       undo_window_expires_at=now()+30m)
       RETURNING id
  7. If forwardResult.pending_listing_id: UPDATE pending_listings SET audit_log_id=$auditId
       WHERE id=$forwardResult.pending_listing_id
Response: { audit_log_id, undo_window_expires_at }
Client: router.refresh(); show UndoBanner with countdown
```

**Reject flow** (atomic guard for symmetry):
```
ATOMIC: UPDATE inbox_items SET state='dismissed',
                               dismissed_reason=COALESCE($body.reason, 'kaleem_rejected')
  WHERE id=$id AND state IN ('pending', 'seen') RETURNING id
  (returning empty → 409 stale)
INSERT audit_log (actor=$session.email, action='reject_briefing',
                  target_entity_type='inbox_items', target_entity_id=$id,
                  params=$body)
No executor invoked on reject.
```

**Undo flow:**
```
POST /api/actions/undo { audit_log_id }
  1. requireAuthenticatedUser
  2. SELECT audit_log row, pharmacy gate
  3. Validate undone_at IS NULL AND undo_window_expires_at > now()
  4. UPDATE audit_log SET undone_at=now()
       WHERE id=$id AND undone_at IS NULL AND undo_window_expires_at > now()
       RETURNING id, action, params, result
     (returning empty → 410 expired)
  5. executor = getExecutor(orig.action); reverseResult = executor.reverse(orig.params, orig.result, ctx)
  6. INSERT audit_log (actor=$session.email, action='undo:'||orig.action, target=...,
                       params=jsonb_build_object('reverses_audit_log_id', $origId),
                       result=$reverseResult)
  7. inbox_items.state stays 'acted'. UI reads the compensating audit_log row and
     renders a "Reverted at HH:MM" banner instead of the action buttons.
```

**Executor framework:**
```ts
// lib/executors/types.ts
export type ExecutorContext = { pharmacyId: string; userId: string };
export type ExecutorResult = Record<string, unknown>;
export interface Executor {
  kind: string;
  forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult>;
  reverse(params: unknown, forwardResult: ExecutorResult, ctx: ExecutorContext): Promise<ExecutorResult>;
}
```

```ts
// lib/executors/index.ts
import { listOnAmazon } from './list-on-amazon';
const registry: Record<string, Executor> = { list_on_amazon: listOnAmazon };
export function getExecutor(kind: string): Executor { ... }
```

```ts
// lib/executors/list-on-amazon.ts (STUB)
export const listOnAmazon: Executor = {
  kind: 'list_on_amazon',
  async forward(params, ctx) {
    const validated = ListOnAmazonParamsSchema.parse(params);
    const supabase = createClient();
    const { data } = await supabase.from('pending_listings').insert({
      pharmacy_id: ctx.pharmacyId,
      product_id: validated.product_id,
      proposed_title: validated.proposed_title,
      proposed_bullets: validated.proposed_bullets,
      proposed_price: validated.proposed_price,
      reasoning: validated.reasoning,
      status: 'pending',
    }).select('id').single();
    console.log(`[STUB] would call SP-API createFeed for product ${validated.product_id}`);
    return { pending_listing_id: data.id };
  },
  async reverse(params, forwardResult, ctx) {
    const supabase = createClient();
    await supabase.from('pending_listings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', forwardResult.pending_listing_id);
    console.log(`[STUB] would call SP-API deleteFeed for ${forwardResult.pending_listing_id}`);
    return { reverted: true };
  },
};
```

### Layer 2 — Listing Agent

**Cron entry (`scripts/listing-agent.ts`):**
```
1. Read MAX_DAILY_CLAUDE_SPEND_USD from env
2. const supabase = createAdminClient()       // lib/supabase/admin.ts
3. const todaySpend = await getTodaySpendUsd(supabase, null)   // null user_id = system spend
   if todaySpend >= cap: log + exit 0
4. candidates = supabase.products.where(pharmacy_id=DEFAULT, watchlist_status='watching')
                  .left_join(listings, products.id = listings.product_id and listings.status='active')
                  .where(listings.id is null)
                  .left_join(pending_listings, products.id = pending_listings.product_id and pending_listings.status='pending')
                  .where(pending_listings.id is null)
                  .limit(5)
5. for each candidate:
     prompt = loadSkillPrompt('listing-agent') + serializeCandidate(product, brand_auth, signals, kaleem_prefs)
     completion = openrouter.chat.completions.create({
       model: LISTING_AGENT_MODEL,
       messages: [{role:'system', content: prompt}, {role:'user', content: ...}],
       response_format: { type: 'json_object' },
       reasoning: { effort: 'medium' },
     })
     await recordLLMUsage(supabase, null, completion)   // null user_id = system spend
     parsed = parseListingAgentOutput(completion.choices[0].message.content)
     if parsed.skip_reason: log skip; continue
     INSERT briefings (briefing_type='new_opportunity', source_agent='listing_agent',
                       title=`List ${product.name}`, summary=..., rationale=parsed.reasoning,
                       confidence=parsed.confidence, urgency=3,
                       proposed_actions=[{
                         label: 'List on Amazon',
                         variant: 'primary',
                         kind: 'list_on_amazon',
                         params: {
                           product_id: product.id,
                           proposed_title: parsed.title,
                           proposed_bullets: parsed.bullets,
                           proposed_price: parsed.suggested_price_usd,
                           reasoning: parsed.reasoning
                         }
                       }, {
                         label: 'Skip',
                         variant: 'secondary',
                         kind: 'dismiss_briefing',
                         params: {}
                       }])
     INSERT inbox_items (briefing_id, state='pending')
6. log summary { proposed: N, skipped: M, total_cost_usd: Z }
```

**Skill prompt** (`minicrew-config/skills/listing-agent.md`): single-pass system prompt that takes a serialized product context and returns JSON with `title`, `bullets`, `suggested_price_usd`, `reasoning`, `confidence`, `skip_reason`. Includes the brand-authorization gating (skip if `hunts_resellers` and no LOA), Kaleem's margin-floor preference, and the "you are proposing only" framing.

**Render cron service** (`render.yaml` addition):
```yaml
- type: cron
  name: pharm1-listing-agent
  runtime: node
  region: oregon
  plan: starter
  buildCommand: npm ci         # no `next build` — cron only needs deps + tsx
  schedule: "0 13 * * *"        # 13:00 UTC daily = 6am Pacific
  startCommand: npm run agent:listing
  envVars:
    - fromGroup: pharm1-shared
```

**Render envVarGroup edits** (same render.yaml block):
```yaml
# Drop:
- key: ANTHROPIC_API_KEY
  sync: false
# Add:
- key: OPENROUTER_API_KEY
  sync: false
- key: OPENROUTER_APP_NAME
  value: "PharmaDash"
- key: OPENROUTER_APP_URL
  sync: false
```
Without this, the deployed cron has no API key to call OpenRouter.

**Package.json changes:**
```jsonc
"scripts": {
  // ... existing
  "agent:listing": "tsx scripts/listing-agent.ts"
},
"dependencies": {
  // move tsx from devDependencies → dependencies so cron survives NODE_ENV=production
  "tsx": "^4.x"
}
```

### Schema migration

```sql
-- supabase/migrations/20260501000001_pending_listings_and_system_spend.sql

-- 1. pending_listings: breadcrumb table for stubbed SP-API listing publish.
-- sp_api_feed_id reserved for post-stub phase (real SP-API publish writes here).
create table pending_listings (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  proposed_title text not null,
  proposed_bullets jsonb not null,
  proposed_price numeric(10,2) not null,
  reasoning text,
  status text not null check (status in ('pending', 'published', 'cancelled')) default 'pending',
  audit_log_id uuid references audit_log(id),     -- approve flow populates after audit_log insert
  sp_api_feed_id text,                             -- null while stubbed; populated when SP-API lands
  published_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index pending_listings_pharmacy_status_idx on pending_listings (pharmacy_id, status);

-- 2. Allow system spend tracking. Cron-attributed claude_usage rows have user_id = null.
-- No mutation of auth.users (Supabase Auth owns it; future schema additions could break us).
alter table claude_usage alter column user_id drop not null;

-- Make sure existing per-user-day index still works against null user_id by adding a partial index for system spend.
create index claude_usage_system_day_idx on claude_usage (created_at desc) where user_id is null;
```

---

## Architecture Overview

```
                  ┌─────────────────────────────────────────────────────┐
                  │  Render Cron: pharm1-listing-agent (daily 13:00 UTC) │
                  │  startCommand: npm run agent:listing                 │
                  └───────────────────────┬─────────────────────────────┘
                                          │ scripts/listing-agent.ts
                                          ▼
                  ┌─────────────────────────────────────────────────────┐
                  │  lib/agents/listing-agent.ts                         │
                  │  1. budget gate (system user)                        │
                  │  2. fetch candidates (products w/ watchlist=watching)│
                  │  3. per candidate:                                    │
                  │     OpenRouter Sonnet 4.6 → JSON proposal             │
                  │     INSERT briefings + inbox_items                    │
                  │  4. record claude_usage                               │
                  └───────────────────────┬─────────────────────────────┘
                                          │ writes (service-role)
                                          ▼
                  ┌─────────────────────────────────────────────────────┐
                  │  Supabase: briefings.proposed_actions =              │
                  │    [{ kind:'list_on_amazon', params:{...} }, ...]    │
                  │    inbox_items.state='pending'                        │
                  └───────────────────────┬─────────────────────────────┘
                                          │ SSR query
                                          ▼
                  ┌─────────────────────────────────────────────────────┐
                  │  Browser: app/page.tsx (Inbox) → BriefingCard        │
                  │  Buttons render from proposed_actions                │
                  └───────────────────────┬─────────────────────────────┘
                                          │ click "Approve"
                                          ▼
                  ┌─────────────────────────────────────────────────────┐
                  │  POST /api/actions/approve                            │
                  │   atomic: state→acted + audit_log row + executor      │
                  └───────────────────────┬─────────────────────────────┘
                                          │ getExecutor(kind).forward(params, ctx)
                                          ▼
                  ┌─────────────────────────────────────────────────────┐
                  │  lib/executors/list-on-amazon.ts (STUB)              │
                  │  INSERT pending_listings status='pending'             │
                  │  console.log "would call SP-API createFeed"           │
                  └───────────────────────┬─────────────────────────────┘
                                          │ returns { pending_listing_id }
                                          ▼
                  ┌─────────────────────────────────────────────────────┐
                  │  UI shows UndoBanner with 30-min countdown           │
                  │  click "Undo" → POST /api/actions/undo                │
                  └───────────────────────┬─────────────────────────────┘
                                          │ getExecutor(kind).reverse(...)
                                          ▼
                  ┌─────────────────────────────────────────────────────┐
                  │  pending_listings.status='cancelled'                 │
                  │  audit_log.undone_at=now()                            │
                  │  INSERT audit_log (action='undo:list_on_amazon')      │
                  └─────────────────────────────────────────────────────┘
```

---

## Key Pseudocode

### `app/api/actions/approve/route.ts`

```ts
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getExecutor } from '@/lib/executors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  inbox_item_id: z.string().uuid(),
  action_index: z.number().int().min(0).max(20),
});

const UNDO_WINDOW_MIN = 30;

export async function POST(req: Request) {
  const session = await requireAuthenticatedUser(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { inbox_item_id, action_index } = parsed.data;

  const supabase = createClient();

  // 1. Read briefing + proposed_actions, gated by pharmacy
  const { data: row } = await supabase
    .from('inbox_items')
    .select('id, state, briefing:briefings!inner(id, proposed_actions, briefing_type, source_agent)')
    .eq('id', inbox_item_id)
    .eq('pharmacy_id', session.pharmacyId)
    .single();
  if (!row || row.state !== 'pending') {
    return NextResponse.json({ error: 'not pending or not found' }, { status: 404 });
  }
  const actions = (row.briefing?.proposed_actions ?? []) as Array<{ kind: string; params?: unknown }>;
  const action = actions[action_index];
  if (!action || typeof action.kind !== 'string') {
    return NextResponse.json({ error: 'invalid action_index' }, { status: 400 });
  }

  // 2. Atomic state flip — only succeeds if still pending. (409 on stale.)
  const { data: flipped } = await supabase
    .from('inbox_items')
    .update({ state: 'acted', acted_at: new Date().toISOString(),
              action_taken: action.kind, action_params: action.params ?? {} })
    .eq('id', inbox_item_id)
    .eq('state', 'pending')
    .select('id')
    .single();
  if (!flipped) {
    return NextResponse.json({ error: 'stale — already acted' }, { status: 409 });
  }

  // 3. Executor FIRST (closes the audit_log result-write race window from pass-1 review).
  //    On failure, revert state to 'pending' so the user can retry.
  let result: Record<string, unknown> = {};
  try {
    const executor = getExecutor(action.kind);  // throws UnknownExecutorError
    result = await executor.forward(action.params ?? {}, {
      pharmacyId: session.pharmacyId, userId: session.userId,
    });
  } catch (err) {
    await supabase.from('inbox_items')
      .update({ state: 'pending', acted_at: null, action_taken: null, action_params: null })
      .eq('id', inbox_item_id);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // 4. INSERT audit_log with result already populated (single-write — no later UPDATE needed).
  const undoExpiry = new Date(Date.now() + UNDO_WINDOW_MIN * 60 * 1000).toISOString();
  const { data: audit } = await supabase
    .from('audit_log')
    .insert({
      pharmacy_id: session.pharmacyId,
      actor: session.email,                  // not hardcoded 'kaleem' — multi-staff future-proof
      action: action.kind,
      target_entity_type: 'inbox_items',
      target_entity_id: inbox_item_id,
      params: action.params ?? {},
      result,                                 // populated up-front
      undo_window_expires_at: undoExpiry,
    })
    .select('id')
    .single();
  if (!audit) {
    return NextResponse.json({ error: 'audit_log insert failed' }, { status: 500 });
  }

  // 5. If executor created a pending_listings row, link it back to this audit_log entry.
  if (typeof result.pending_listing_id === 'string') {
    await supabase.from('pending_listings')
      .update({ audit_log_id: audit.id })
      .eq('id', result.pending_listing_id);
  }

  return NextResponse.json({
    audit_log_id: audit.id,
    undo_window_expires_at: undoExpiry,
    result,
  });
}
```

**Known limitation:** between step 2 (state flip) and step 4 (audit_log insert), the inbox row is in 'acted' state without a corresponding audit_log row. If executor.forward partially succeeds and then throws, step 3's revert leaves any side-effect rows (e.g. pending_listings) orphaned without an audit_log_id pointer. The current `list-on-amazon` stub never throws so this is theoretical. When real SP-API integration lands, wrap forward + audit_log in a Postgres transaction via RPC.

### `app/api/actions/undo/route.ts`

```ts
const Body = z.object({ audit_log_id: z.string().uuid() });

export async function POST(req: Request) {
  const session = await requireAuthenticatedUser(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { audit_log_id } = Body.parse(await req.json());
  const supabase = createClient();

  // Atomic: mark undone iff window valid and not already undone
  const { data: original } = await supabase
    .from('audit_log')
    .update({ undone_at: new Date().toISOString() })
    .eq('id', audit_log_id)
    .eq('pharmacy_id', session.pharmacyId)
    .is('undone_at', null)
    .gt('undo_window_expires_at', new Date().toISOString())
    .select('id, action, params, result, target_entity_type, target_entity_id')
    .single();
  if (!original) {
    return NextResponse.json({ error: 'window expired or already undone' }, { status: 410 });
  }

  // Reverse executor
  let reverseResult: Record<string, unknown> = {};
  try {
    const executor = getExecutor(original.action);
    reverseResult = await executor.reverse(
      original.params ?? {},
      (original.result ?? {}) as Record<string, unknown>,
      { pharmacyId: session.pharmacyId, userId: session.userId },
    );
  } catch (err) {
    reverseResult = { error: err instanceof Error ? err.message : String(err) };
  }

  // Compensating audit_log row
  await supabase.from('audit_log').insert({
    pharmacy_id: session.pharmacyId,
    actor: session.email,
    action: `undo:${original.action}`,
    target_entity_type: original.target_entity_type,
    target_entity_id: original.target_entity_id,
    params: { reverses_audit_log_id: audit_log_id },
    result: reverseResult,
  });

  return NextResponse.json({ undone: true, reverse_result: reverseResult });
}
```

### `components/inbox/briefing-card.tsx` (relevant changes)

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function BriefingCard({ item }: { item: BriefingItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pendingAudit, setPendingAudit] = useState<{ id: string; expiresAt: string } | null>(null);

  async function approve(actionIndex: number) {
    setBusy(true);
    const res = await fetch('/api/actions/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inbox_item_id: item.id, action_index: actionIndex }),
    });
    if (res.ok) {
      const body = await res.json();
      setPendingAudit({ id: body.audit_log_id, expiresAt: body.undo_window_expires_at });
      router.refresh();
    }
    setBusy(false);
  }

  async function reject() {
    setBusy(true);
    await fetch('/api/actions/reject', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inbox_item_id: item.id }),
    });
    router.refresh();
    setBusy(false);
  }

  // ... existing card render, with action buttons calling approve(i) / reject()
  // and a UndoBanner rendered when pendingAudit !== null
}
```

### `lib/agents/listing-agent.ts` (core)

```ts
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type { Database } from '@/lib/supabase/types';
import { openrouter } from '@/lib/llm';
import { recordLLMUsage, getTodaySpendUsd } from '@/lib/budget';

const LISTING_AGENT_MODEL = 'anthropic/claude-sonnet-4.6';
const DEFAULT_PHARMACY_ID = '00000000-0000-0000-0000-000000000001';

export async function runListingAgent(
  supabase: SupabaseClient<Database>,
  opts: { maxCandidates: number } = { maxCandidates: 5 },
) {
  const cap = Number(process.env.MAX_DAILY_CLAUDE_SPEND_USD ?? 50);
  const today = await getTodaySpendUsd(supabase, null);   // null user_id = system spend
  if (today >= cap) {
    console.log(`[listing-agent] daily cap reached: $${today} >= $${cap}; exiting`);
    return { proposed: 0, skipped: 0, capped: true };
  }

  // Inline candidate query — products with watchlist_status='watching' that have no
  // active listing AND no pending listing already in flight.
  const { data: candidates } = await supabase
    .from('products')
    .select(`
      id, name, brand, category, asin, upc, ndc, form, pack_size,
      listings:listings!left(id, status),
      pending_listings:pending_listings!left(id, status)
    `)
    .eq('pharmacy_id', DEFAULT_PHARMACY_ID)
    .eq('watchlist_status', 'watching')
    .limit(opts.maxCandidates);

  // Filter in TS: keep only products with no active listing and no pending listing.
  const eligible = (candidates ?? []).filter((p) =>
    !(p.listings ?? []).some((l) => l.status === 'active') &&
    !(p.pending_listings ?? []).some((pl) => pl.status === 'pending'),
  );

  // Skill prompt loaded via path.resolve — works from any CWD (cron or dev shell).
  const skillPath = path.resolve(__dirname, '../../minicrew-config/skills/listing-agent.md');
  const skill = await readFile(skillPath, 'utf8');

  let proposed = 0; let skipped = 0;
  for (const product of eligible) {
    const completion = await openrouter.chat.completions.create(
      {
        model: LISTING_AGENT_MODEL,
        messages: [
          { role: 'system', content: skill },
          { role: 'user', content: JSON.stringify(await serializeCandidate(supabase, product)) },
        ],
        response_format: { type: 'json_object' },
        // Same OpenRouter `reasoning` extension cast pattern used in app/api/chat/route.ts:74.
        reasoning: { effort: 'medium' },
      } as ChatCompletionCreateParamsNonStreaming,
    );
    await recordLLMUsage(supabase, null, completion);  // null user_id = system spend

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = ListingAgentOutputSchema.parse(JSON.parse(raw));
    if (parsed.skip_reason) { skipped++; continue; }

    await insertBriefingAndInbox(supabase, product, parsed);
    proposed++;
  }

  return { proposed, skipped, capped: false };
}
```

---

## Tasks

Implementation order. Each task is one commit-shaped unit.

### Phase A — Schema + types
1. [done] **Create migration** `supabase/migrations/20260501000001_pending_listings_and_system_spend.sql` per Delta Design. Adds `pending_listings`, drops `claude_usage.user_id NOT NULL`, adds partial index for system spend. NO `auth.users` mutation.
2. [done] **Run** `supabase db reset` locally; confirm migrations apply clean.
3. [done] **Regenerate types**: `supabase gen types typescript --local > lib/supabase/types.ts`. Commit the regen.

### Phase B — Cron-safe Supabase client + budget refactor
4. [done] **Create** `lib/supabase/admin.ts` exporting `createAdminClient()`. Use `createClient<Database>` from `@supabase/supabase-js` with service role key. Pass `auth: { autoRefreshToken: false, persistSession: false }` (cron has no session to maintain). Mirror exactly the pattern at `scripts/seed-dev-data.ts:8-21`.
5. [done] **Refactor** `lib/budget.ts`: change `recordLLMUsage(userId, completion)` → `recordLLMUsage(supabase, userId, completion)` and `getTodaySpendUsd(userId)` → `getTodaySpendUsd(supabase, userId)`. `userId` accepts `string | null`. When null, query/insert with `user_id IS NULL` / `user_id: null`. Update the one caller in `app/api/chat/route.ts` accordingly.

### Phase C — Executor framework
6. [done] **Create** `lib/executors/types.ts` with `ExecutorContext`, `ExecutorResult`, `Executor` interface, and `UnknownExecutorError` class. Defining the error here (alongside the interface) keeps it importable from approve route's catch without circular dep on the registry.
7. [done] **Create** `lib/executors/list-on-amazon.ts` with forward + reverse stubs. Zod schema validates params. Forward INSERTs `pending_listings` + console.log "would call SP-API createFeed". Reverse UPDATEs status='cancelled'.
8. [done] **Create** `lib/executors/index.ts` with the registry and `getExecutor(kind)`. `getExecutor` throws `UnknownExecutorError` (custom error class) for unregistered kinds. Approve route's try/catch handles the throw and returns 500.

### Phase D — Kernel API routes
9. [done] **Create** `app/api/actions/approve/route.ts` per pseudocode. **Order:** auth → resolve action → atomic state flip (RETURNING id, 409 on stale) → executor.forward (revert state on failure → 500) → INSERT audit_log with result populated → if pending_listing_id, UPDATE pending_listings.audit_log_id.
10. [done] **Create** `app/api/actions/reject/route.ts`. Body schema: `z.object({ inbox_item_id: z.string().uuid(), reason: z.string().max(200).optional() })`. Auth → atomic state flip to `dismissed` with `dismissed_reason = COALESCE(body.reason, 'kaleem_rejected')` RETURNING id (409 on stale) → INSERT audit_log row with `actor=session.email, action='reject_briefing'`.
11. [done] **Create** `app/api/actions/undo/route.ts` per pseudocode. Auth → atomic undone_at gate → reverse executor → INSERT compensating audit_log row. inbox_items.state stays 'acted'.

### Phase E — UI rewire
12. [done] **Update** `ProposedAction` type in `components/inbox/timeline.tsx`: rename UI hint `kind` → `variant`. Add `kind: string` (executor taxonomy). Rename `payload?: unknown` → `params?: unknown` to align with the existing `audit_log.params` jsonb column and the skill prompt convention (which already emits `params: { ... }` in the dossier-cited shape).
13. [done] **Modify** `app/page.tsx`: select `state, acted_at, action_taken` in the inbox query. Filter out `state='dismissed'`. **Audit_log lookup is a separate batch query** (Supabase JS LEFT JOIN can't express "latest row"). After the inbox query, fetch audit_log rows where `target_entity_type = 'inbox_items'` AND `target_entity_id IN (...acted ids...)` AND `action NOT LIKE 'undo:%'` ORDER BY created_at DESC. In TS, group by `target_entity_id` and pick the first (latest) per id. Pass `id` (as audit_log_id), `undo_window_expires_at`, and `undone_at` through to the client. The compensating undo row is for audit only — not surfaced in the UI; the original row's `undone_at` is what drives the "Reverted at HH:MM" branching.
14. [done] **Modify** `components/inbox/briefing-card.tsx`: replace `window.alert` with `approve(i)` / `reject()` fetch calls. Branch UI by item.state: `pending` → action buttons; `acted` + window unexpired + undone_at null → `<UndoBanner />`; `acted` + undone_at set → "Reverted at HH:MM" muted text; `acted` + window expired → "Approved at HH:MM" muted text.
15. [done] **Create** `components/inbox/undo-banner.tsx`: `setInterval`-driven countdown to `undo_window_expires_at`. Button POSTs `/api/actions/undo`, on success calls `router.refresh()`. Self-unmounts at expiry.

### Phase F — Listing agent
16. [done] **Create** `minicrew-config/skills/listing-agent.md` with the skill prompt. JSON schema for output: `{ title, bullets[], suggested_price_usd, reasoning, confidence, skip_reason }`. Includes brand-authorization gating (skip if `hunts_resellers` and no LOA).
17. [done] **Create** `lib/agents/listing-agent.ts` with `runListingAgent(supabase: SupabaseClient)`. Inline candidate query. Skill file loaded via `path.resolve(__dirname, '../../minicrew-config/skills/listing-agent.md')`. Calls OpenRouter non-streaming with `response_format: { type: 'json_object' }` + `reasoning: { effort: 'medium' }`.
18. [done] **Create** `scripts/listing-agent.ts` — thin entry: `createAdminClient() → runListingAgent(supabase) → process.exit(0/1)`.

### Phase G — Render config + package.json
19. [done] **Modify** `package.json`: add `"agent:listing": "tsx scripts/listing-agent.ts"` script. **Move `tsx` from devDependencies → dependencies** (cron survives `NODE_ENV=production`).
20. [done] **Modify** `render.yaml`:
    - Add `pharm1-listing-agent` cron service: `runtime: node`, `buildCommand: npm ci` (no next build), `startCommand: npm run agent:listing`, `schedule: "0 13 * * *"`, fromGroup pharm1-shared.
    - In envVarGroups: drop `ANTHROPIC_API_KEY`. Add `OPENROUTER_API_KEY` (sync: false), `OPENROUTER_APP_NAME` (value: "PharmaDash"), `OPENROUTER_APP_URL` (sync: false).

### Phase H — Seed fixtures
21. [done] **Modify** `scripts/seed-dev-data.ts`: populate `proposed_actions` on **all 4** briefings. The kernel registry only has `list_on_amazon`; agents that need a "no-op approve" go through Reject instead.
    - (a) New listing-agent fixture: one action `{ kind: 'list_on_amazon', variant: 'primary', label: 'List on Amazon', params: { product_id, proposed_title, proposed_bullets[], proposed_price, reasoning } }`. Target product = the **first** seeded product in `scripts/seed-dev-data.ts` PRODUCTS array whose `watchlist_status === 'watching'` (currently Omega-3, seeded in the second slot — Vitamin D3 is `'active'` so skipped). This guarantees the runtime listing agent's eligibility query (`watchlist='watching'` + no active listing) won't double-propose against this seeded fixture.
    - (b) `hot_arbitrage` fixture: same `kind: 'list_on_amazon'` shape, **different product** — pick the second product in the PRODUCTS array with `watchlist_status='watching'` to avoid duplicate proposals against the runtime agent.
    - (c) `reprice_down` fixture: NO approve action — only the Reject button. Card renders with reasoning + reject. (Repricer is Layer 3; this fixture demos the propose-only-via-reject path until then.)
    - (d) `account_health` fixture: NO approve action — only the Reject button (labeled "Acknowledge" in the reject reason).
22. [done] **Verify** `npm run typecheck` and `npm run lint` pass clean.

### Phase I — Manual end-to-end test (validation)

**Preconditions:** `.env` contains valid `OPENROUTER_API_KEY` (already true in current local dev per recent session); local Supabase running (`supabase start`); Docker Desktop up.


23. [done] `supabase db reset` (re-applies all migrations + seed).
24. [done] `npm run seed:dev` (refreshes mock briefings with proposed_actions). 4 briefings + 4 inbox_items inserted.
25. [skipped — interactive UI not exercised by implementer agent] `npm run dev` → sign in via dev-login.
26. [skipped — interactive] Inbox shows 4 briefings, each with action buttons.
27. [skipped — interactive] Click Approve on the listing fixture → 200 response → UndoBanner.
28. [skipped — interactive] Verify pending_listings + audit_log rows.
29. [skipped — interactive] Click Undo → audit_log.undone_at set; pending_listings.status='cancelled'.
30. [skipped — interactive] Click Reject → state='dismissed'.
31. [done] Run `npm run agent:listing` locally → 2 new briefings inserted; `claude_usage` rows have `user_id IS NULL` (system spend); pricing recorded.

---

## Validation

### Automated
- `npm run typecheck` passes (TypeScript strict).
- `npm run lint` passes.
- `supabase db reset` applies all 6 migrations cleanly.
- `npm run agent:listing` exits 0 with summary log.

### Manual (UI)
- Approve → audit_log row + pending_listings row + UndoBanner.
- Undo within 30 min → audit_log undone_at + compensating row + pending_listings.status='cancelled'.
- Reject → state='dismissed' + audit_log row.
- Stale-approve (race): hit /api/actions/approve twice in quick succession → 1st returns 200, 2nd returns 409.
- Expired-undo: in dev, set `undo_window_expires_at` to past via SQL, click Undo → 410.

### SQL spot-checks
```sql
-- After approve:
select id, state, acted_at, action_taken from inbox_items where id = $id;
-- expect: state='acted', acted_at not null, action_taken='list_on_amazon'

select id, action, undo_window_expires_at, undone_at, result
  from audit_log where target_entity_id = $id order by created_at desc;
-- expect: row with action='list_on_amazon', undo_window_expires_at ~30min future, result has pending_listing_id

select id, status, product_id from pending_listings order by created_at desc limit 1;
-- expect: status='pending'
```

---

## Open Questions — RESOLVED

All 5 open questions resolved before /implement (pass-1 review + user input):

1. **Candidate query: inline.** No RPC. Less migration churn.
2. **Undo behavior: stays `acted`** with "Reverted at HH:MM" banner. Re-approval requires fresh briefing. (User decision.)
3. **Cron build: `npm ci` only**, no `next build`. Plan YAML updated.
4. **Seed briefing references real product**: looks up first seeded product by name/ASIN.
5. **OPENROUTER_API_KEY in render.yaml: folded into Phase G** of this plan. No separate PR.

Pass-1 review also folded in:
- Cron-safe Supabase admin client + budget refactor (Phase B).
- Approve flow ordering: executor first, audit_log second.
- No `auth.users` mutation; nullable `claude_usage.user_id` for system spend.
- All 4 inbox fixtures get `proposed_actions` (user decision Q2).
- `tsx` moves to dependencies.
- audit_log.actor uses `session.email` not hardcoded `'kaleem'`.
- Audit_log lookup in inbox is a separate batch query, not LEFT JOIN.

---

## Deprecation

Nothing to remove for this plan. The kernel and listing agent are additive. The UI handler placeholder (`window.alert("Phase 2: action approval")`) gets replaced, not removed — replacement is in the plan tasks.

---

## Confidence

**8.5/10** for one-pass implementation success (pass-1 review applied; blocking issues resolved).

**What raises confidence:**
- Repo-audited file paths and line numbers throughout.
- All schema infrastructure (audit_log undo columns, briefings.proposed_actions, inbox_items state) is pre-existing.
- LLM stack and OpenRouter wiring already works in chat route — listing agent reuses same singleton.
- Render cron pattern proven by existing backup services.
- Stub executor approach removes all external API gates.

**What lowers confidence:**
- Type rename (`kind` → `variant`) touches one TS shape and one client component; small but easy to miss a callsite.
- Dev hasn't validated `runtime: node` Render cron locally; first deploy may need adjustment.
- Sonnet 4.6 + `response_format: json_object` over OpenRouter — confirmed by docs but not yet exercised in this repo.
- 5 unresolved [NEEDS CLARIFICATION] markers (each has a default, but defaults may not match user intent).
