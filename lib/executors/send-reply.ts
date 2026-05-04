// send_reply executor — STUB.
// Forward inserts a `pending_customer_messages` row (status='pending'). Reverse
// marks it cancelled. classification='medical_question' is *never* dispatched
// here (Kaleem replies personally; the Customer Success agent emits a
// dismiss-only briefing for that path).

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const ParamsSchema = z.object({
  customer_message_id: z.string(),
  amazon_order_id: z.string().nullable(),
  channel: z.enum(['amazon', 'ebay']).default('amazon'),
  proposed_text: z.string().min(1).max(4000),
  classification: z.enum(['shipping', 'refund', 'general']),
  reasoning: z.string().max(2000).optional(),
});

export const sendReply: Executor = {
  kind: 'send_reply',

  async forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult> {
    const v = ParamsSchema.parse(params);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('pending_customer_messages')
      .insert({
        pharmacy_id: ctx.pharmacyId,
        amazon_order_id: v.amazon_order_id,
        customer_message_id: v.customer_message_id,
        channel: v.channel,
        proposed_text: v.proposed_text,
        classification: v.classification,
        reasoning: v.reasoning ?? null,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(
        `send_reply.forward: pending_customer_messages insert failed: ${error?.message ?? 'no row returned'}`,
      );
    }
    console.log(
      `[STUB] would call SP-API messaging endpoint for order ${v.amazon_order_id ?? '—'}`,
    );
    return { pending_customer_message_id: data.id };
  },

  async reverse(_params: unknown, forwardResult: ExecutorResult): Promise<ExecutorResult> {
    const id = forwardResult.pending_customer_message_id;
    if (typeof id !== 'string') {
      return { reverted: false, reason: 'no pending_customer_message_id in forward result' };
    }
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('pending_customer_messages')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      throw new Error(
        `send_reply.reverse: pending_customer_messages update failed: ${error.message}`,
      );
    }
    return { reverted: true, pending_customer_message_id: id };
  },
};
