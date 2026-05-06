-- Phase 4b — Migration: orders.status normalize + CHECK constraint.
-- Runs AFTER Phase 4b code deploys with lib/orders/status.ts so new SP-API
-- writes are already canonical. This migration backfills any pre-existing
-- CamelCase rows + locks the column to the canonical lowercase set.

begin;

-- Map SP-API CamelCase → canonical snake_case BEFORE adding CHECK.
update orders set status = case status
  when 'Pending' then 'pending'
  when 'Unshipped' then 'unshipped'
  when 'PartiallyShipped' then 'partially_shipped'
  when 'Shipped' then 'shipped'
  when 'Canceled' then 'canceled'
  when 'Unfulfillable' then 'unfulfillable'
  when 'InvoiceUnconfirmed' then 'invoice_unconfirmed'
  when 'PendingAvailability' then 'pending_availability'
  else lower(status)
end
where status ~ '[A-Z]' or status <> lower(status);

-- Precheck: fail loud if any row remains non-canonical.
do $$
declare v_bad int;
declare v_sample text;
begin
  select count(*) into v_bad from orders
    where status not in (
      'pending','unshipped','partially_shipped','shipped','canceled',
      'unfulfillable','invoice_unconfirmed','pending_availability',
      'new','ordered_from_supplier','delivered','returned','refunded'
    );
  if v_bad > 0 then
    select string_agg(distinct status, ',') into v_sample from orders
      where status not in (
        'pending','unshipped','partially_shipped','shipped','canceled',
        'unfulfillable','invoice_unconfirmed','pending_availability',
        'new','ordered_from_supplier','delivered','returned','refunded'
      );
    raise exception 'orders has % rows with non-canonical status (samples: %)', v_bad, v_sample;
  end if;
end $$;

alter table orders add constraint orders_status_check
  check (status in (
    'pending','unshipped','partially_shipped','shipped','canceled',
    'unfulfillable','invoice_unconfirmed','pending_availability',
    'new','ordered_from_supplier','delivered','returned','refunded'
  ));

commit;
