// dismiss_all_briefings — chat tool. Marks matching pending inbox_items as
// 'dismissed' via the kernel rejectOne function. Each dismissal records an
// audit_log row through reject_action_atomic, matching the UI Reject button.

import { z } from 'zod';
import type OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import { rejectOne } from '@/lib/kernel/reject';
import type { ToolContext } from './index';

const InputSchema = z.object({
  source_agent: z.string().optional(),
  briefing_type: z.string().optional(),
  briefing_ids: z.array(z.string().uuid()).optional(),
  max: z.number().int().min(1).max(100).default(50),
});

export const dismiss_all_briefings_def: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'dismiss_all_briefings',
    description:
      'Dismiss a batch of pending briefings filtered by source_agent, briefing_type, or explicit IDs. Same effect as the UI Reject button. No executor invoked. Maximum 100 per call.',
    parameters: {
      type: 'object',
      properties: {
        source_agent: { type: 'string' },
        briefing_type: { type: 'string' },
        briefing_ids: { type: 'array', items: { type: 'string' } },
        max: { type: 'number', default: 50 },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export async function dismiss_all_briefings(
  rawInput: unknown,
  ctx: ToolContext,
): Promise<string> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) return JSON.stringify({ error: parsed.error.message });
  const { source_agent, briefing_type, briefing_ids, max } = parsed.data;

  if (!source_agent && !briefing_type && (!briefing_ids || briefing_ids.length === 0)) {
    return JSON.stringify({
      error: 'must provide at least one of source_agent, briefing_type, briefing_ids',
    });
  }

  const supabase = createClient();

  let q = supabase
    .from('inbox_items')
    .select('id, briefing:briefings!inner(id, source_agent, briefing_type)')
    .eq('pharmacy_id', ctx.pharmacyId)
    .eq('state', 'pending')
    .order('created_at', { ascending: false })
    .limit(max);

  if (briefing_ids && briefing_ids.length > 0) {
    q = q.in('briefing_id', briefing_ids);
  }
  if (source_agent) q = q.eq('briefings.source_agent', source_agent);
  if (briefing_type) {
    q = q.eq('briefings.briefing_type', briefing_type as never);
  }

  const { data: rows, error } = await q;
  if (error) return JSON.stringify({ error: error.message });

  let dismissed = 0;
  let failed = 0;
  const errors: Array<{ inbox_item_id: string; error: string }> = [];

  for (const row of rows ?? []) {
    const r = await rejectOne(supabase, row.id, 'chat_dismiss_all', ctx);
    if (r.ok) {
      dismissed++;
    } else {
      failed++;
      errors.push({ inbox_item_id: row.id, error: r.error });
    }
  }

  return JSON.stringify({ dismissed, failed, matched: rows?.length ?? 0, errors });
}
