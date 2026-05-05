// batch_approve_briefings — chat tool. Approves multiple briefings in one
// pass by calling the shared kernel approveOne() for each match. Bypasses
// HTTP routing to keep the chat session in-process; same audit_log + 30-min
// undo semantics as the UI's Approve button.

import { z } from 'zod';
import type OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import { approveOne } from '@/lib/kernel/approve';
import type { ToolContext } from './index';

const InputSchema = z.object({
  source_agent: z.string().optional(),
  briefing_type: z.string().optional(),
  briefing_ids: z.array(z.string().uuid()).optional(),
  max: z.number().int().min(1).max(50).default(20),
  // Most briefings have action[0] = primary; this lets the LLM target a
  // different action (e.g. action[1] for "Skip") if it ever needs to.
  action_index: z.number().int().min(0).max(20).default(0),
});

export const batch_approve_briefings_def: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'batch_approve_briefings',
    description:
      'Approve a batch of pending briefings filtered by source_agent, briefing_type, or explicit IDs. Each match invokes the same approve flow as the UI Approve button (executor.forward + audit_log + 30-min undo). Returns counts and audit_log_ids. Maximum 50 per call.',
    parameters: {
      type: 'object',
      properties: {
        source_agent: { type: 'string' },
        briefing_type: { type: 'string' },
        briefing_ids: { type: 'array', items: { type: 'string' } },
        max: { type: 'number', default: 20 },
        action_index: { type: 'number', default: 0 },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export async function batch_approve_briefings(
  rawInput: unknown,
  ctx: ToolContext,
): Promise<string> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) return JSON.stringify({ error: parsed.error.message });
  const { source_agent, briefing_type, briefing_ids, max, action_index } = parsed.data;

  if (!source_agent && !briefing_type && (!briefing_ids || briefing_ids.length === 0)) {
    return JSON.stringify({
      error: 'must provide at least one of source_agent, briefing_type, briefing_ids',
    });
  }

  const supabase = createClient();

  // Resolve matching pending inbox_items via the briefings join.
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
    // briefing_type is a Postgres enum; the LLM may pass any of the known values.
    // We cast through unknown so TS doesn't require us to import the union here.
    q = q.eq('briefings.briefing_type', briefing_type as never);
  }

  const { data: rows, error } = await q;
  if (error) return JSON.stringify({ error: error.message });

  let approved = 0;
  let failed = 0;
  const errors: Array<{ inbox_item_id: string; status: number; error: string }> = [];
  const audit_log_ids: string[] = [];

  for (const row of rows ?? []) {
    const result = await approveOne(supabase, row.id, action_index, {
      pharmacyId: ctx.pharmacyId,
      userId: ctx.userId,
      email: ctx.email,
    });
    if (result.ok) {
      approved++;
      audit_log_ids.push(result.audit_log_id);
    } else {
      failed++;
      errors.push({ inbox_item_id: row.id, status: result.status, error: result.error });
    }
  }

  return JSON.stringify({
    approved,
    failed,
    matched: rows?.length ?? 0,
    errors,
    audit_log_ids,
  });
}
