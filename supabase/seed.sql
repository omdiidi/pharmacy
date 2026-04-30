-- supabase/seed.sql
-- Schema-required rows that every environment (dev, staging, prod) needs to boot.
-- Dev-only sample fixtures live in scripts/seed-dev-data.ts (not here).
--
-- Idempotent: safe to re-run via `supabase db reset` or applied after migrations.

-- ---------------------------------------------------------------------------
-- Default pharmacy (Kaleem). user_pharmacy_access is bootstrapped at first
-- magic-link callback once Kaleem's auth.users row exists.
-- ---------------------------------------------------------------------------
insert into pharmacies (id, name, dea_number, address)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Kaleem Pharmacy (default)',
  null,
  '{}'::jsonb
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Tier 0 policy_rules — categorical auto-excludes that never list, regardless
-- of margin. These are the "ineligible to play" filter the Research Analyst
-- applies before any scoring.
-- ---------------------------------------------------------------------------
insert into policy_rules (tier, rule_kind, pattern, reason, active)
select 0, 'ingredient_block', 'pseudoephedrine',
       'Behind-counter scheduled listing requirement (PSE)', true
where not exists (select 1 from policy_rules where tier = 0 and rule_kind = 'ingredient_block' and pattern = 'pseudoephedrine');

insert into policy_rules (tier, rule_kind, pattern, reason, active)
select 0, 'ingredient_block', 'ephedrine',
       'Scheduled listing requirement; restricted', true
where not exists (select 1 from policy_rules where tier = 0 and rule_kind = 'ingredient_block' and pattern = 'ephedrine');

insert into policy_rules (tier, rule_kind, pattern, reason, active)
select 0, 'ingredient_block', 'kratom',
       'Restricted on Amazon; legal grey zone', true
where not exists (select 1 from policy_rules where tier = 0 and rule_kind = 'ingredient_block' and pattern = 'kratom');

insert into policy_rules (tier, rule_kind, pattern, reason, active)
select 0, 'ingredient_block', 'cbd',
       'Amazon prohibits CBD listings', true
where not exists (select 1 from policy_rules where tier = 0 and rule_kind = 'ingredient_block' and pattern = 'cbd');

insert into policy_rules (tier, rule_kind, pattern, reason, active)
select 0, 'ingredient_block', 'lidocaine_gt_4pct',
       'Lidocaine >4% (>5% per FDA) requires Rx; not OTC', true
where not exists (select 1 from policy_rules where tier = 0 and rule_kind = 'ingredient_block' and pattern = 'lidocaine_gt_4pct');

insert into policy_rules (tier, rule_kind, pattern, reason, active)
select 0, 'category_block', 'dea_scheduled',
       'DEA-scheduled substances cannot be listed on Amazon', true
where not exists (select 1 from policy_rules where tier = 0 and rule_kind = 'category_block' and pattern = 'dea_scheduled');

insert into policy_rules (tier, rule_kind, pattern, reason, active)
select 0, 'category_block', 'transparency_no_codes',
       'Brand uses Amazon Transparency without us holding codes; auto-exclude', true
where not exists (select 1 from policy_rules where tier = 0 and rule_kind = 'category_block' and pattern = 'transparency_no_codes');

insert into policy_rules (tier, rule_kind, pattern, reason, active)
select 0, 'category_block', 'fda_recalled',
       'FDA-recalled SKUs auto-exclude (cross-reference fda_recall signals)', true
where not exists (select 1 from policy_rules where tier = 0 and rule_kind = 'category_block' and pattern = 'fda_recalled');

-- ---------------------------------------------------------------------------
-- Starter brand_authorization rows (global defaults; pharmacy_id NULL).
-- Pharmacy-specific overrides are added later as Kaleem builds LOA history.
-- pharmacy_id NULL means the unique(pharmacy_id, brand) constraint won't
-- fire on NULL, so we guard each insert with `where not exists`.
-- ---------------------------------------------------------------------------
insert into brand_authorization (pharmacy_id, brand, status, notes)
select null, 'Pfizer', 'hunts_resellers'::brand_auth_status,
       'Pfizer historically pursues unauthorized resellers via IP complaints'
where not exists (select 1 from brand_authorization where pharmacy_id is null and brand = 'Pfizer');

insert into brand_authorization (pharmacy_id, brand, status, notes)
select null, 'Pharmavite', 'hunts_resellers'::brand_auth_status,
       'Maker of Nature Made; restrictive on unauthorized Amazon resellers'
where not exists (select 1 from brand_authorization where pharmacy_id is null and brand = 'Pharmavite');

insert into brand_authorization (pharmacy_id, brand, status, notes)
select null, 'Nature Made', 'hunts_resellers'::brand_auth_status,
       'Pharmavite brand; restrictive on unauthorized Amazon resellers'
where not exists (select 1 from brand_authorization where pharmacy_id is null and brand = 'Nature Made');

insert into brand_authorization (pharmacy_id, brand, status, notes)
select null, 'Johnson & Johnson', 'hunts_resellers'::brand_auth_status,
       'Active IP enforcement; treat as high reseller-risk by default'
where not exists (select 1 from brand_authorization where pharmacy_id is null and brand = 'Johnson & Johnson');

insert into brand_authorization (pharmacy_id, brand, status, notes)
select null, 'Pure Encapsulations', 'needs_loa'::brand_auth_status,
       'Practitioner-channel brand; LOA required to list'
where not exists (select 1 from brand_authorization where pharmacy_id is null and brand = 'Pure Encapsulations');

insert into brand_authorization (pharmacy_id, brand, status, notes)
select null, 'Garden of Life', 'needs_loa'::brand_auth_status,
       'Authorized-reseller program; LOA required'
where not exists (select 1 from brand_authorization where pharmacy_id is null and brand = 'Garden of Life');

insert into brand_authorization (pharmacy_id, brand, status, notes)
select null, 'Nestlé', 'hunts_resellers'::brand_auth_status,
       'Aggressive on unauthorized resale of consumer-health portfolio'
where not exists (select 1 from brand_authorization where pharmacy_id is null and brand = 'Nestlé');

-- ---------------------------------------------------------------------------
-- Default Kaleem preferences as a memory row (kind='preferences').
-- Phase 1 chatbot reads this via getKaleemPreferences() so it has real
-- context on first boot, before Kaleem has tuned anything.
-- Shape matches lib/system-prompt.ts KaleemPreferences type.
-- ---------------------------------------------------------------------------
insert into memory (
  pharmacy_id,
  kind,
  source,
  content,
  metadata,
  importance
)
select
  '00000000-0000-0000-0000-000000000001'::uuid,
  'preferences'::memory_kind,
  'kaleem',
  'Kaleem''s working preferences: approve every action, terse comms, conservative risk, min 25% margin floor, max 300% scarcity premium, notify via inbox.',
  jsonb_build_object(
    'autopilot_level', 'approve_every',
    'communication_style', 'terse',
    'risk_tolerance', 'conservative',
    'min_margin_floor_pct', 25,
    'max_scarcity_premium_pct', 300,
    'notification_channels', jsonb_build_array('inbox')
  ),
  1.0
where not exists (
  select 1 from memory
  where pharmacy_id = '00000000-0000-0000-0000-000000000001'::uuid
    and kind = 'preferences'
    and source = 'kaleem'
);
