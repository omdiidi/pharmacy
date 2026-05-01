// list_on_amazon executor — STUB.
// Forward inserts a `pending_listings` row (status='pending') and logs the
// SP-API call we would have made. Reverse marks the row cancelled.
// When SP-API approval lands, real createFeed / deleteFeed calls swap into
// these two methods; the kernel contract does not change.

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const ListOnAmazonParamsSchema = z.object({
  product_id: z.string().uuid(),
  proposed_title: z.string().min(1).max(500),
  proposed_bullets: z.array(z.string()).min(1).max(10),
  proposed_price: z.number().positive(),
  reasoning: z.string().optional(),
});

export const listOnAmazon: Executor = {
  kind: 'list_on_amazon',

  async forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult> {
    const validated = ListOnAmazonParamsSchema.parse(params);
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('pending_listings')
      .insert({
        pharmacy_id: ctx.pharmacyId,
        product_id: validated.product_id,
        proposed_title: validated.proposed_title,
        proposed_bullets: validated.proposed_bullets,
        proposed_price: validated.proposed_price,
        reasoning: validated.reasoning ?? null,
        status: 'pending',
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(
        `list_on_amazon.forward: pending_listings insert failed: ${error?.message ?? 'no row returned'}`,
      );
    }

    console.log(
      `[STUB] would call SP-API createFeed for product ${validated.product_id} (pending_listing ${data.id})`,
    );

    return { pending_listing_id: data.id };
  },

  async reverse(
    _params: unknown,
    forwardResult: ExecutorResult,
  ): Promise<ExecutorResult> {
    const pendingListingId = forwardResult.pending_listing_id;
    if (typeof pendingListingId !== 'string') {
      return { reverted: false, reason: 'no pending_listing_id in forward result' };
    }

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('pending_listings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', pendingListingId);

    if (error) {
      throw new Error(
        `list_on_amazon.reverse: pending_listings update failed: ${error.message}`,
      );
    }

    console.log(`[STUB] would call SP-API deleteFeed for pending_listing ${pendingListingId}`);
    return { reverted: true, pending_listing_id: pendingListingId };
  },
};
