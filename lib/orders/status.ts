// orders.status normalizer — maps SP-API CamelCase OrderStatus values onto the
// canonical lowercase set enforced by orders_status_check (migration
// 20260505000004). Throws on unknown so the caller can wrap with try/catch
// and emit a Sentry warning rather than corrupt the row.

const SP_API_TO_CANONICAL: Record<string, string> = {
  Pending: 'pending',
  Unshipped: 'unshipped',
  PartiallyShipped: 'partially_shipped',
  Shipped: 'shipped',
  Canceled: 'canceled',
  Unfulfillable: 'unfulfillable',
  InvoiceUnconfirmed: 'invoice_unconfirmed',
  PendingAvailability: 'pending_availability',
};

const VALID_STATUSES = new Set([
  'pending',
  'unshipped',
  'partially_shipped',
  'shipped',
  'canceled',
  'unfulfillable',
  'invoice_unconfirmed',
  'pending_availability',
  'new',
  'ordered_from_supplier',
  'delivered',
  'returned',
  'refunded',
]);

export function normalizeOrderStatus(raw: string): string {
  const c = SP_API_TO_CANONICAL[raw] ?? raw.toLowerCase();
  if (!VALID_STATUSES.has(c)) {
    throw new Error(`[order-status] unknown status: ${raw}`);
  }
  return c;
}
