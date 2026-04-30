-- Core domain schema: pharmacies, products, listings, orders, signals, health, wholesaler stock.
-- Establishes the multi-tenant boundary via user_pharmacy_access and registers trigram indexes
-- for ilike search and moddatetime triggers for updated_at maintenance.

create extension if not exists pg_trgm;       -- trigram indexes for ilike
create extension if not exists moddatetime;   -- updated_at trigger

-- Multi-tenant-ready, single-tenant for v1
create table pharmacies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dea_number text,
  address jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger pharmacies_set_updated_at before update on pharmacies
  for each row execute function moddatetime(updated_at);

create table products (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  asin text,                   -- Amazon Standard Identification Number
  upc text,
  ndc text,
  name text not null,
  brand text,
  category text,
  form text,                   -- "tablet", "capsule", "cream" etc.
  pack_size text,              -- "120ct", "1oz" etc.
  default_supplier text,
  last_listed_price numeric(10,2),
  last_listed_at timestamptz,
  watchlist_status text check (watchlist_status in ('none', 'watching', 'active', 'paused', 'blocked')) default 'none',
  blocked_reason text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Partial unique indexes (allow NULLs but enforce uniqueness when values exist, per pharmacy)
create unique index products_pharmacy_asin_uq on products(pharmacy_id, asin) where asin is not null;
create unique index products_pharmacy_ndc_uq  on products(pharmacy_id, ndc)  where ndc is not null;
create unique index products_pharmacy_upc_uq  on products(pharmacy_id, upc)  where upc is not null;
-- Trigram indexes for ilike-based text search (used by query_products)
create index products_name_trgm_idx     on products using gin (name gin_trgm_ops);
create index products_brand_trgm_idx    on products using gin (brand gin_trgm_ops);
create index products_category_trgm_idx on products using gin (category gin_trgm_ops);

create trigger products_set_updated_at before update on products
  for each row execute function moddatetime(updated_at);

-- User → Pharmacy mapping (the multi-tenant boundary)
-- Phase 1: one row for Kaleem. Phase 2: staff accounts add more rows.
create table user_pharmacy_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  role text not null check (role in ('owner', 'staff', 'viewer')) default 'owner',
  created_at timestamptz default now(),
  primary key (user_id, pharmacy_id)
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid references pharmacies(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  platform text not null check (platform in ('amazon', 'ebay', 'own_store')),
  platform_listing_id text,    -- SP-API listing id, eBay item id
  status text not null check (status in ('active', 'paused', 'suspended', 'deleted')),
  current_price numeric(10,2),
  current_source_supplier text,
  current_source_cost numeric(10,2),
  buybox_status text,          -- 'winning', 'losing', 'unknown'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger listings_set_updated_at before update on listings
  for each row execute function moddatetime(updated_at);

create table orders (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid references pharmacies(id) on delete cascade,
  listing_id uuid references listings(id),
  platform text not null,
  platform_order_id text not null,
  customer_address jsonb,
  sold_price numeric(10,2),
  sold_at timestamptz,
  supplier_source text,        -- which wholesaler fulfilled
  supplier_cost numeric(10,2),
  shipping_cost numeric(10,2),
  platform_fees numeric(10,2),
  net_profit numeric(10,2),
  status text not null,         -- 'new', 'ordered_from_supplier', 'shipped', 'delivered', 'returned', 'refunded'
  tracking_number text,
  fulfilled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (platform, platform_order_id)
);

create trigger orders_set_updated_at before update on orders
  for each row execute function moddatetime(updated_at);

create table wholesaler_stock_snapshots (
  id bigserial primary key,
  product_id uuid references products(id) on delete cascade,
  supplier text not null,       -- 'abc', 'parmed', 'mckesson', 'cardinal', 'ezrirx'
  stock_qty integer,
  price numeric(10,2),
  anticipated_restock_date date,
  lot_number text,
  expiration_date date,
  captured_at timestamptz default now()
);
create index wss_product_captured_idx on wholesaler_stock_snapshots(product_id, captured_at desc);

create table signals (
  id bigserial primary key,
  product_id uuid references products(id) on delete cascade,
  source text not null,         -- 'keepa', 'sp_api', 'google_trends', 'fda_shortage', 'fda_recall', 'ebay'
  signal_type text not null,    -- 'bsr', 'offer_count', 'buybox_price', 'buybox_winner_channel', 'amazon_seller_flag', 'shortage_listed', 'recall', 'trend_rise'
  value_numeric numeric,
  value_text text,
  value_json jsonb,
  captured_at timestamptz default now()
);
create index signals_product_captured_idx on signals(product_id, source, signal_type, captured_at desc);

create table health_metrics (
  id bigserial primary key,
  pharmacy_id uuid references pharmacies(id) on delete cascade,
  platform text not null,
  metric text not null,         -- 'odr', 'late_ship', 'cancellation', 'vtr', 'buybox_pct'
  value numeric,
  captured_at timestamptz default now()
);
