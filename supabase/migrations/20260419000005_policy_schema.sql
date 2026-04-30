-- Policy schema: Tier 0/1/2 auto-exclude rules, per-brand reseller-risk classification,
-- and TIC (third-party testing) certification tracking required by Amazon Dec 2025.

-- The Tier 0/1/2 auto-exclude filter — applied before any scoring runs
create table policy_rules (
  id uuid primary key default gen_random_uuid(),
  tier integer not null check (tier between 0 and 2),
  rule_kind text not null check (rule_kind in ('ingredient_block', 'category_block', 'category_requires_docs', 'roi_floor', 'ship_shelf_life_min')),
  pattern text not null,        -- ingredient name, category name, threshold value, etc.
  reason text not null,         -- human-readable why (for audit)
  active boolean not null default true,
  effective_at timestamptz default now(),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index policy_rules_active_idx on policy_rules(active, tier);
create trigger policy_rules_set_updated_at before update on policy_rules
  for each row execute function moddatetime(updated_at);

-- Per-brand reseller-risk classification (driven by IP/LOA reality, not per Amazon category)
create type brand_auth_status as enum ('safe', 'needs_loa', 'hunts_resellers', 'transparency_enrolled', 'unknown');

create table brand_authorization (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid references pharmacies(id) on delete cascade, -- NULL = global default; pharmacy-specific overrides
  brand text not null,
  status brand_auth_status not null default 'unknown',
  loa_document_url text,        -- Supabase Storage URL when LOA obtained
  loa_expires_at date,
  last_incident_at timestamptz, -- last IP complaint / warning from this brand
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (pharmacy_id, brand)
);
create trigger brand_auth_set_updated_at before update on brand_authorization
  for each row execute function moddatetime(updated_at);

-- Dec 2025 Amazon TIC requirement: per-brand (or per-SKU) certification status
create table tic_certifications (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  sku text,                      -- NULL = brand-level cert; otherwise SKU-specific
  lab text not null check (lab in ('nsf', 'eurofins', 'ul_solutions', 'other')),
  cert_document_url text,
  issued_at date,
  expires_at date not null,     -- TIC certs expire annually
  status text not null check (status in ('active', 'expired', 'pending', 'revoked')) default 'active',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index tic_brand_expires_idx on tic_certifications(brand, expires_at desc);
create trigger tic_set_updated_at before update on tic_certifications
  for each row execute function moddatetime(updated_at);
