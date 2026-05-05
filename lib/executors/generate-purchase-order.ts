// generate_purchase_order executor — STUB.
// Forward inserts a `pending_purchase_orders` row (status='pending') and logs
// the EDI 850 we would have sent. Reverse marks the row cancelled (post-launch
// swap may add a 860 PO Change). Real EDI 850 send replaces the log line.

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const Params = z.object({
  order_id: z.string().uuid(),
  product_id: z.string().uuid(),
  wholesaler: z.enum(['abc', 'mckesson', 'cardinal', 'parmed', 'ezrirx']),
  proposed_unit_price: z.number().positive(),
  proposed_quantity: z.number().int().positive(),
  proposed_eta: z.string().nullable().optional(),
  reasoning: z.string().max(2000).optional(),
});

export const generatePurchaseOrder: Executor = {
  kind: 'generate_purchase_order',

  async forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult> {
    const v = Params.parse(params);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('pending_purchase_orders')
      .insert({
        pharmacy_id: ctx.pharmacyId,
        order_id: v.order_id,
        product_id: v.product_id,
        wholesaler: v.wholesaler,
        proposed_unit_price: v.proposed_unit_price,
        proposed_quantity: v.proposed_quantity,
        proposed_eta: v.proposed_eta ?? null,
        reasoning: v.reasoning ?? null,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(
        `generate_purchase_order.forward: ${error?.message ?? 'no row returned'}`,
      );
    }
    console.log(
      `[STUB] would generate PO PDF and send EDI 850 to ${v.wholesaler} for product ${v.product_id} ` +
        `(qty ${v.proposed_quantity} @ $${v.proposed_unit_price})`,
    );
    return { pending_purchase_order_id: data.id };
  },

  async reverse(
    _params: unknown,
    forwardResult: ExecutorResult,
  ): Promise<ExecutorResult> {
    const id = forwardResult.pending_purchase_order_id;
    if (typeof id !== 'string') {
      return { reverted: false, reason: 'missing pending_purchase_order_id' };
    }
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('pending_purchase_orders')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      throw new Error(`generate_purchase_order.reverse: ${error.message}`);
    }
    console.log(
      '[STUB] would send EDI 860 PO Change Request to wholesaler for cancellation',
    );
    return { reverted: true, pending_purchase_order_id: id };
  },
};
