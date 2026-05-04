// flag_anomaly executor.
// Forward: writes one memory row per related entity (kind='semantic',
// metadata.anomaly_type/severity, source='portfolio_manager').
// Reverse: deletes those memory rows.

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeMemory } from '@/lib/memory/write';
import type { Executor, ExecutorContext, ExecutorResult } from './types';

const ParamsSchema = z.object({
  anomaly_type: z.string().min(1).max(100),
  related_entity_type: z.string().min(1).max(100),
  related_ids: z.array(z.string().uuid()).min(1).max(20),
  severity: z.enum(['info', 'warn', 'critical']),
  reason: z.string().min(1).max(2000),
});

export const flagAnomaly: Executor = {
  kind: 'flag_anomaly',

  async forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult> {
    const v = ParamsSchema.parse(params);
    const supabase = createAdminClient();
    const memoryIds: string[] = [];
    for (const id of v.related_ids) {
      const result = await writeMemory(supabase, {
        pharmacyId: ctx.pharmacyId,
        kind: 'semantic',
        source: 'portfolio_manager',
        content: `Anomaly flagged: ${v.anomaly_type} on ${v.related_entity_type} ${id} (severity=${v.severity}). ${v.reason}`,
        metadata: {
          anomaly_type: v.anomaly_type,
          severity: v.severity,
          flagged_at: new Date().toISOString(),
        },
        importance:
          v.severity === 'critical' ? 0.9 : v.severity === 'warn' ? 0.6 : 0.3,
        relatedEntityType: v.related_entity_type,
        relatedEntityId: id,
      });
      if (result.inserted) memoryIds.push(result.id);
    }
    return { memory_ids: memoryIds };
  },

  async reverse(
    _params: unknown,
    forwardResult: ExecutorResult,
  ): Promise<ExecutorResult> {
    const supabase = createAdminClient();
    const ids = (forwardResult.memory_ids ?? []) as string[];
    if (ids.length === 0) return { reverted: true, count: 0 };
    const { error } = await supabase.from('memory').delete().in('id', ids);
    if (error) {
      throw new Error(`flag_anomaly.reverse: ${error.message}`);
    }
    return { reverted: true, count: ids.length };
  },
};
