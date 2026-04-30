-- Briefings + Inbox + audit + observability tables.
-- briefings = agent-emitted proposals; inbox_items = Kaleem-facing queue with state lifecycle.
-- audit_log records every action (with 30-min undo). claude_usage and backup_log support
-- daily-budget enforcement and tamper-evident backup tracking.

create type briefing_type as enum (
  'hot_arbitrage', 'new_opportunity', 'restock', 'seasonal',
  'reprice_up', 'reprice_down', 'suspend', 'watchlist',
  'order_to_fulfill', 'customer_message', 'account_health', 'strategic',
  'rx_shortage_adjacency', 'fda_recall_triggered', 'tic_certification_gap'
);

create type inbox_state as enum ('pending', 'seen', 'acted', 'archived', 'dismissed');

create table briefings (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  source_agent text not null,   -- 'research_analyst', 'repricer', etc.
  source_job_id uuid,           -- minicrew job id
  briefing_type briefing_type not null,
  title text not null,
  summary text not null,         -- 1-3 sentences in natural language
  rationale text,                -- longer "why" explanation
  confidence numeric check (confidence between 0 and 1),
  urgency integer check (urgency between 1 and 5) default 3,
  related_entity_type text,
  related_entity_id uuid,
  proposed_actions jsonb,        -- [{ kind: 'list', params: {...} }, ...]
  data_snapshot jsonb,           -- full data at briefing time for replay (50KB soft cap; overflow to Storage)
  reasoning_trail jsonb,         -- signals + memory retrievals used
  created_at timestamptz default now()
);
create index briefings_pharmacy_created_idx on briefings(pharmacy_id, created_at desc);
create index briefings_type_idx on briefings(briefing_type);

create table inbox_items (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  briefing_id uuid not null references briefings(id) on delete cascade,
  state inbox_state not null default 'pending',
  seen_at timestamptz,
  acted_at timestamptz,
  action_taken text,
  action_params jsonb,
  dismissed_reason text,
  created_at timestamptz default now(),
  -- Prevent duplicate inbox rows on agent retries
  unique (pharmacy_id, briefing_id)
);
create index inbox_state_idx on inbox_items(pharmacy_id, state, created_at desc);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  actor text not null,           -- 'kaleem', agent name, 'system'
  action text not null,          -- 'list', 'reprice', 'pause', 'approve_briefing', etc.
  target_entity_type text,
  target_entity_id uuid,
  params jsonb,
  result jsonb,
  undo_window_expires_at timestamptz,
  undone_at timestamptz,
  created_at timestamptz default now()
);
create index audit_target_idx on audit_log(target_entity_type, target_entity_id);
create index audit_created_idx on audit_log(created_at desc);

-- Claude API usage tracking (per-request, per-user, for daily budget enforcement)
create table claude_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text,                        -- Anthropic request ID for correlation
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer default 0,
  cache_creation_tokens integer default 0,
  estimated_cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz default now()
);
create index claude_usage_user_day_idx on claude_usage(user_id, created_at desc);

-- Backup log (sha256 + size per successful pg_dump; append-only tamper trail)
create table backup_log (
  id bigserial primary key,
  filename text not null,
  sha256 text not null,
  size_bytes bigint not null,
  created_at timestamptz default now()
);
