-- Phase 2 hardening — Phase 4a: cred-gate hardening + integration constraints.
--
-- Adds:
--   pending_purchase_orders.order_id / product_id NOT NULL + wholesaler CHECK
--   pending_purchase_orders_order_idx (plain, replacing redundant partial)
--   orders.platform CHECK (amazon/ebay/own_store)
--   products.watchlist_status CHECK (now includes 'evaluating')
--   lwa_token_cache (singleton) — shared LWA bearer cache across replicas
--   sms_sends (briefing_id PK) — caller-side Twilio dedupe table
--   lwa_token_refreshes (singleton lease) — serialize concurrent LWA refreshes
--   claim_lwa_refresh / release_lwa_refresh RPCs — same RETURNING + worker_id
--                                                  pattern as claim_cron_lock
--
-- NOTE: orders.status normalize + CHECK is intentionally deferred to Phase 4b
-- (migration 20260505000004) so it co-ships with lib/orders/status.ts.
-- Landing the CHECK alone would break fulfillment-ops on any webhook arriving
-- between 4a and 4b.
--
-- See tmp/ready-plans/2026-05-04-phase-2-hardening-fixes.md P4.1 + P4.10.

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

-- Drop redundant partial-WHERE on now-NOT-NULL column; recreate as plain.
drop index if exists pending_purchase_orders_order_idx;
create index pending_purchase_orders_order_idx on pending_purchase_orders(order_id);

-- orders.platform CHECK (safe to land in 4a — no app code change needed).
alter table orders add constraint orders_platform_check
  check (platform in ('amazon','ebay','own_store'));

-- products.watchlist_status: drop+recreate CHECK with 'evaluating'.
alter table products drop constraint if exists products_watchlist_status_check;
alter table products add constraint products_watchlist_status_check
  check (watchlist_status in ('none','watching','evaluating','active','paused','blocked'));

-- LWA token cache (singleton).
create table if not exists lwa_token_cache (
  id int primary key default 1,
  token text not null,
  expires_at timestamptz not null,
  refreshed_at timestamptz not null default now(),
  constraint lwa_token_cache_singleton check (id = 1)
);

-- SMS sends dedupe (Twilio doesn't support SDK-level idempotency).
create table if not exists sms_sends (
  briefing_id uuid primary key references briefings(id) on delete cascade,
  sid text not null,
  sent_at timestamptz not null default now()
);

-- LWA refresh lease (singleton) — only one in-flight refresh allowed.
-- RETURNING + worker_id-compare pattern mirrors claim_cron_lock; works
-- correctly under PostgREST/PgBouncer (no session-scoped advisory locks).
create table if not exists lwa_token_refreshes (
  id int primary key default 1,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 seconds'),
  worker_id text not null,
  constraint lwa_token_refreshes_singleton check (id = 1)
);

create or replace function claim_lwa_refresh(p_worker_id text)
returns boolean language sql as $$
  -- RETURNING-based claim (same shape as claim_cron_lock):
  --   fresh INSERT → returns caller's worker_id → claim true
  --   conflict + WHERE-met (expired) → returns caller's worker_id → claim true
  --   conflict + WHERE-blocked (still held) → returns nothing → claim false
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

commit;
