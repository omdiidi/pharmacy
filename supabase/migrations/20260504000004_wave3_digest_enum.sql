-- Phase 2 Wave 3 — enum addition for Chief of Staff Digest agent.
-- Postgres forbids `ALTER TYPE ... ADD VALUE` inside a transaction block, so
-- this lives in its own migration file (same precedent as Wave 1's brand_paused
-- enum-add at 20260504000001_wave1_brand_paused_enum.sql).

alter type briefing_type add value if not exists 'digest';
