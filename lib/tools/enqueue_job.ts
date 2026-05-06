import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import type OpenAI from 'openai';
import type { ToolContext } from './index';

const InputSchema = z.object({
  job_type: z.string().min(1).max(200),
  payload: z.record(z.unknown()).default({}),
  priority: z.number().int().min(1).max(10).default(5),
});

export const enqueue_job_def: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'enqueue_job',
    description:
      'Enqueue a deeper analysis job (e.g. ad-hoc Research Analyst pass on a specific category). Returns the job ID; the result lands in the briefings/inbox when the job completes.',
    parameters: {
      type: 'object',
      properties: {
        job_type: { type: 'string', description: 'Job type identifier; pharm: prefix is added if missing' },
        payload: { type: 'object', description: 'Job-specific payload', additionalProperties: true },
        priority: { type: 'number', description: '1 (highest) — 10 (lowest)', default: 5 },
      },
      required: ['job_type', 'payload'],
      additionalProperties: false,
    },
  },
};

export async function enqueue_job(rawInput: unknown, ctx: ToolContext): Promise<string> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) return JSON.stringify({ error: parsed.error.message });
  const { job_type, payload, priority } = parsed.data;

  const fullJobType = job_type.startsWith('pharm:') ? job_type : `pharm:${job_type}`;

  const supabase = createClient();
  const { data, error } = await supabase
    .from('jobs')
    .insert({
      job_type: fullJobType,
      payload: payload as never,
      status: 'pending',
      priority,
      pharmacy_id: ctx.pharmacyId,
      submitted_by: ctx.userId,
    })
    .select('id')
    .single();

  if (error) return JSON.stringify({ error: error.message });
  const jobId = (data as { id: string }).id;
  return JSON.stringify({ job_id: jobId, status: 'enqueued' });
}
