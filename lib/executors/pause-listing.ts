// pause_listing executor — STUB.
// Shared between Account Health's red-branch auto-pause and Repricer's suspend
// proposal (and Kaleem-clicked yellow-branch pauses). Forward inserts a
// `pending_health_actions` row (status='pending'). Reverse marks it cancelled.

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const ParamsSchema = z.object({
  listing_id: z.string().uuid(),
  triggered_by: z.enum(['account_health_red_auto', 'kaleem_click', 'repricer_suspend']),
  reasoning: z.string().max(2000).optional(),
});

export const pauseListing: Executor = {
  kind: 'pause_listing',

  async forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult> {
    const v = ParamsSchema.parse(params);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('pending_health_actions')
      .insert({
        pharmacy_id: ctx.pharmacyId,
        listing_id: v.listing_id,
        action_kind: 'pause_listing',
        triggered_by: v.triggered_by,
        reasoning: v.reasoning ?? null,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(
        `pause_listing.forward: pending_health_actions insert failed: ${error?.message ?? 'no row returned'}`,
      );
    }
    console.log(
      `[STUB] would call SP-API patchListingsItem (pause) for listing ${v.listing_id}`,
    );
    return { pending_health_action_id: data.id };
  },

  async reverse(_params: unknown, forwardResult: ExecutorResult): Promise<ExecutorResult> {
    const id = forwardResult.pending_health_action_id;
    if (typeof id !== 'string') {
      return { reverted: false, reason: 'no pending_health_action_id in forward result' };
    }
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('pending_health_actions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      throw new Error(
        `pause_listing.reverse: pending_health_actions update failed: ${error.message}`,
      );
    }
    return { reverted: true, pending_health_action_id: id };
  },
};
