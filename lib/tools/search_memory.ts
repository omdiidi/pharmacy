import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';

const InputSchema = z.object({
  query: z.string().min(1).max(500),
  memory_type: z.enum(['episodic', 'procedural', 'semantic', 'preferences']).optional(),
  k: z.number().int().min(1).max(50).default(10),
});

export const search_memory_def: Anthropic.Tool = {
  name: 'search_memory',
  description:
    'Search across agent memory (episodic decisions + outcomes, procedural playbooks, semantic facts, Kaleem preferences). Use this to recall prior context about a topic.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      memory_type: { type: 'string', enum: ['episodic', 'procedural', 'semantic', 'preferences'] },
      k: { type: 'number', default: 10 },
    },
    required: ['query'],
  },
};

// Phase 1: trigram text search via search_memory_text RPC. No Voyage calls.
// Phase 1.5: swap to match_memory_vector RPC once memory.embedding populated.
export async function search_memory(rawInput: unknown, ctx: { pharmacyId: string }): Promise<string> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) return JSON.stringify({ error: parsed.error.message });
  const { query, memory_type, k } = parsed.data;

  const supabase = createClient();
  const { data, error } = await supabase.rpc('search_memory_text', {
    q: query,
    pharmacy: ctx.pharmacyId,
    kind_filter: memory_type ?? null,
    k,
  });

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ matches: data });
}
