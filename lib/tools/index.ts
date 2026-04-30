import type Anthropic from '@anthropic-ai/sdk';
import { query_products, query_products_def } from '@/lib/tools/query_products';
import { query_orders, query_orders_def } from '@/lib/tools/query_orders';
import { search_memory, search_memory_def } from '@/lib/tools/search_memory';
import { get_recent_briefings, get_recent_briefings_def } from '@/lib/tools/get_recent_briefings';
import { enqueue_job, enqueue_job_def } from '@/lib/tools/enqueue_job';

export type ToolHandler = (input: unknown, ctx: { pharmacyId: string }) => Promise<string>;

const registry: Record<string, ToolHandler> = {
  query_products,
  query_orders,
  search_memory,
  get_recent_briefings,
  enqueue_job,
};

export const toolDefinitions: Anthropic.Tool[] = [
  query_products_def,
  query_orders_def,
  search_memory_def,
  get_recent_briefings_def,
  enqueue_job_def,
];

export async function executeTool(
  name: string,
  input: unknown,
  ctx: { pharmacyId: string },
): Promise<string> {
  try {
    const handler = registry[name];
    if (!handler) return JSON.stringify({ error: `unknown tool: ${name}` });
    return await handler(input, ctx);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
