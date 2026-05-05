-- Phase 2 hardening — Phase 3: observability + cost protection
--
-- Adds:
--   webhook_dedupe        — SP-API NotificationId idempotence (24h TTL)
--   rate_limit_events     — string-key sliding-window counter (1h TTL)
--   cron_locks            — TTL heartbeat agent-name lock; PostgREST/PgBouncer-safe
--   purge_*               — janitor RPCs invoked by Render purge crons
--   claim_cron_lock       — RETURNING-based atomic claim (worker_id comparison)
--   release_cron_lock     — best-effort delete on caller's claim
--   jobs.pharmacy_id      — pharmacy scoping for the queue (multi-pharmacy ready)
--   jobs.submitted_by     — user attribution for queue-submitted work
--   claude_usage.pharmacy_id — pharmacy scoping for spend ledger; JOIN-driven
--                               backfill from user_pharmacy_access
--
-- See tmp/ready-plans/2026-05-04-phase-2-hardening-fixes.md P3.1 for design notes.

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
