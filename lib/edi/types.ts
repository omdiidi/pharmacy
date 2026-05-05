// Shared EDI types. Wholesaler enum + WholesalerSnapshot shape used by
// Fulfillment Ops's payload + briefing data_snapshot.

import { z } from 'zod';

export const WHOLESALERS = ['abc', 'mckesson', 'cardinal', 'parmed', 'ezrirx'] as const;
export type Wholesaler = (typeof WHOLESALERS)[number];

export const WholesalerSnapshotSchema = z.object({
  wholesaler: z.enum(WHOLESALERS),
  ndc: z.string(),
  product_name: z.string(),
  unit_price: z.number().nonnegative(),
  pack_size: z.string(),
  stock_qty: z.number().int().nonnegative(),
  eta_days: z.number().int().nonnegative(),
  captured_at: z.string(),
});
export type WholesalerSnapshot = z.infer<typeof WholesalerSnapshotSchema>;

export type AdvanceShipNotice = {
  bsn_number: string;
  tracking_number: string | null;
  shipped_at: string;
  items: Array<{ ndc: string; quantity: number; pack_size: string | null }>;
};
