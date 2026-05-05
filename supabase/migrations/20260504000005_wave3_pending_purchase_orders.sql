-- Phase 2 Wave 3 — pending_purchase_orders for Fulfillment Ops's
-- generate_purchase_order executor. Mirrors pending_listings shape:
-- (id, pharmacy_id, FK_id, proposed_*, status, audit_log_id FK, edi_*_id,
--  applied_at, cancelled_at, created_at).
--
-- Wholesaler-specific fields: wholesaler text, proposed_unit_price numeric,
-- proposed_quantity int. Status enum: pending → applied → cancelled.
-- 'applied' = real EDI 850 sent (post-launch swap). FK ON DELETE behaviors
-- match the pending_listings precedent (cascade for pharmacy/order/product).

create table pending_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  wholesaler text not null,
  proposed_unit_price numeric(10,2) not null,
  proposed_quantity integer not null check (proposed_quantity > 0),
  proposed_eta date,
  reasoning text,
  status text not null check (status in ('pending', 'applied', 'cancelled')) default 'pending',
  audit_log_id uuid references audit_log(id),
  edi_850_envelope_id text,                       -- null while stubbed; populated when real EDI 850 send lands
  edi_855_acknowledgment_id text,                 -- post-send acknowledgment correlation id
  applied_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index pending_purchase_orders_pharmacy_status_idx on pending_purchase_orders (pharmacy_id, status, created_at desc);
create index pending_purchase_orders_order_idx on pending_purchase_orders (order_id) where order_id is not null;
