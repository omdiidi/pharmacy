// summarize_inbox — chat tool. Read-only aggregation of pending briefings
// in the last N hours, grouped by source_agent. Reused by the digest agent
// and by Kaleem's "what's in my inbox" queries.

import { z } from 'zod';
import type OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import type { ToolContext } from './index';

const InputSchema = z.object({
  // Default 30 days — pending briefings don't age out by time, they age out
  // by action. Old default of 24h made the tool report "empty" while the
  // Inbox UI showed 30+ pending rows.
  window_hours: z.number().int().min(1).max(8760).default(720),
});

export const summarize_inbox_def: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'summarize_inbox',
    description:
      "Aggregate pending briefings (default last 30 days), grouped by source_agent. Returns counts, top urgency examples, and a flat list of recent titles. Use when Kaleem asks 'what's in my inbox' or before a batch_approve_briefings call. Override window_hours to a smaller value (e.g. 24) when Kaleem explicitly asks 'what came in today'.",
    parameters: {
      type: 'object',
      properties: {
        window_hours: { type: 'number', default: 720 },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

type Row = {
  id: string;
  source_agent: string | null;
  briefing_type: string | null;
  title: string | null;
  urgency: number | null;
  created_at: string | null;
};

export async function summarize_inbox(
  rawInput: unknown,
  ctx: ToolContext,
): Promise<string> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) return JSON.stringify({ error: parsed.error.message });
  const { window_hours } = parsed.data;

  const since = new Date(Date.now() - window_hours * 3600 * 1000).toISOString();
  const supabase = createClient();

  const { data, error } = await supabase
    .from('inbox_items')
    .select(
      'id, briefing:briefings!inner(id, source_agent, briefing_type, title, urgency, created_at)',
    )
    .eq('pharmacy_id', ctx.pharmacyId)
    .eq('state', 'pending')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return JSON.stringify({ error: error.message });

  type RawJoin = { id: string; briefing: Row };
  const rows = ((data ?? []) as unknown as RawJoin[]).map((r) => r.briefing);

  const byAgent: Record<
    string,
    { count: number; top_urgency: number; examples: Array<{ id: string; title: string | null; urgency: number | null }> }
  > = {};
  for (const r of rows) {
    const agent = r.source_agent ?? 'unknown';
    if (!byAgent[agent])
      byAgent[agent] = { count: 0, top_urgency: 0, examples: [] };
    byAgent[agent].count++;
    if ((r.urgency ?? 0) > byAgent[agent].top_urgency) {
      byAgent[agent].top_urgency = r.urgency ?? 0;
    }
    if (byAgent[agent].examples.length < 3) {
      byAgent[agent].examples.push({ id: r.id, title: r.title, urgency: r.urgency });
    }
  }

  return JSON.stringify({
    window_hours,
    total: rows.length,
    by_agent: byAgent,
  });
}
