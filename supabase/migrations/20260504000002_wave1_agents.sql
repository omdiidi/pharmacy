-- Phase 2 Wave 1 — structural deltas for self-contained agents.
-- Companion to 20260504000001_wave1_brand_paused_enum.sql (which must run first).

-- 1. brand_authorization paused_until + prior_status (clean undo).
alter table brand_authorization add column if not exists paused_until date;
alter table brand_authorization add column if not exists prior_status brand_auth_status;

-- 2. Index for "what briefings did this agent produce in the last N days"
-- (Reflector queries last 7 days of briefings filtered by source_agent;
-- Portfolio Manager queries 30 days).
create index if not exists briefings_pharmacy_agent_created_idx
  on briefings (pharmacy_id, source_agent, created_at desc);
