// pause_brand executor.
// Upserts a brand_authorization row with status='paused', paused_until, prior_status.
// Reverse: if forward inserted a new row, delete it; if it updated an existing
// row, restore the prior_status and clear paused_until/prior_status.

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';
import type { Database } from '@/lib/supabase/types';

type BrandAuthStatus = Database['public']['Enums']['brand_auth_status'];

const ParamsSchema = z.object({
  brand: z.string().min(1).max(200),
  reason: z.string().min(1).max(500),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // ISO date (YYYY-MM-DD)
});

export const pauseBrand: Executor = {
  kind: 'pause_brand',

  async forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult> {
    const v = ParamsSchema.parse(params);
    const supabase = createAdminClient();

    const { data: existing, error: existErr } = await supabase
      .from('brand_authorization')
      .select('id, status')
      .eq('pharmacy_id', ctx.pharmacyId)
      .eq('brand', v.brand)
      .limit(1)
      .maybeSingle();
    if (existErr) {
      throw new Error(`pause_brand.forward(lookup): ${existErr.message}`);
    }

    if (existing) {
      const priorStatus = existing.status as BrandAuthStatus;
      const { error } = await supabase
        .from('brand_authorization')
        .update({
          status: 'paused',
          paused_until: v.until,
          prior_status: priorStatus,
          notes: v.reason,
        })
        .eq('id', existing.id);
      if (error) {
        throw new Error(`pause_brand.forward(update): ${error.message}`);
      }
      return {
        brand_authorization_id: existing.id,
        prior_status: priorStatus,
        created: false,
      };
    }

    const { data, error } = await supabase
      .from('brand_authorization')
      .insert({
        pharmacy_id: ctx.pharmacyId,
        brand: v.brand,
        status: 'paused',
        paused_until: v.until,
        prior_status: 'unknown',
        notes: v.reason,
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(`pause_brand.forward(insert): ${error?.message ?? 'no row'}`);
    }
    return {
      brand_authorization_id: data.id,
      prior_status: 'unknown' as BrandAuthStatus,
      created: true,
    };
  },

  async reverse(
    _params: unknown,
    forwardResult: ExecutorResult,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const supabase = createAdminClient();
    const result = forwardResult as {
      brand_authorization_id?: string;
      prior_status?: BrandAuthStatus;
      created?: boolean;
    };
    const id = result.brand_authorization_id;
    if (!id) {
      return { reverted: false, reason: 'missing brand_authorization_id in forward result' };
    }
    if (result.created) {
      const { error } = await supabase
        .from('brand_authorization')
        .delete()
        .eq('id', id)
        .eq('pharmacy_id', ctx.pharmacyId);
      if (error) {
        throw new Error(`pause_brand.reverse(delete): ${error.message}`);
      }
      return { reverted: true, deleted: true };
    }
    const priorStatus = (result.prior_status ?? 'unknown') as BrandAuthStatus;
    const { error } = await supabase
      .from('brand_authorization')
      .update({ status: priorStatus, paused_until: null, prior_status: null })
      .eq('id', id)
      .eq('pharmacy_id', ctx.pharmacyId);
    if (error) {
      throw new Error(`pause_brand.reverse(restore): ${error.message}`);
    }
    return { reverted: true, deleted: false };
  },
};
