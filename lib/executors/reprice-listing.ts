// reprice_listing executor — STUB.
// Forward inserts a `pending_pricing_changes` row (status='pending') and logs
// the SP-API patchListingsItem we would have made. Reverse marks the row
// cancelled. Decision 'hold' is reserved for Wave 3 — agent's hold path emits
// a dismiss-only briefing, never reaches this executor.

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const ParamsSchema = z.object({
  listing_id: z.string().uuid(),
  decision: z.enum(['match_bb', 'raise', 'drop']),
  from_price: z.number().nonnegative().nullable(),
  to_price: z.number().nonnegative().nullable(),
  reasoning: z.string().max(2000).optional(),
  trigger: z.enum(['scheduled', 'event', 'manual']).default('manual'),
});

export const repriceListing: Executor = {
  kind: 'reprice',

  async forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult> {
    const v = ParamsSchema.parse(params);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('pending_pricing_changes')
      .insert({
        pharmacy_id: ctx.pharmacyId,
        listing_id: v.listing_id,
        decision: v.decision,
        from_price: v.from_price,
        to_price: v.to_price,
        reasoning: v.reasoning ?? null,
        trigger: v.trigger,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(
        `reprice.forward: pending_pricing_changes insert failed: ${error?.message ?? 'no row returned'}`,
      );
    }
    console.log(
      `[STUB] would call SP-API patchListingsItem for listing ${v.listing_id} -> $${v.to_price ?? '—'}`,
    );
    return { pending_pricing_change_id: data.id };
  },

  async reverse(_params: unknown, forwardResult: ExecutorResult): Promise<ExecutorResult> {
    const id = forwardResult.pending_pricing_change_id;
    if (typeof id !== 'string') {
      return { reverted: false, reason: 'no pending_pricing_change_id in forward result' };
    }
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('pending_pricing_changes')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      throw new Error(`reprice.reverse: pending_pricing_changes update failed: ${error.message}`);
    }
    return { reverted: true, pending_pricing_change_id: id };
  },
};
