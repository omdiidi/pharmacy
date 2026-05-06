# Phase 2 Hardening — Fix all 50 verified findings from /codex-review

> **Source brief:** `tmp/briefs/2026-05-04-phase-2-hardening-fixes.md` (50 verified findings, file:line evidence).
> **Run model:** 4 sequential `/implement` calls, one per phase, with smoke-test gate between commits. Each phase section below is its own implementer scope.
> **Confidence:** 8.5/10 after pass 1 review incorporated.

---

## Pass 2 review changes incorporated (latest)

- **`claim_cron_lock` correctness (Pass 2 BLOCKER #1):** RETURNING-based claim detection (compare worker_id vs caller) — `INSERT ... ON CONFLICT DO UPDATE WHERE expires_at < now() RETURNING worker_id` then `worker_id = caller`. The plpgsql `FOUND` was wrong on conflict-skip.
- **LWA token cache concurrency (Pass 2 BLOCKER #2):** dropped `pg_try_advisory_lock` (not callable via PostgREST RPC; PgBouncer releases it immediately). Uses `lwa_token_refreshes(started_at PK)` lease table with `INSERT ON CONFLICT DO NOTHING RETURNING` — only the winner refreshes, rest read-back-after-200ms.
- **`orders.status` migration data correctness (Pass 2 HIGH #3):** replaced `lower(status)` with explicit `CASE` map for SP-API CamelCase compounds (`'PartiallyShipped' → 'partially_shipped'`, etc.) + precheck DO block.
- **Account-health emit-then-approve compensation (Pass 2 HIGH #4):** wrapped each loop iteration in try/catch; on `approveOne` failure, mark `inbox_items.dismissed_reason = 'system_executor_failed'` so digest can surface it.
- **`approve_audit_atomic` server-side allowlist (Pass 2 #5):** added `if p_pending_table not in (allowlist) raise exception`.
- **P3.10 atomic-throw removed (Pass 2 HIGH #6):** swapped throw-on-5-fails with Sentry escalation only — avoid feedback loop with P3.5 webhook 5xx + SP-API replay.
- **`recordLLMUsage` signature (Pass 2 HIGH #7):** options-object form `recordLLMUsage(supabase, completion, { userId, pharmacyId })` with both fields optional. P3.10 + P4.13 both edit this; explicit per-phase shape change documented.
- **Phase 4 split (Pass 2 #8):** divided into Phase 4a (migration + cred-gate factories + sanitization, P4.1–P4.8) and Phase 4b (rejectOne wiring + cleanup + Zod loosen + tool unification, P4.9–P4.16). Two `/implement` calls instead of one.
- **`lib/auth-rate-limit.ts` RENDER_INSTANCE_COUNT warning** added (Phase 1).
- **Open Question 2 (atomic budget claim) deferred-math** corrected: `<$5/day worst case, expected <$10/year given median load`.
- **`search_memory.ts` defense-in-depth comment** added as P4b task.
- **`actor_kind` enum** kept at `('human', 'system')`; clarified `actor_label` is the durable signal — single comment in plan + CLAUDE.md update at end.
- **`audit_log.actor_user_id` column** removed from claim list (was misleading; not in migration). Existing `actor` text col carries email; `actor_kind` carries discriminator.
- **`seed-dev-data.ts` watchlist_status union update** added to P4a tasks.
- **Sentry import discipline note** added: Phase 2 uses `import { Sentry } from '@/lib/logger'` directly; `lib/observability.ts` helpers are Phase 3.
- **P2.7 race test** replaced with programmatic concurrent-approve test (no PSQL access required).

---

## Pass 1 review changes incorporated

- **Kernel:** kept claim-then-execute ordering (do NOT invert). RPC wraps post-executor audit-insert only.
- **Webhook timestamp:** read `NotificationMetadata.PublishTime` from envelope; dropped fabricated `x-pharm1-timestamp` header.
- **Phase 1 rate limit:** in-process LRU only (no DB). DB-backed rate-limit deferred to Phase 3.
- **Cron locks:** `cron_locks` table (TTL heartbeat) replaces session-bound advisory locks (PostgREST releases them too early).
- **Twilio:** dropped non-existent SDK `idempotencyKey`; added `sms_sends(briefing_id PK, sid)` caller-side dedupe.
- **Migration files:** split per phase: `20260505000001_phase2_kernel.sql`, `20260505000002_phase3_observability.sql`, `20260505000003_phase4_constraints.sql`.
- **NOT NULL on pending_purchase_orders:** precheck `count(*) WHERE NULL` before SET NOT NULL; fail loud with remediation if non-zero.
- **EDI / SP-API messaging:** added `EZRIRX_REAL_CLIENT_READY` and `SP_API_MESSAGING_REAL_CLIENT_READY` opt-in env flags. Cred-gate stays on fixture even if creds populate, until ready-flag set. Drop the silent fixture-fallback.
- **System actor:** added `audit_log.actor_kind text not null default 'human'` discriminated column + nullable `actor_user_id`. Auto-pause writes `actor_kind='system'`, `actor_label='account_health'`. Daily Digest filters `actor_kind != 'system'`.
- **Auto-pause briefings:** `briefings.auto_executed boolean default false` so Daily Digest skips them.
- **claude_usage.pharmacy_id backfill:** JOIN-driven via `user_pharmacy_access`, not hardcoded UUID.
- **Atomic budget claim:** deferred (Phase 2 single-tenant; race window <$50/year). Documented in fix-laters.
- **Drop:** `lib/llm.ts` from modified list (no actual change). Phantom F5 reference. M3/M6/M7 invented labels.
- **Add:** purge crons for `rate_limit_events` + `webhook_dedupe` (1h + 24h TTL).
- **captureRouteError split:** `captureRouteWarning` (level: warning) vs `captureRouteFatal` (level: error).
- **orders_status_check:** moved to Phase 4 (after fulfillment-ops normalizer ships in same phase).
- **Cron scripts:** `process.exit(1)` in outer catch blocks replaced with `Sentry.flush(2000).then(() => process.exit(1))`.
- **LRU rate-limit fallback:** Sentry warning at module-load if `RENDER_INSTANCE_COUNT > 1`.
- **`lwa_token_cache` cold-start:** PG advisory lock around refresh call to prevent N-replica concurrent refresh.

---

## Architecture (post-fix)

```
                                        Phase 1 commit (auth gates)
┌──────────────────────────────────────────────────────────────────────┐
│  app/api/auth/dev-login/route.ts: fail-fast on weak/missing pwd,     │
│    strict gate (NODE_ENV check && opt-in only), no password clobber, │
│    in-process LRU rate-limit (no DB).                                │
│  middleware.ts: JSON 401 on /api/* paths.                            │
│  render.yaml: DEV_PASSWORD slot sync:false.                          │
│  lib/agents/account-health.ts: refuse-to-flip-red when SMS unproven. │
└──────────────────────────────────────────────────────────────────────┘
                                        Phase 2 commit (kernel correctness)
┌──────────────────────────────────────────────────────────────────────┐
│  Migration 20260505000001_phase2_kernel.sql:                         │
│    + approve_audit_atomic function (post-executor wrap)              │
│    + reject_action_atomic function                                   │
│    + audit_log.actor_kind/actor_label cols                           │
│    + briefings.auto_executed flag                                    │
│    + audit_log undo-active partial index                             │
│  lib/kernel/approve.ts: keep claim-then-execute; RPC wraps audit-    │
│    insert + back-link only. Single UNDO_WINDOW_MIN const.            │
│  lib/kernel/reject.ts ← NEW.                                         │
│  app/api/actions/undo/route.ts: reverse-first then mark undone.      │
│  lib/agents/account-health.ts: route auto-pause through approveOne   │
│    with actor_kind='system', actor_label='account_health'.           │
└──────────────────────────────────────────────────────────────────────┘
                                        Phase 3 commit (observability + cost)
┌──────────────────────────────────────────────────────────────────────┐
│  Migration 20260505000002_phase3_observability.sql:                  │
│    + webhook_dedupe table + purge_webhook_dedupe() function          │
│    + rate_limit_events table + purge_rate_limit_events() function    │
│    + cron_locks (TTL heartbeat pattern)                              │
│    + jobs.pharmacy_id + submitted_by                                 │
│    + claude_usage.pharmacy_id (with JOIN-driven backfill)            │
│  lib/observability.ts ← NEW: withSentry, captureRouteWarning,        │
│    captureRouteFatal.                                                │
│  lib/cron-lock.ts ← NEW: claimCronLock, releaseCronLock,             │
│    withCronLock (table-based, not advisory).                         │
│  Webhook: NotificationMetadata.PublishTime check (5 min skew),       │
│    dedupe via webhook_dedupe table, 5xx-on-agent-error.              │
│  lib/agents/_shared.ts: AbortSignal w/ 60s timeout, throw not exit.  │
│  Crons: withSentry → withCronLock → run() wrapper.                   │
│  lib/rate-limit.ts: string-key, fail-closed + LRU fallback.          │
│  Action routes: rate-limit (60/min/user).                            │
│  Render Cron Jobs: pharm1-rate-limit-purge (hourly),                 │
│    pharm1-webhook-dedupe-purge (daily).                              │
└──────────────────────────────────────────────────────────────────────┘
                                        Phase 4 commit (cred-gate + cross-layer)
┌──────────────────────────────────────────────────────────────────────┐
│  Migration 20260505000003_phase4_constraints.sql:                    │
│    + pending_purchase_orders precheck + NOT NULL + CHECK             │
│    + orders.platform CHECK + orders.status normalize + CHECK         │
│    + lwa_token_cache singleton table                                 │
│    + sms_sends(briefing_id PK, sid) dedupe                           │
│    + products.watchlist_status: drop+recreate CHECK with 'evaluating'│
│    + drop unique-where-not-null partial index made redundant by NN   │
│  lib/env-gate.ts ← NEW: sanitized + ready-flag combined check.       │
│  Cred-gate factories: env-gate + REAL_CLIENT_READY opt-in flag.      │
│  lib/sp-api/{client,auth,messaging}.ts: Retry-After, shared LWA      │
│    cache w/ advisory-lock-around-refresh, NotImplementedError.       │
│  lib/edi/{_real,index}.ts: env-gate, NotImplementedError.            │
│  lib/keepa/client.ts: real bucket, exempt /token, refillIn read.     │
│  lib/sms/twilio.ts: E.164 + sms_sends dedupe.                        │
│  lib/voyage/embed.ts: array + dim guards.                            │
│  lib/orders/status.ts ← NEW: canonical normalizer.                   │
│  lib/agents/fulfillment-ops.ts: normalize-on-write + NotImpl catch.  │
│  lib/kernel/reject.ts wired to reject route + dismiss_all_briefings. │
│  lib/tools/enqueue_job.ts: stamp pharmacy_id + submitted_by.         │
│  lib/agents/bookkeeper.ts: pharmacy_id filter on claude_usage.       │
│  lib/tools/*.ts: ToolContext type unification.                       │
│  lib/executors/flag-anomaly.ts: pharmacy_id scope on reverse delete. │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Files Being Changed

```
app/
├── api/
│   ├── auth/dev-login/route.ts                     ← MOD (P1)
│   ├── actions/{approve,reject,undo}/route.ts      ← MOD (P2 undo, P3 rate, P4 reject)
│   ├── chat/route.ts                               ← MOD (P3 Sentry)
│   └── sp-api/webhook/route.ts                     ← MOD (P3 dedupe + 5xx + Sentry)
middleware.ts                                       ← MOD (P1 JSON 401)
lib/
├── kernel/
│   ├── approve.ts                                  ← MOD (P2: post-executor RPC, all-table back-link)
│   └── reject.ts                                   ← NEW (P2 created, P4 wired)
├── auth-rate-limit.ts                              ← NEW (P1: in-process LRU only)
├── observability.ts                                ← NEW (P3)
├── cron-lock.ts                                    ← NEW (P3)
├── env-gate.ts                                     ← NEW (P4)
├── orders/status.ts                                ← NEW (P4)
├── rate-limit.ts                                   ← MOD (P3: string-key, fail-closed, LRU)
├── budget.ts                                       ← MOD (P3 throw on persistent fail; P4 pharmacy_id)
├── agents/
│   ├── _shared.ts                                  ← MOD (P3: timeout, throw, withSentry)
│   ├── account-health.ts                           ← MOD (P1 SMS gate, P2 approveOne route, P3 Zod try, P4 schema loosen)
│   ├── customer-success.ts                         ← MOD (P3 Zod try)
│   ├── bookkeeper.ts                               ← MOD (P3 Zod try, P4 tenant filter)
│   ├── portfolio-manager.ts                        ← MOD (P3 Zod try)
│   ├── reflector.ts                                ← MOD (P3 Zod try, weekEnd normalize)
│   ├── repricer.ts                                 ← MOD (P3 extractAsinFromEvent fix)
│   ├── research-analyst.ts                         ← MOD (P4 urgency transform)
│   ├── fulfillment-ops.ts                          ← MOD (P4 normalizer, NotImpl catch)
│   └── chief-of-staff-digest.ts                    ← MOD (P3 urgency null + auto_executed filter)
├── tools/
│   ├── batch_approve_briefings.ts                  ← MOD (P4 type unify)
│   ├── dismiss_all_briefings.ts                    ← MOD (P4 rejectOne)
│   ├── enqueue_job.ts                              ← MOD (P4 tenant stamp)
│   ├── query_orders.ts                             ← MOD (P4 type unify)
│   ├── query_products.ts                           ← MOD (P4 type unify)
│   ├── search_memory.ts                            ← MOD (P4 type unify; DEFER RLS — see Open Questions)
│   └── get_recent_briefings.ts                    ← MOD (P4 type unify)
├── sp-api/
│   ├── client.ts                                   ← MOD (P4 Retry-After)
│   ├── auth.ts                                     ← MOD (P4 shared LWA cache + advisory lock)
│   ├── messaging.ts                                ← MOD (P4 NotImplementedError)
│   └── index.ts                                    ← MOD (P4 env-gate)
├── edi/{_real,index}.ts                            ← MOD (P4 env-gate + NotImplementedError)
├── keepa/{client,index}.ts                         ← MOD (P4)
├── voyage/embed.ts                                 ← MOD (P4)
├── sms/twilio.ts                                   ← MOD (P4)
├── executors/flag-anomaly.ts                       ← MOD (P4 pharmacy_id scope)
└── memory/write.ts                                 ← (no change)
supabase/migrations/
├── 20260505000001_phase2_kernel.sql                ← NEW (P2)
├── 20260505000002_phase3_observability.sql         ← NEW (P3)
└── 20260505000003_phase4_constraints.sql           ← NEW (P4)
render.yaml                                         ← MOD (P1 DEV_PASSWORD; P3 add purge crons)
scripts/{8 cron entry files}.ts                     ← MOD (P3 wrap with withSentry + withCronLock)
docs/phase-2-handoff.md                             ← MOD (P4 final: update fix-laters)
```

---

## Phase 1 — Stop-the-bleed Auth (commit 1: ~1h, ZERO migrations)

### P1.1 — `app/api/auth/dev-login/route.ts`: fail-fast pwd + strict gate + no clobber

Replace lines 9, 16-18 with:

```typescript
const DEV_PASSWORD = process.env.DEV_PASSWORD;
const MIN_PWD_LEN = 16;

function isWeakPassword(pwd: string | undefined): boolean {
  if (!pwd) return true;
  if (pwd.length < MIN_PWD_LEN) return true;
  if (/^[0-9]+$/.test(pwd) || /^[a-zA-Z]+$/.test(pwd)) return true;
  return false;
}

// Strict opt-in gate — no NODE_ENV-derived auto-enable.
const devLoginEnabled = process.env.DEV_LOGIN_ENABLED === 'true';
```

In POST handler, after `devLoginEnabled` check, add:

```typescript
if (isWeakPassword(DEV_PASSWORD)) {
  return NextResponse.json(
    { error: 'dev-login misconfigured: set DEV_PASSWORD ≥16 chars, mixed' },
    { status: 503 },
  );
}
```

**Remove lines 60-65** (the `else { admin.auth.admin.updateUserById(...) }` clobber branch). Keep `if (!user)` create branch only.

### P1.2 — `lib/auth-rate-limit.ts` ← NEW: in-process LRU rate limit

```typescript
import { LRUCache } from 'lru-cache';
import { Sentry } from '@/lib/logger';  // already initialized; Phase 2's observability.ts not yet created

if ((Number(process.env.RENDER_INSTANCE_COUNT) || 1) > 1) {
  Sentry.captureMessage(
    '[auth-rate-limit] in-process LRU degrades with multi-replica deploy',
    { level: 'warning' },
  );
}

const cache = new LRUCache<string, number[]>({ max: 4096, ttl: 600_000 });

export function checkAuthRateLimit(
  key: string,
  opts: { window: number; max: number },
): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const arr = (cache.get(key) ?? []).filter(t => t > now - opts.window);
  if (arr.length >= opts.max) {
    return { ok: false, retryAfterSeconds: Math.ceil(opts.window / 1000) };
  }
  arr.push(now);
  cache.set(key, arr);
  return { ok: true, retryAfterSeconds: 0 };
}
```

`package.json` adds `lru-cache@^10`.

In `app/api/auth/dev-login/route.ts` POST handler (top, before pwd check):

```typescript
import { checkAuthRateLimit } from '@/lib/auth-rate-limit';
import { headers } from 'next/headers';

const ip = headers().get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
const rl = checkAuthRateLimit(`dev-login:${ip}`, { window: 60_000, max: 5 });
if (!rl.ok) {
  return NextResponse.json(
    { error: 'rate-limited' },
    { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
  );
}
```

Per-replica only; acceptable for Phase 1 (Render Starter = 1 replica). Phase 3 swaps to DB-backed.

### P1.3 — `middleware.ts`: JSON 401 for `/api/*`

Replace lines 27-29:

```typescript
if (!user) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/sign-in', req.url));
}
```

### P1.4 — `render.yaml`: add DEV_PASSWORD slot

After line 207 (`DEV_LOGIN_ENABLED`), add:

```yaml
      - key: DEV_PASSWORD
        sync: false
```

### P1.5 — `lib/agents/account-health.ts`: SMS-must-prove gate

When status would flip to `'red'` AND sendSms returns `{sent: false, reason: 'twilio-creds-missing' | 'phone-numbers-missing'}`, **skip auto-pause**, emit single high-urgency briefing tagged `data_snapshot.sms_path_unproven: true`, do not touch listings.

```typescript
if (parsed.status === 'red' && smsResult.sent === false &&
    (smsResult.reason === 'twilio-creds-missing' || smsResult.reason === 'phone-numbers-missing')) {
  // Refuse to auto-pause when alert path is unproven.
  return emitAcknowledgeBriefing({
    pharmacyId, supabase,
    title: 'Account Health RED — SMS path unproven, manual review required',
    urgency: 5,
    extra: {
      sms_path_unproven: true,
      would_have_paused: contributingIds.slice(0, MAX_AUTO_PAUSE),
    },
  });
}
```

### P1.6 — Validate

- `npm run typecheck && npm run lint`
- `curl -X POST https://pharm1-web.onrender.com/api/auth/dev-login -d '{}'` → 503 (DEV_PASSWORD weak) until operator sets it on Render
- 6 rapid POSTs from same IP → 6th returns 429
- `curl /api/actions/approve` (no auth) → 401 JSON, NOT HTML

### P1.7 — Commit

`Phase 2 hardening — Phase 1: auth gates`

---

## Phase 2 — Kernel + Undo Correctness (commit 2: ~2-3h)

### P2.1 — Migration `20260505000001_phase2_kernel.sql`

```sql
begin;

-- ─── audit_log: actor_kind discriminated union for system actions ───
alter table audit_log
  add column if not exists actor_kind text not null default 'human'
    check (actor_kind in ('human', 'system'));
alter table audit_log
  add column if not exists actor_label text;  -- e.g. 'account_health' for actor_kind='system'

-- ─── briefings.auto_executed: digest filter for system-actioned items ─
alter table briefings
  add column if not exists auto_executed boolean not null default false;

-- ─── audit_log undo-active partial index (cleanup helper) ───────────
create index if not exists audit_log_undo_active_idx
  on audit_log(undo_window_expires_at)
  where undone_at is null and undo_window_expires_at is not null;

-- ─── approve_audit_atomic: wraps post-executor audit insert + state-finalize ─
-- Caller: kernel.approveOne already did the atomic state-flip claim
-- (update inbox_items set state='acted' where state='pending'). This RPC
-- runs AFTER executor.forward succeeded, and atomically:
--   1. INSERTs the audit_log row
--   2. (if executor returned a pending_*_id) UPDATEs the back-link
-- Both writes commit together.
create or replace function approve_audit_atomic(
  p_inbox_item_id uuid,
  p_pharmacy_id uuid,
  p_actor text,
  p_actor_kind text,
  p_actor_label text,
  p_action text,
  p_params jsonb,
  p_result jsonb,
  p_undo_window_min int default 30,
  p_pending_table text default null,
  p_pending_id uuid default null
) returns table (
  audit_log_id uuid,
  undo_window_expires_at timestamptz
) language plpgsql as $$
declare
  v_audit audit_log%rowtype;
begin
  -- Defense-in-depth allowlist: pickPendingTable in TS only emits these 5,
  -- but a future caller / direct SQL invocation could pass arbitrary text.
  if p_pending_table is not null and p_pending_table not in (
    'pending_listings','pending_pricing_changes','pending_customer_messages',
    'pending_health_actions','pending_purchase_orders'
  ) then
    raise exception 'invalid pending_table: %', p_pending_table;
  end if;

  insert into audit_log (
    pharmacy_id, actor, actor_kind, actor_label, action,
    target_entity_type, target_entity_id, params, result,
    undo_window_expires_at
  ) values (
    p_pharmacy_id, p_actor, p_actor_kind, p_actor_label, p_action,
    'inbox_items', p_inbox_item_id, p_params, p_result,
    now() + make_interval(mins => p_undo_window_min)
  )
  returning * into v_audit;

  -- Optional back-link if executor returned a pending_*_id.
  if p_pending_table is not null and p_pending_id is not null then
    execute format(
      'update %I set audit_log_id = $1 where id = $2',
      p_pending_table
    ) using v_audit.id, p_pending_id;
  end if;

  return query select v_audit.id, v_audit.undo_window_expires_at;
end;
$$;

-- ─── reject_action_atomic: state-flip + audit insert in one tx ─────
create or replace function reject_action_atomic(
  p_inbox_item_id uuid,
  p_pharmacy_id uuid,
  p_actor text,
  p_actor_kind text,
  p_actor_label text,
  p_dismissed_reason text
) returns table (
  audit_log_id uuid
) language plpgsql as $$
declare
  v_flipped inbox_items%rowtype;
  v_audit audit_log%rowtype;
begin
  update inbox_items
    set state = 'dismissed', dismissed_reason = p_dismissed_reason
    where id = p_inbox_item_id
      and pharmacy_id = p_pharmacy_id
      and state in ('pending', 'seen')
    returning * into v_flipped;

  if not found then
    raise exception 'STALE_OR_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into audit_log (
    pharmacy_id, actor, actor_kind, actor_label, action,
    target_entity_type, target_entity_id, params, result
  ) values (
    p_pharmacy_id, p_actor, p_actor_kind, p_actor_label,
    'reject_briefing', 'inbox_items', p_inbox_item_id,
    jsonb_build_object('reason', p_dismissed_reason),
    jsonb_build_object('rejected', true)
  )
  returning * into v_audit;

  return query select v_audit.id;
end;
$$;

commit;
```

Apply via Supabase Management API.

> **Phase 2 Sentry import note:** `lib/observability.ts` (with `withSentry`/`captureRouteWarning`/`captureRouteFatal`) is created in Phase 3. Phase 2 code uses bare `import { Sentry } from '@/lib/logger'` (already exported from Phase 1) and calls `Sentry.captureException` / `Sentry.captureMessage` directly. Do not import `lib/observability.ts` helpers in Phase 2 — they don't exist yet.

### P2.2 — `lib/kernel/approve.ts`: keep claim-then-execute, RPC for audit only

**KEEP** the existing pre-executor state-flip at lines 79-90 (it's the atomic claim — do NOT remove). Replace lines 95-145 with:

```typescript
// 3. Executor runs after the atomic claim. On failure, revert state.
let result: Record<string, unknown> = {};
try {
  const executor = getExecutor(kind);
  result = await executor.forward(params, { pharmacyId: ctx.pharmacyId, userId: ctx.userId });
} catch (err) {
  await supabase
    .from('inbox_items')
    .update({ state: 'pending', acted_at: null, action_taken: null, action_params: null })
    .eq('id', inboxItemId);
  return { ok: false, status: 500, error: err instanceof Error ? err.message : String(err) };
}

// 4. Audit insert + back-link in one transaction via RPC.
const pendingTable = pickPendingTable(result); // returns table name or null
const pendingId = pendingTable ? (result as any)[pendingIdKey(pendingTable)] : null;

const { data: rpcResult, error: rpcErr } = await supabase.rpc('approve_audit_atomic', {
  p_inbox_item_id: inboxItemId,
  p_pharmacy_id: ctx.pharmacyId,
  p_actor: ctx.email,
  p_actor_kind: ctx.actorKind ?? 'human',
  p_actor_label: ctx.actorLabel ?? null,
  p_action: kind,
  p_params: params as unknown as Json,
  p_result: result as unknown as Json,
  p_undo_window_min: UNDO_WINDOW_MIN,
  p_pending_table: pendingTable,
  p_pending_id: pendingId,
});

if (rpcErr || !rpcResult || rpcResult.length === 0) {
  // RPC failed AFTER executor side-effect ran. Compensate best-effort.
  Sentry.captureException(rpcErr ?? new Error('audit RPC empty'), {
    tags: { kernel: 'approve', stage: 'audit-insert' },
  });
  await tryReverseExecutor(kind, params, result, ctx).catch(() => {});
  return {
    ok: false, status: 500,
    error: `kernel audit-insert failed: ${rpcErr?.message ?? 'EMPTY'}`,
  };
}

return {
  ok: true,
  audit_log_id: rpcResult[0].audit_log_id,
  undo_window_expires_at: rpcResult[0].undo_window_expires_at,
  result,
};
```

**Helpers** (top of file):

```typescript
const PENDING_RESULT_KEY: Record<string, string> = {
  'pending_listings': 'pending_listing_id',
  'pending_pricing_changes': 'pending_pricing_change_id',
  'pending_customer_messages': 'pending_customer_message_id',
  'pending_health_actions': 'pending_health_action_id',
  'pending_purchase_orders': 'pending_purchase_order_id',
};

function pickPendingTable(result: Record<string, unknown>): string | null {
  for (const [table, key] of Object.entries(PENDING_RESULT_KEY)) {
    if (typeof result[key] === 'string') return table;
  }
  return null;
}

function pendingIdKey(table: string): string {
  return PENDING_RESULT_KEY[table];
}
```

### P2.3 — `lib/kernel/approve.ts`: extend ApproveContext

```typescript
export type ApproveContext = {
  pharmacyId: string;
  userId: string;
  email: string;
  actorKind?: 'human' | 'system';   // defaults to 'human'
  actorLabel?: string;              // e.g. 'account_health' when actorKind='system'
};
```

### P2.4 — `lib/kernel/reject.ts` ← NEW

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

export type RejectContext = ApproveContext;
export type RejectResult =
  | { ok: true; audit_log_id: string }
  | { ok: false; status: 400 | 404 | 500; error: string };

export async function rejectOne(
  supabase: SupabaseClient<Database>,
  inboxItemId: string,
  reason: string,
  ctx: RejectContext,
): Promise<RejectResult> {
  const { data, error } = await supabase.rpc('reject_action_atomic', {
    p_inbox_item_id: inboxItemId,
    p_pharmacy_id: ctx.pharmacyId,
    p_actor: ctx.email,
    p_actor_kind: ctx.actorKind ?? 'human',
    p_actor_label: ctx.actorLabel ?? null,
    p_dismissed_reason: reason,
  });
  if (error || !data || data.length === 0) {
    return { ok: false, status: 404, error: error?.message ?? 'STALE_OR_NOT_FOUND' };
  }
  return { ok: true, audit_log_id: data[0].audit_log_id };
}
```

### P2.5 — `app/api/actions/undo/route.ts`: reverse-first, then mark undone

Replace lines 36-71:

```typescript
// 1. Find audit row gated by undo window — DO NOT mark undone yet.
const { data: original } = await supabase
  .from('audit_log')
  .select('id, action, params, result, target_entity_type, target_entity_id')
  .eq('id', body.audit_log_id)
  .eq('pharmacy_id', session.pharmacyId)
  .is('undone_at', null)
  .gt('undo_window_expires_at', new Date().toISOString())
  .single();
if (!original) {
  return NextResponse.json({ error: 'audit row not found, already undone, or window expired' }, { status: 404 });
}

// 2. Run reverse executor. On failure, do NOT burn undo token.
let reverseResult: Record<string, unknown>;
try {
  const executor = getExecutor(original.action);
  if (!executor.reverse) {
    return NextResponse.json({ error: 'action not reversible' }, { status: 400 });
  }
  reverseResult = await executor.reverse(original.params as never, original.result as never, {
    pharmacyId: session.pharmacyId,
    userId: session.userId,
  });
} catch (err) {
  Sentry.captureException(err, { tags: { kernel: 'undo' } });
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'undo failed' },
    { status: 500 },
  );
}

// 3. Reverse succeeded. Mark original undone (race-guarded) + log compensating row.
const { data: marked } = await supabase
  .from('audit_log')
  .update({ undone_at: new Date().toISOString() })
  .eq('id', original.id)
  .is('undone_at', null)  // race guard
  .select('id')
  .single();

if (!marked) {
  Sentry.captureMessage('undo: reverse succeeded but mark-undone race-lost', { level: 'warning' });
  return NextResponse.json({ undone: true, reverse_result: reverseResult, warning: 'state-flip-race' });
}

await supabase.from('audit_log').insert({
  pharmacy_id: session.pharmacyId,
  actor: session.email,
  action: `undo:${original.action}`,
  target_entity_type: 'inbox_items',
  target_entity_id: original.target_entity_id,
  params: original.params as Json,
  result: reverseResult as Json,
});

return NextResponse.json({ undone: true, reverse_result: reverseResult });
```

### P2.6 — `lib/agents/account-health.ts`: route auto-pause through approveOne

Replace the existing auto-pause loop (lines 159-186) with:

```typescript
import { approveOne, type ApproveContext } from '@/lib/kernel/approve';

const SYSTEM_CTX: Pick<ApproveContext, 'userId' | 'email' | 'actorKind' | 'actorLabel'> = {
  userId: '00000000-0000-0000-0000-000000000000',  // sentinel; actor_user_id will be NULL via actor_kind='system'
  email: 'system+account-health@pharm1.local',
  actorKind: 'system',
  actorLabel: 'account_health',
};

if (parsed.status === 'red' && contributingIds.length <= MAX_AUTO_PAUSE) {
  const validIds = contributingIds.filter(id => UUID_RE.test(id));
  if (validIds.length < contributingIds.length) {
    Sentry.captureMessage('[account-health] non-UUID listing ids filtered', { level: 'warning' });
  }

  for (const lid of validIds) {
    let inboxItemId: string | null = null;
    try {
      inboxItemId = await emitAutoPauseBriefing(supabase, {
        pharmacyId, listingId: lid, autoExecuted: true,  // sets briefings.auto_executed = true
        reasoning: parsed.reasoning ?? 'account_health red',
        triggeredBy: 'account_health_red_auto',
      });

      const r = await approveOne(supabase, inboxItemId, 0, { pharmacyId, ...SYSTEM_CTX });
      if (!r.ok) {
        // Compensate: mark the briefing's inbox row dismissed so it surfaces
        // in digests as a system-failure (Kaleem reviews manually).
        await supabase
          .from('inbox_items')
          .update({ state: 'dismissed', dismissed_reason: 'system_executor_failed' })
          .eq('id', inboxItemId);
        Sentry.captureMessage(`auto-pause approveOne failed: ${r.error}`, {
          level: 'error', tags: { listing_id: lid, briefing_id: inboxItemId },
        });
        continue;
      }
      autoPaused.push(lid);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { agent: 'account-health', stage: 'auto-pause', listing_id: lid },
      });
      // If briefing was created but approveOne threw, dismiss it.
      if (inboxItemId) {
        await supabase
          .from('inbox_items')
          .update({ state: 'dismissed', dismissed_reason: 'system_executor_failed' })
          .eq('id', inboxItemId)
          .catch(() => {});
      }
    }
  }
}
```

`emitAutoPauseBriefing` is a new local helper (50 LOC, mirrors existing briefing+inbox_item insert pattern) that sets `briefings.auto_executed = true`, returns the inbox_item.id.

**Removes:** the inline `30 * 60 * 1000` undo expiry calc (kernel handles it), the unchecked `audit_log` insert (RPC handles it), the parallel write path (now goes through kernel).

### P2.7 — Validate

- Apply migration to cloud Supabase
- `npm run typecheck && npm run lint`
- `npm run agent:account-health` against red-status fixture → audit_log row written via RPC, briefings.auto_executed=true, pending_health_actions.audit_log_id populated
- Browser: Approve → undo → verify reverse runs FIRST, then undone_at set
- **Programmatic race test** (no PSQL access required): write `scripts/test-kernel-race.ts` that spawns 2 concurrent `approveOne` calls against a single seeded inbox_item; assert exactly one returns `{ok: true}` and the other `{ok: false, status: 409}`. Run via `npx tsx scripts/test-kernel-race.ts`.

### P2.8 — Commit

`Phase 2 hardening — Phase 2: kernel + undo correctness`

---

## Phase 3 — Observability + Cost (commit 3: ~2-3h)

### P3.1 — Migration `20260505000002_phase3_observability.sql`

```sql
begin;

-- webhook dedupe
create table if not exists webhook_dedupe (
  notification_id text primary key,
  notification_type text not null,
  received_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists webhook_dedupe_expires_idx on webhook_dedupe(expires_at);

create or replace function purge_webhook_dedupe() returns int language sql as $$
  with del as (delete from webhook_dedupe where expires_at < now() returning 1)
  select count(*)::int from del;
$$;

-- rate limit (string-key)
create table if not exists rate_limit_events (
  id bigint generated always as identity primary key,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_events_key_created_idx
  on rate_limit_events(key, created_at desc);
create index if not exists rate_limit_events_ttl_idx on rate_limit_events(created_at);

create or replace function purge_rate_limit_events() returns int language sql as $$
  with del as (delete from rate_limit_events where created_at < now() - interval '1 hour' returning 1)
  select count(*)::int from del;
$$;

-- cron locks (TTL heartbeat — works with PostgREST/PgBouncer)
create table if not exists cron_locks (
  agent_name text primary key,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  worker_id text not null
);

create or replace function claim_cron_lock(
  p_agent_name text, p_worker_id text, p_ttl_minutes int default 60
) returns boolean language sql as $$
  -- RETURNING-based claim: compare returned worker_id against caller.
  -- On fresh INSERT: returns caller's worker_id → claim true.
  -- On conflict + WHERE-met (expired): returns caller's worker_id → claim true.
  -- On conflict + WHERE-blocked (still held): returns nothing → claim false.
  with up as (
    insert into cron_locks (agent_name, worker_id, locked_at, expires_at)
      values (p_agent_name, p_worker_id, now(), now() + make_interval(mins => p_ttl_minutes))
      on conflict (agent_name) do update
        set worker_id = excluded.worker_id,
            locked_at = excluded.locked_at,
            expires_at = excluded.expires_at
        where cron_locks.expires_at < now()
      returning worker_id
  )
  select coalesce((select worker_id = p_worker_id from up limit 1), false);
$$;

create or replace function release_cron_lock(p_agent_name text, p_worker_id text)
returns boolean language sql as $$
  delete from cron_locks where agent_name = p_agent_name and worker_id = p_worker_id;
  select true;
$$;

-- jobs: pharmacy_id + submitted_by
alter table jobs add column if not exists pharmacy_id uuid references pharmacies(id) on delete cascade;
alter table jobs add column if not exists submitted_by uuid references auth.users(id) on delete set null;
create index if not exists jobs_pharmacy_status_idx on jobs(pharmacy_id, status);

-- claude_usage: pharmacy_id + JOIN-driven backfill
alter table claude_usage add column if not exists pharmacy_id uuid references pharmacies(id) on delete set null;

update claude_usage cu
  set pharmacy_id = (
    select upa.pharmacy_id from user_pharmacy_access upa
    where upa.user_id = cu.user_id limit 1
  )
  where cu.pharmacy_id is null and cu.user_id is not null;

create index if not exists claude_usage_pharmacy_day_idx
  on claude_usage(pharmacy_id, created_at desc);

commit;
```

### P3.2 — `lib/observability.ts` ← NEW

```typescript
import { Sentry } from '@/lib/logger';

export async function withSentry<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    Sentry.captureException(err, { tags: { agent: name } });
    await Sentry.flush(2000);
    throw err;
  }
}

export function captureRouteWarning(err: unknown, route: string, extra?: Record<string, unknown>): void {
  Sentry.captureException(err, { tags: { route }, extra, level: 'warning' });
}

export function captureRouteFatal(err: unknown, route: string, extra?: Record<string, unknown>): void {
  Sentry.captureException(err, { tags: { route }, extra, level: 'error' });
}

export { Sentry };
```

### P3.3 — `lib/cron-lock.ts` ← NEW

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { randomUUID } from 'crypto';

export async function withCronLock<T>(
  supabase: SupabaseClient<Database>,
  agentName: string,
  fn: () => Promise<T>,
  ttlMinutes = 60,
): Promise<T | null> {
  const workerId = `${process.env.RENDER_INSTANCE_ID ?? 'local'}:${randomUUID()}`;

  const { data: claimed } = await supabase.rpc('claim_cron_lock', {
    p_agent_name: agentName,
    p_worker_id: workerId,
    p_ttl_minutes: ttlMinutes,
  });

  if (!claimed) {
    console.warn(`[cron-lock] ${agentName} already running; skipping`);
    return null;
  }

  try {
    return await fn();
  } finally {
    await supabase.rpc('release_cron_lock', { p_agent_name: agentName, p_worker_id: workerId });
  }
}
```

### P3.4 — `lib/agents/_shared.ts`: timeout, throw not exit, withSentry hook

Replace `process.exit(2)` (line 39):
```typescript
if (!process.env.OPENROUTER_API_KEY) {
  throw new Error('[budget-gate] OPENROUTER_API_KEY not set');
}
```

In `callAgentLLM`:
```typescript
const TIMEOUT_MS = 60_000;
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
try {
  return await openrouter.chat.completions.create(
    { model, messages, response_format: { type: 'json_object' }, reasoning: { effort } },
    { signal: ac.signal },
  );
} finally {
  clearTimeout(timer);
}
```

### P3.5 — Webhook: PublishTime + dedupe + 5xx

In `app/api/sp-api/webhook/route.ts`, after HMAC verify, parse envelope, then:

```typescript
// Replay defense via NotificationMetadata.PublishTime (no custom header).
const publishTime = env.NotificationMetadata?.PublishTime;
const ts = publishTime ? Date.parse(publishTime) : NaN;
if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60_000) {
  return NextResponse.json({ error: 'envelope-publish-time-out-of-window' }, { status: 401 });
}

// NotificationId dedupe.
const notificationId = env.NotificationMetadata?.NotificationId;
if (!notificationId) {
  return NextResponse.json({ error: 'missing-notification-id' }, { status: 400 });
}

const supabase = createAdminClient();
const { error: dedupeErr } = await supabase
  .from('webhook_dedupe')
  .insert({ notification_id: notificationId, notification_type: env.NotificationType });

if (dedupeErr?.code === '23505') {
  return NextResponse.json({ ok: true, deduped: true });  // already processed
}
if (dedupeErr) {
  captureRouteFatal(dedupeErr, 'sp-api-webhook');
  return NextResponse.json({ error: 'dedupe-failed' }, { status: 500 });
}

// Dispatch — return 5xx on error so SP-API retries.
let agentResult: { error?: string } | undefined;
try {
  switch (env.NotificationType) { /* ... existing dispatch, capture result ... */ }
  if (agentResult?.error) {
    captureRouteFatal(new Error(agentResult.error), 'sp-api-webhook', { notification_id: notificationId });
    return NextResponse.json({ error: agentResult.error }, { status: 502 });
  }
} catch (err) {
  captureRouteFatal(err, 'sp-api-webhook', { notification_id: notificationId });
  return NextResponse.json({ error: 'handler-failed' }, { status: 500 });
}

return NextResponse.json({ ok: true, notification_id: notificationId });
```

### P3.6 — `lib/rate-limit.ts`: string-key, fail-closed, LRU fallback

```typescript
import { LRUCache } from 'lru-cache';
import { createClient } from '@/lib/supabase/server';
import { Sentry } from '@/lib/logger';

const fallbackLRU = new LRUCache<string, number[]>({ max: 1024, ttl: 60_000 });

if ((Number(process.env.RENDER_INSTANCE_COUNT) || 1) > 1) {
  Sentry.captureMessage('[rate-limit] LRU fallback degrades with multi-replica', { level: 'warning' });
}

export async function checkRateLimit(
  key: string,
  opts: { window: number; max: number },
): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const supabase = createClient();
  const since = new Date(Date.now() - opts.window).toISOString();

  const { count, error } = await supabase
    .from('rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('key', key)
    .gte('created_at', since);

  if (error) {
    Sentry.captureMessage('[rate-limit] db unavailable; LRU fallback', { level: 'warning' });
    const now = Date.now();
    const arr = (fallbackLRU.get(key) ?? []).filter(t => t > now - opts.window);
    if (arr.length >= opts.max) {
      return { ok: false, retryAfterSeconds: Math.ceil(opts.window / 1000) };
    }
    arr.push(now);
    fallbackLRU.set(key, arr);
    return { ok: true, retryAfterSeconds: 0 };
  }

  if ((count ?? 0) >= opts.max) {
    return { ok: false, retryAfterSeconds: Math.ceil(opts.window / 1000) };
  }
  await supabase.from('rate_limit_events').insert({ key });
  return { ok: true, retryAfterSeconds: 0 };
}
```

### P3.7 — Wrap unguarded Zod parses (NOT in account-health which already has try/catch — finding C3 was REJECTED)

For each of `customer-success.ts:81+144`, `bookkeeper.ts:125`, `portfolio-manager.ts:113`, `reflector.ts:145`:

```typescript
let parsed: ParsedShape;
try {
  parsed = OutputSchema.parse(JSON.parse(stripJsonFence(raw)));
} catch (err) {
  Sentry.captureException(err, { tags: { agent: '<name>', stage: 'parse' } });
  return { skipped_parse_error: true };
}
```

For customer-success (webhook-routed): the route inspects this return and returns 200 (no SP-API replay storm — parse failures aren't retryable).

### P3.8 — Repricer extractAsinFromEvent — bail on null

Update `lib/agents/repricer.ts:69-76`:

```typescript
function extractAsinFromEvent(env: NotificationEnvelope | null): string | null {
  if (!env) return null;
  return (
    env.Payload?.AnyOfferChangedNotification?.OfferChangeTrigger?.ASIN ??
    env.Payload?.ListingsItemMfnQuantityChangeNotification?.ASIN ??
    null
  );
}
```

In `runRepricer`, when `eventMode === true && asin === null`: **return `{ proposed: 0, capped: false, skipped: 'unparseable_event' }` immediately** — don't fall through to full watchlist scan.

### P3.9 — Action route rate limits

In `app/api/actions/{approve,reject,undo}/route.ts`, top of POST:

```typescript
const rl = await checkRateLimit(`actions:${session.userId}`, { window: 60_000, max: 60 });
if (!rl.ok) return NextResponse.json({ error: 'rate-limited' }, { status: 429 });
```

### P3.10 — `lib/budget.ts`: Sentry escalation on persistent insert failures (NO THROW)

**Important:** do NOT throw on consecutive failures — that would create a feedback loop with P3.5 webhook 5xx (failed insert → throw → 5xx → SP-API replay → new agent run → more failed inserts). Instead, escalate to Sentry as level `'error'` so the team gets paged but the agent run completes.

```typescript
let consecutiveFailures = 0;
let lastEscalation = 0;
// Inside recordLLMUsage:
if (error) {
  consecutiveFailures += 1;
  console.warn('[budget] failed to record llm_usage row:', error.message);
  // Escalate every 5 failures, max once per 5 min, so Sentry doesn't get flooded.
  if (consecutiveFailures % 5 === 0 && Date.now() - lastEscalation > 5 * 60_000) {
    Sentry.captureMessage(
      `[budget] ${consecutiveFailures} consecutive claude_usage insert failures`,
      { level: 'error', tags: { stage: 'recordLLMUsage' } },
    );
    lastEscalation = Date.now();
  }
} else {
  consecutiveFailures = 0;
}
```

### P3.11 — Wrap all 8 cron entries with withSentry + withCronLock

For each `scripts/{bookkeeper,reflector,portfolio-manager,repricer,account-health,research-analyst,chief-of-staff-digest,listing-agent}.ts`:

```typescript
import { withSentry } from '@/lib/observability';
import { withCronLock } from '@/lib/cron-lock';
import { Sentry } from '@/lib/logger';

async function main() {
  const supabase = createAdminClient();
  await withSentry('agent-name', () =>
    withCronLock(supabase, 'agent-name', () => runAgent(supabase))
  );
}

main().catch(async (err) => {
  console.error(err);
  await Sentry.flush(2000);  // ensure delivery before exit
  process.exit(1);
});
```

### P3.12 — Reflector weekEnd normalize + Daily Digest auto_executed filter

`lib/agents/reflector.ts:51-54`:
```typescript
const weekEnd = new Date(Date.UTC(
  now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0
));
const weekStart = new Date(weekEnd);
weekStart.setUTCDate(weekStart.getUTCDate() - 7);
```

`lib/agents/chief-of-staff-digest.ts:73`:
```typescript
const top = recent
  .filter(b => !b.auto_executed)  // skip system-actioned
  .filter(b => (b.urgency ?? 1) >= 4 || b.briefing_type === 'account_health_red');
```

### P3.13 — Sentry capture wired at known error sites

Edit per finding F3 list (route catches, embed exceptions, account-health auto-pause failures, voyage embed catch, memory/write embed catch, kernel backlink failures, undo reverse error). Use `captureRouteWarning` / `captureRouteFatal` per severity.

### P3.14 — `render.yaml`: add purge crons

```yaml
  - type: cron
    name: pharm1-rate-limit-purge
    runtime: node
    plan: starter
    region: oregon
    buildCommand: npm ci
    schedule: "0 * * * *"  # hourly
    startCommand: npm run cron:rate-limit-purge
    envVars:
      - fromGroup: pharm1-shared

  - type: cron
    name: pharm1-webhook-dedupe-purge
    runtime: node
    plan: starter
    region: oregon
    buildCommand: npm ci
    schedule: "0 9 * * *"  # daily 09:00 UTC
    startCommand: npm run cron:webhook-dedupe-purge
    envVars:
      - fromGroup: pharm1-shared
```

Add `package.json` scripts that invoke the corresponding `purge_*` RPC functions.

### P3.15 — Validate

- Apply migration. Verify `cron_locks` upsert behavior with PSQL: two concurrent `claim_cron_lock` calls — only first returns true.
- `curl webhook` with stale PublishTime → 401
- Replay valid envelope → first 200, second 200 with `{deduped: true}`
- `npm run agent:bookkeeper` x2 simultaneously → second exits with `[cron-lock] already running`
- Force OPENROUTER_API_KEY='' → throws (not process.exit)
- 61st `/api/actions/approve` in 1 min → 429

### P3.16 — Commit

`Phase 2 hardening — Phase 3: observability + cost protection`

---

## Phase 4 — Cred-gate + Cross-Layer (commit 4: ~3-4h)

### P4.1 — Migration `20260505000003_phase4_constraints.sql`

```sql
begin;

-- pending_purchase_orders precheck (fail loud if any NULL exists)
do $$
declare v_null_count int;
begin
  select count(*) into v_null_count from pending_purchase_orders
    where order_id is null or product_id is null;
  if v_null_count > 0 then
    raise exception 'pending_purchase_orders has % rows with NULL order_id or product_id; clean up before NOT NULL migration', v_null_count;
  end if;
end $$;

alter table pending_purchase_orders alter column order_id set not null;
alter table pending_purchase_orders alter column product_id set not null;
alter table pending_purchase_orders
  add constraint pending_purchase_orders_wholesaler_check
    check (wholesaler in ('abc','mckesson','cardinal','parmed','ezrirx'));

-- Drop redundant partial-WHERE on now-NOT-NULL column
drop index if exists pending_purchase_orders_order_idx;
create index pending_purchase_orders_order_idx on pending_purchase_orders(order_id);

-- orders.platform CHECK (safe to land in 4a — no app code change needed)
alter table orders add constraint orders_platform_check
  check (platform in ('amazon','ebay','own_store'));

-- NOTE: orders.status normalize + CHECK is moved to migration 20260505000004 (Phase 4b)
-- so it co-ships with lib/orders/status.ts normalizer at write boundary. Landing the
-- CHECK in 4a alone would break fulfillment-ops on any webhook arriving between 4a and 4b.

-- orders.status: explicitly map SP-API CamelCase → canonical snake_case BEFORE adding CHECK.
-- (BLOCK MOVED TO 20260505000004 — kept here for reference only; do NOT execute in 4a.)
/*
-- Bare lower() would corrupt 'PartiallyShipped' → 'partiallyshipped' (no underscore) which fails CHECK.
update orders set status = case status
  when 'Pending' then 'pending'
  when 'Unshipped' then 'unshipped'
  when 'PartiallyShipped' then 'partially_shipped'
  when 'Shipped' then 'shipped'
  when 'Canceled' then 'canceled'
  when 'Unfulfillable' then 'unfulfillable'
  when 'InvoiceUnconfirmed' then 'invoice_unconfirmed'
  when 'PendingAvailability' then 'pending_availability'
  else lower(status)
end
where status ~ '[A-Z]' or status <> lower(status);

-- Precheck: fail loud if any row remains non-canonical after the mapping update.
do $$
declare v_bad int;
declare v_sample text;
begin
  select count(*) into v_bad from orders
    where status not in (
      'pending','unshipped','partially_shipped','shipped','canceled',
      'unfulfillable','invoice_unconfirmed','pending_availability',
      'new','ordered_from_supplier','delivered','returned','refunded'
    );
  if v_bad > 0 then
    select string_agg(distinct status, ',') into v_sample from orders
      where status not in (
        'pending','unshipped','partially_shipped','shipped','canceled',
        'unfulfillable','invoice_unconfirmed','pending_availability',
        'new','ordered_from_supplier','delivered','returned','refunded'
      );
    raise exception 'orders has % rows with non-canonical status (samples: %)', v_bad, v_sample;
  end if;
end $$;

alter table orders add constraint orders_status_check
  check (status in (
    'pending','unshipped','partially_shipped','shipped','canceled',
    'unfulfillable','invoice_unconfirmed','pending_availability',
    'new','ordered_from_supplier','delivered','returned','refunded'
  ));
*/

-- products.watchlist_status: drop+recreate CHECK with 'evaluating'
alter table products drop constraint if exists products_watchlist_status_check;
alter table products add constraint products_watchlist_status_check
  check (watchlist_status in ('none','watching','evaluating','active','paused','blocked'));

-- LWA token cache (singleton)
create table if not exists lwa_token_cache (
  id int primary key default 1,
  token text not null,
  expires_at timestamptz not null,
  refreshed_at timestamptz not null default now(),
  constraint lwa_token_cache_singleton check (id = 1)
);

-- SMS sends dedupe (Twilio doesn't support SDK-level idempotency)
create table if not exists sms_sends (
  briefing_id uuid primary key references briefings(id) on delete cascade,
  sid text not null,
  sent_at timestamptz not null default now()
);

commit;
```

### P4.2 — `lib/env-gate.ts` ← NEW

```typescript
const PLACEHOLDERS = new Set(['undefined', 'null', 'none', '', 'disabled', 'placeholder']);

export function envIsRealValue(name: string): boolean {
  const raw = process.env[name];
  if (typeof raw !== 'string') return false;
  const t = raw.trim();
  if (t.length === 0) return false;
  if (PLACEHOLDERS.has(t.toLowerCase())) return false;
  return true;
}

export function allEnvReal(...names: string[]): boolean {
  return names.every(envIsRealValue);
}

/** Cred-gate factory helper: real client only when ALL creds set AND ready-flag is 'true'. */
export function vendorReady(credEnvVars: string[], readyFlag: string): boolean {
  return allEnvReal(...credEnvVars) && process.env[readyFlag] === 'true';
}
```

### P4.3 — Cred-gate factories

`lib/sp-api/index.ts`:
```typescript
import { allEnvReal, vendorReady } from '@/lib/env-gate';

export const spApiCredsPresent = (): boolean =>
  allEnvReal('SP_API_REFRESH_TOKEN', 'LWA_CLIENT_ID', 'LWA_CLIENT_SECRET');

// Messaging real client requires explicit opt-in (we ship a stub today).
const messagingReady = (): boolean =>
  spApiCredsPresent() && process.env.SP_API_MESSAGING_REAL_CLIENT_READY === 'true';

export const getMessagingClient = () =>
  messagingReady() ? getRealMessagingClient() : getFixtureMessagingClient();
```

`lib/edi/index.ts`:
```typescript
const ediReady = (): boolean =>
  allEnvReal('EZRIRX_SFTP_HOST', 'EZRIRX_SFTP_USER', 'EZRIRX_SFTP_KEY') &&
  process.env.EZRIRX_REAL_CLIENT_READY === 'true';

export const getWholesalerCatalogClient = () =>
  ediReady() ? getRealCatalogClient() : getFixtureCatalogClient();
```

`lib/keepa/index.ts`: just env-gate sanitization (real client is genuinely ready):
```typescript
import { allEnvReal } from '@/lib/env-gate';
export const keepaCredsPresent = () => allEnvReal('KEEPA_API_KEY');
```

### P4.4 — `lib/sp-api/messaging.ts:11`: NotImplementedError, no fake-success

```typescript
import { NotImplementedError } from '@/lib/errors';

export const getRealMessagingClient = (): MessagingClient => ({
  async createConfirmDeliveryDetails() {
    throw new NotImplementedError('sp-api-messaging');
  },
});
```

`lib/errors.ts` (new, tiny):
```typescript
export class NotImplementedError extends Error {
  constructor(public readonly feature: string) {
    super(`[not-implemented] ${feature}: real client lands post-launch`);
    this.name = 'NotImplementedError';
  }
}
```

`lib/edi/_real.ts` similar: throws NotImplementedError on getSnapshotsForNdcs.

**No fixture-fallback in fulfillment-ops.** With the `EZRIRX_REAL_CLIENT_READY` flag staying false, the cred-gate keeps using the fixture client — no NotImplementedError fires in normal operation. The throw only fires if someone explicitly sets `EZRIRX_REAL_CLIENT_READY=true` while `_real.ts` is still a stub — that's a deliberate misconfiguration we want to fail loud.

### P4.5 — `lib/sp-api/client.ts`: Retry-After honor

Replace 429-retry block:
```typescript
if (res.status === 429 || res.status >= 500) {
  if (attempt >= 5) throw new Error(`SP-API ${path} ${res.status} after 5 retries: ${await res.text()}`);
  const retryAfter = res.headers.get('Retry-After');
  const headerDelay = retryAfter ? parseRetryAfter(retryAfter) : null;
  const localDelay = Math.min(1000 * 2 ** attempt + Math.random() * 200, 30_000);
  const delay = headerDelay ?? localDelay;
  await new Promise(r => setTimeout(r, delay));
  attempt++;
  continue;
}

function parseRetryAfter(header: string): number {
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return 1000;
}
```

### P4.6 — `lib/keepa/client.ts`: real bucket aware

- Exempt `/token` path from MIN_TOKENS check.
- Capture `body.refillIn` from each response into `lastRefillIn`.
- 429 retry uses `lastRefillIn ?? 5000`.
- Replace `const refillIn = lastTokensLeft && lastTokensLeft >= 0 ? 5000 : 5000` with `const refillIn = lastRefillIn ?? 5000`.

### P4.7 — `lib/sms/twilio.ts`: E.164 + sms_sends dedupe (NO SDK idempotencyKey)

```typescript
import { envIsRealValue } from '@/lib/env-gate';

const E164_RE = /^\+[1-9]\d{1,14}$/;

export async function sendSms(
  body: string,
  briefingId: string,
  supabase: SupabaseClient<Database>,
): Promise<{ sent: boolean; reason?: string; sid?: string }> {
  if (!envIsRealValue('TWILIO_ACCOUNT_SID') || !envIsRealValue('TWILIO_AUTH_TOKEN')) {
    return { sent: false, reason: 'twilio-creds-missing' };
  }
  if (!envIsRealValue('KALEEM_SMS_NUMBER') || !envIsRealValue('TWILIO_FROM_NUMBER')) {
    return { sent: false, reason: 'phone-numbers-missing' };
  }
  const from = process.env.TWILIO_FROM_NUMBER!;
  const to = process.env.KALEEM_SMS_NUMBER!;
  if (!E164_RE.test(from) || !E164_RE.test(to)) {
    return { sent: false, reason: 'phone-not-e164' };
  }

  // Caller-side idempotency via sms_sends table.
  const { data: existing } = await supabase
    .from('sms_sends').select('sid').eq('briefing_id', briefingId).maybeSingle();
  if (existing) return { sent: true, sid: existing.sid, reason: 'already-sent' };

  const c = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  const msg = await c.messages.create({ from, to, body });
  await supabase.from('sms_sends').insert({ briefing_id: briefingId, sid: msg.sid });
  return { sent: true, sid: msg.sid };
}
```

Caller `account-health.ts` passes `briefingId` + `supabase`.

### P4.8 — `lib/voyage/embed.ts`: array + dim guards

```typescript
const body = (await res.json()) as unknown;
if (!body || typeof body !== 'object' || !Array.isArray((body as any).data)) {
  Sentry.captureMessage('[voyage] response missing data array', { level: 'warning' });
  return null;
}
const data = (body as any).data as Array<{ embedding: unknown; index: number }>;
const sorted = data.sort((a, b) => a.index - b.index).map(d => d.embedding);
for (const v of sorted) {
  if (!Array.isArray(v) || v.length !== 1024) {
    Sentry.captureMessage(
      `[voyage] dim != 1024 (got ${Array.isArray(v) ? v.length : typeof v})`,
      { level: 'error' }
    );
    return null;
  }
}
return sorted as number[][];
```

### P4.9 — `lib/orders/status.ts` ← NEW + Migration `20260505000004_orders_status_check.sql` (Phase 4b)

**New migration file `20260505000004_orders_status_check.sql`** (Phase 4b only — runs AFTER Phase 4b code deploys with normalizer):

```sql
begin;

-- Map SP-API CamelCase → canonical snake_case BEFORE adding CHECK.
update orders set status = case status
  when 'Pending' then 'pending'
  when 'Unshipped' then 'unshipped'
  when 'PartiallyShipped' then 'partially_shipped'
  when 'Shipped' then 'shipped'
  when 'Canceled' then 'canceled'
  when 'Unfulfillable' then 'unfulfillable'
  when 'InvoiceUnconfirmed' then 'invoice_unconfirmed'
  when 'PendingAvailability' then 'pending_availability'
  else lower(status)
end
where status ~ '[A-Z]' or status <> lower(status);

-- Precheck: fail loud if any row remains non-canonical.
do $$
declare v_bad int;
declare v_sample text;
begin
  select count(*) into v_bad from orders
    where status not in (
      'pending','unshipped','partially_shipped','shipped','canceled',
      'unfulfillable','invoice_unconfirmed','pending_availability',
      'new','ordered_from_supplier','delivered','returned','refunded'
    );
  if v_bad > 0 then
    select string_agg(distinct status, ',') into v_sample from orders
      where status not in (
        'pending','unshipped','partially_shipped','shipped','canceled',
        'unfulfillable','invoice_unconfirmed','pending_availability',
        'new','ordered_from_supplier','delivered','returned','refunded'
      );
    raise exception 'orders has % rows with non-canonical status (samples: %)', v_bad, v_sample;
  end if;
end $$;

alter table orders add constraint orders_status_check
  check (status in (
    'pending','unshipped','partially_shipped','shipped','canceled',
    'unfulfillable','invoice_unconfirmed','pending_availability',
    'new','ordered_from_supplier','delivered','returned','refunded'
  ));

commit;
```

**`lib/orders/status.ts`** (new file, used by P4.16 fulfillment-ops normalize-on-write — must ship in code BEFORE this migration applies):

```typescript
const SP_API_TO_CANONICAL: Record<string, string> = {
  'Pending': 'pending', 'Unshipped': 'unshipped', 'PartiallyShipped': 'partially_shipped',
  'Shipped': 'shipped', 'Canceled': 'canceled', 'Unfulfillable': 'unfulfillable',
  'InvoiceUnconfirmed': 'invoice_unconfirmed', 'PendingAvailability': 'pending_availability',
};
const VALID = new Set([
  'pending', 'unshipped', 'partially_shipped', 'shipped', 'canceled',
  'unfulfillable', 'invoice_unconfirmed', 'pending_availability',
  'new', 'ordered_from_supplier', 'delivered', 'returned', 'refunded',
]);
export function normalizeOrderStatus(raw: string): string {
  const c = SP_API_TO_CANONICAL[raw] ?? raw.toLowerCase();
  if (!VALID.has(c)) throw new Error(`[order-status] unknown: ${raw}`);
  return c;
}
```

Apply at `lib/agents/fulfillment-ops.ts` upsert call **before** the migration adds the CHECK constraint (same commit).

### P4.10 — `lib/sp-api/auth.ts`: shared LWA cache + lease-table refresh serialization

**Concurrency primitive:** `lwa_token_refreshes(started_at timestamptz PK)` lease table — only one row at a time. The winner of `INSERT ... ON CONFLICT DO NOTHING RETURNING` refreshes; losers wait + re-read cache. Same pattern as `cron_locks`. Works correctly with PostgREST/PgBouncer (no session-bound advisory locks).

Migration `20260505000003` adds:

```sql
create table if not exists lwa_token_refreshes (
  -- Singleton lease — only one in-flight refresh allowed.
  id int primary key default 1,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 seconds'),
  worker_id text not null,
  constraint lwa_token_refreshes_singleton check (id = 1)
);

create or replace function claim_lwa_refresh(p_worker_id text)
returns boolean language sql as $$
  with up as (
    insert into lwa_token_refreshes (id, worker_id, started_at, expires_at)
      values (1, p_worker_id, now(), now() + interval '30 seconds')
      on conflict (id) do update
        set worker_id = excluded.worker_id,
            started_at = excluded.started_at,
            expires_at = excluded.expires_at
        where lwa_token_refreshes.expires_at < now()
      returning worker_id
  )
  select coalesce((select worker_id = p_worker_id from up limit 1), false);
$$;

create or replace function release_lwa_refresh(p_worker_id text)
returns boolean language sql as $$
  delete from lwa_token_refreshes where id = 1 and worker_id = p_worker_id;
  select true;
$$;
```

```typescript
import { randomUUID } from 'crypto';

async function getLwaTokenShared(supabase: SupabaseClient<Database>): Promise<string> {
  const { data: cached } = await supabase
    .from('lwa_token_cache').select('token, expires_at').eq('id', 1).maybeSingle();
  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60_000) {
    return cached.token;
  }

  const workerId = `${process.env.RENDER_INSTANCE_ID ?? 'local'}:${randomUUID()}`;
  const { data: claimed } = await supabase.rpc('claim_lwa_refresh', { p_worker_id: workerId });

  if (!claimed) {
    // Another replica is refreshing — wait briefly + re-read cache.
    await new Promise(r => setTimeout(r, 250));
    const { data: retry } = await supabase
      .from('lwa_token_cache').select('token').eq('id', 1).maybeSingle();
    if (retry?.token) return retry.token;
    throw new Error('[lwa] refresh in progress; retry queue exhausted');
  }

  try {
    const fresh = await refreshLwaToken();
    await supabase.from('lwa_token_cache').upsert({
      id: 1, token: fresh.token,
      expires_at: new Date(Date.now() + fresh.expiresInMs).toISOString(),
      refreshed_at: new Date().toISOString(),
    });
    return fresh.token;
  } finally {
    await supabase.rpc('release_lwa_refresh', { p_worker_id: workerId });
  }
}
```

### P4.11 — Reject route + dismiss_all_briefings: call rejectOne

```typescript
// app/api/actions/reject/route.ts:
const r = await rejectOne(supabase, body.inbox_item_id, body.reason ?? 'user_rejected', {
  pharmacyId: session.pharmacyId, userId: session.userId, email: session.email,
});
if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
return NextResponse.json({ ok: true, audit_log_id: r.audit_log_id });
```

```typescript
// lib/tools/dismiss_all_briefings.ts:
for (const row of rows) {
  const r = await rejectOne(supabase, row.id, 'chat_dismiss_all', ctx);
  if (r.ok) dismissed++;
}
```

Remove the falsely-claiming header comment from dismiss_all_briefings.

### P4.12 — `lib/tools/enqueue_job.ts`: stamp pharmacy_id + submitted_by

```typescript
export async function enqueue_job(rawInput: unknown, ctx: ToolContext): Promise<string> {
  // ...
  await supabase.from('jobs').insert({
    job_type: fullJobType, payload: payload as never, status: 'pending', priority,
    pharmacy_id: ctx.pharmacyId, submitted_by: ctx.userId,
  });
}
```

### P4.13 — `lib/agents/bookkeeper.ts`: pharmacy_id filter + recordLLMUsage signature change

**Bookkeeper query:**
```typescript
const { data: usage } = await supabase
  .from('claude_usage')
  .select('estimated_cost_usd, model, created_at')
  .eq('pharmacy_id', pharmacyId)
  .gte('created_at', start.toISOString())
  .lte('created_at', end.toISOString());
```

**`lib/budget.ts recordLLMUsage` signature change** (options-object form, both fields optional to avoid breaking 11 call sites):

```typescript
export async function recordLLMUsage(
  supabase: SupabaseClient<Database>,
  completion: OpenAI.Chat.Completions.ChatCompletion,
  opts: { userId?: string | null; pharmacyId?: string | null } = {},
): Promise<void> {
  // ...existing body, INSERT now stamps user_id: opts.userId ?? null, pharmacy_id: opts.pharmacyId ?? null
}
```

**Caller updates** (11 sites):
- `app/api/chat/route.ts`: `recordLLMUsage(supabase, completion, { userId: session.userId, pharmacyId: session.pharmacyId })`
- `lib/agents/_shared.ts callAgentLLM`: thread `pharmacyId` through agent function signatures and pass it here. Each of the 9 agents (bookkeeper, reflector, ...) needs its `runX(supabase, pharmacyId, ...)` shape preserved.

`getTodaySpendUsd(supabase, userId, pharmacyId?)` similarly accepts optional pharmacyId for future per-tenant gating; today's call is read-only and unchanged at the gate path.

### P4.14 — Tool ctx unification

Replace inline `{ pharmacyId: string }` with named `ToolContext` import in `lib/tools/{query_orders,query_products,search_memory,get_recent_briefings,enqueue_job}.ts`.

### P4.15 — `lib/executors/flag-anomaly.ts:54`: pharmacy_id scope on reverse delete

```typescript
const { error } = await supabase
  .from('memory').delete().in('id', memory_ids).eq('pharmacy_id', ctx.pharmacyId);
```

### P4.16 — Loosen Zod schemas

- `lib/agents/account-health.ts:35`: `contributing_listing_ids: z.array(z.string().min(1)).optional()` (was `.uuid()`). UUID filter happens at use-site (P2.6).
- `lib/agents/research-analyst.ts:34`: `urgency: z.number().min(1).max(5).transform(v => Math.round(v))` so floats round.

### P4.17 — Validate

- Apply migration. Verify NOT NULL precheck.
- Set `EZRIRX_SFTP_HOST='undefined'` → `ediReady()` returns false. Set real value + `EZRIRX_REAL_CLIENT_READY=true` → returns true.
- Insert pending_purchase_orders with NULL order_id → DB rejects.
- `INSERT pending_purchase_orders ... wholesaler='kinray'` → DB rejects.
- Bookkeeper run after seeding two pharmacies' usage rows → only own pharmacy in P&L.
- SMS retry for same briefingId → second call returns `{sent: true, reason: 'already-sent'}`.
- Voyage with `dim != 1024` mock → returns null + Sentry event.

### P4.18 — Update docs/phase-2-handoff.md "fix-laters" + "what's left"

Mark Phase 2 hardening complete; surface remaining items: real EDI client implementation, real SP-API messaging client, atomic budget claim, search_memory RLS (see Open Questions).

### P4.19 — Commit

`Phase 2 hardening — Phase 4: cred-gate hardening + cross-layer cleanup`

---

## Final

- Run `/codex-review` on `e61ea77..HEAD` → confirm all 50 findings closed, no regressions.
- Move plan to `tmp/done-plans/`.

---

## Tasks (ordered, runnable as 4 sequential `/implement` calls)

**Phase 1 (commit 1):** P1.1 → P1.2 → P1.3 → P1.4 → P1.5 → P1.6 → P1.7. (No migration.)

**Phase 2 (commit 2):** P2.1 (apply migration) → P2.2 → P2.3 → P2.4 → P2.5 → P2.6 → P2.7 → P2.8.

**Phase 3 (commit 3):** P3.1 (apply migration) → P3.2 → P3.3 → P3.4 → P3.5 → P3.6 → P3.7 → P3.8 → P3.9 → P3.10 → P3.11 → P3.12 → P3.13 → P3.14 → P3.15 → P3.16.

**Phase 4a (commit 4): migration + cred-gate.** P4.1 (apply migration) → P4.2 (env-gate) → P4.3 (cred-gate factories) → P4.4 (NotImplementedError) → P4.5 (Retry-After) → P4.6 (Keepa bucket) → P4.7 (Twilio E.164 + sms_sends) → P4.8 (Voyage guards) + add `seed-dev-data.ts watchlist_status` union update → P4.10 (LWA cache + lease-table refresh).

**Phase 4b (commit 5): cross-layer cleanup.** P4.9 (orders/status normalizer) → P4.11 (rejectOne wiring to reject route + dismiss_all_briefings) → P4.12 (enqueue_job pharmacy_id) → P4.13 (bookkeeper tenant filter + recordLLMUsage signature) → P4.14 (ToolContext type unify + search_memory comment) → P4.15 (flag-anomaly reverse scope) → P4.16 (Zod schema loosen) → P4.17 (validate) → P4.18 (handoff doc update) → P4.19 (commit).

**P4b search_memory comment task** (added per Pass 2 #11): in `lib/tools/search_memory.ts` prepend a header comment:
```typescript
// SECURITY: This tool relies on ctx.pharmacyId being correctly threaded by the
// caller. Service-role client bypasses RLS. Future tool authors: NEVER call
// supabase queries here without enforcing pharmacy_id scope. RLS plumbing on
// the memory table is Phase 3+ multi-tenant work.
```

---

## Open Questions

1. **search_memory RLS defense-in-depth (E6).** Current state: service-role client + RPC explicitly filters by pharmacy_id. Plan keeps this as-is for Phase 2 (single-tenant). True RLS plumbing on `memory` deferred to Phase 3+ multi-tenant work. Acceptable?

2. **Atomic budget claim (F8) deferred.** Current state: read-then-write race window is each LLM call's duration (~5-30s). Worst-case 4-way concurrency on a webhook storm: ~$5/day overshoot in pathological cases. Median-load expected: <$10/year. Acceptable to defer until Phase 3+ multi-tenant work, OR ship inline as a 30-LOC `update budgets set spent=spent+delta where spent+delta <= cap returning *` pattern in Phase 3 if reviewer disagrees.

3. **Real EDI client + Real SP-API messaging client.** These are Phase 4+ work (separate plan). Cred-gate won't flip until `*_REAL_CLIENT_READY=true` opt-in even with creds populated. OK?

---

## Deprecated Code Removed

- Inline `30 * 60 * 1000` undo expiry calc in `lib/agents/account-health.ts:171` (kernel handles it now).
- Unchecked `audit_log` insert in `lib/agents/account-health.ts:172-185` (RPC handles it now).
- Fake `{ok:true}` in `lib/sp-api/messaging.ts:11` (replaced by NotImplementedError).
- Header comment in `lib/tools/dismiss_all_briefings.ts:1-4` (was already wrong).
- `process.exit(2)` in `lib/agents/_shared.ts:39` (replaced by throw).
- Both-branches-identical `lib/keepa/client.ts:62 const refillIn = ... ? 5000 : 5000` (replaced by `lastRefillIn ?? 5000`).
- Fail-open `console.warn` path in `lib/rate-limit.ts:23-26` (replaced by LRU + Sentry).

## Confidence: 8.5/10

One-pass-per-phase implementation feasible. Risks:
- Postgres RPC complexity (approve_audit_atomic with dynamic table-name back-link via `format(... %I ...)` — verify SQL injection-safe); precheck migration may halt Phase 4 if any NULL row exists (operator must clean up first).
- `lru-cache@^10` Node 20+ ESM/CJS interop — verify in Phase 1.
- `system+account-health@pharm1.local` actor email is synthetic; if any future reporting code groups by `audit_log.actor`, the system-actor convention surfaces. The `actor_kind` column is the durable signal.
