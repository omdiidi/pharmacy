-- Phase 2 Wave 1 — enum addition.
-- Postgres forbids `ALTER TYPE ... ADD VALUE` inside a transaction block, so this
-- lives in its own migration file and is applied as a single-statement call.

alter type brand_auth_status add value if not exists 'paused';
