-- Phase 2 Wave 2 — pending_* tables for SP-API-driven executors.
-- All three mirror pending_listings (id, pharmacy_id, *_id, proposed_*, status,
-- audit_log_id FK, sp_api_*_id, *_at, created_at). Status enums kept simple:
-- pending → sent/published/applied → cancelled.

-- 1. pending_pricing_changes — Repricer's reprice_listing executor.
--    'hold' is reserved for Wave 3 if Repricer ever proposes hold-with-undo.
create table pending_pricing_changes (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  decision text not null check (decision in ('match_bb', 'raise', 'drop', 'pause')),
  from_price numeric(10,2),
  to_price numeric(10,2),
  reasoning text,
  trigger text not null check (trigger in ('scheduled', 'event', 'manual')),
  status text not null check (status in ('pending', 'applied', 'cancelled')) default 'pending',
  audit_log_id uuid references audit_log(id),
  sp_api_submission_id text,                      -- null while stubbed; populated when SP-API patch lands
  applied_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index pending_pricing_changes_pharmacy_status_idx on pending_pricing_changes (pharmacy_id, status, created_at desc);
create index pending_pricing_changes_listing_idx on pending_pricing_changes (listing_id);

-- 2. pending_customer_messages — Customer Success's send_reply executor.
create table pending_customer_messages (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  amazon_order_id text,                            -- nullable until we wire real Messaging
  customer_message_id text,                        -- our internal id from the webhook payload
  channel text not null check (channel in ('amazon', 'ebay')) default 'amazon',
  proposed_text text not null,
  classification text not null check (classification in ('shipping', 'refund', 'general', 'medical_question', 'spam')),
  reasoning text,
  status text not null check (status in ('pending', 'sent', 'cancelled')) default 'pending',
  audit_log_id uuid references audit_log(id),
  sp_api_message_id text,                         -- null while stubbed
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index pending_customer_messages_pharmacy_status_idx on pending_customer_messages (pharmacy_id, status, created_at desc);

-- 3. pending_health_actions — Account Health's pause_listing + acknowledge_health_alert executors.
-- Note: pause_listing executor is shared with Repricer's `suspend` decision (both write here).
create table pending_health_actions (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  listing_id uuid references listings(id) on delete cascade,    -- nullable for non-listing-targeted health alerts
  action_kind text not null check (action_kind in ('pause_listing')),
  triggered_by text not null check (triggered_by in ('account_health_red_auto', 'kaleem_click', 'repricer_suspend')),
  reasoning text,
  status text not null check (status in ('pending', 'applied', 'cancelled')) default 'pending',
  audit_log_id uuid references audit_log(id),
  sp_api_submission_id text,
  applied_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index pending_health_actions_pharmacy_status_idx on pending_health_actions (pharmacy_id, status, created_at desc);
create index pending_health_actions_listing_idx on pending_health_actions (listing_id) where listing_id is not null;
