// add_to_watchlist executor.
// Forward: capture each product's prior watchlist_status (so undo can restore),
// then UPDATE products.watchlist_status='watching' for the requested ids.
// Reverse: restore each product's prior status.

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const ParamsSchema = z.object({
  product_ids: z.array(z.string().uuid()).min(1).max(20),
  reason: z.string().min(1).max(500),
});

export const addToWatchlist: Executor = {
  kind: 'add_to_watchlist',

  async forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult> {
    const v = ParamsSchema.parse(params);
    const supabase = createAdminClient();

    const { data: priors, error: priorErr } = await supabase
      .from('products')
      .select('id, watchlist_status')
      .eq('pharmacy_id', ctx.pharmacyId)
      .in('id', v.product_ids);
    if (priorErr) {
      throw new Error(`add_to_watchlist.forward(prior fetch): ${priorErr.message}`);
    }
    const priorMap: Record<string, string> = {};
    for (const r of priors ?? []) {
      priorMap[r.id] = r.watchlist_status ?? 'none';
    }

    const { error } = await supabase
      .from('products')
      .update({ watchlist_status: 'watching' })
      .eq('pharmacy_id', ctx.pharmacyId)
      .in('id', v.product_ids);
    if (error) {
      throw new Error(`add_to_watchlist.forward: ${error.message}`);
    }

    console.log(
      `[STUB] would notify research_analyst of ${v.product_ids.length} new watch items`,
    );
    return { product_ids: v.product_ids, prior_status: priorMap };
  },

  async reverse(
    _params: unknown,
    forwardResult: ExecutorResult,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const priorMap = (forwardResult.prior_status ?? {}) as Record<string, string>;
    const supabase = createAdminClient();
    let count = 0;
    for (const [id, prior] of Object.entries(priorMap)) {
      const { error } = await supabase
        .from('products')
        .update({ watchlist_status: prior })
        .eq('pharmacy_id', ctx.pharmacyId)
        .eq('id', id);
      if (error) {
        throw new Error(`add_to_watchlist.reverse(${id}): ${error.message}`);
      }
      count++;
    }
    return { reverted: true, count };
  },
};
