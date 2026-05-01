-- Phase 2 Layer 1+2: pending_listings (executor breadcrumb for stubbed SP-API)
-- + system spend support on claude_usage (cron has no auth.users user_id).

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

-- Partial index supports `getTodaySpendUsd(supabase, null)` queries against system spend.
create index claude_usage_system_day_idx on claude_usage (created_at desc) where user_id is null;
