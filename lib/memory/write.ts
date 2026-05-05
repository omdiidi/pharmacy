// Idempotent memory-row writer. Used by Reflector (weekly patterns) and
// flag_anomaly executor (one row per related entity).
//
// Idempotence key is exact (pharmacy_id, source, content) match — same shape
// the seed-dev-data script uses, so re-runs do not double-insert.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import { embed, VOYAGE_EMBEDDING_MODEL } from '@/lib/voyage/embed';
import { Sentry } from '@/lib/logger';

export type MemoryKind = 'episodic' | 'procedural' | 'semantic' | 'preferences';

export type WriteMemoryArgs = {
  pharmacyId: string;
  kind: MemoryKind;
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
  importance?: number;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
};

export async function writeMemory(
  supabase: SupabaseClient<Database>,
  args: WriteMemoryArgs,
): Promise<{ id: string; inserted: boolean }> {
  const { data: existing } = await supabase
    .from('memory')
    .select('id')
    .eq('pharmacy_id', args.pharmacyId)
    .eq('source', args.source)
    .eq('content', args.content)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return { id: existing.id, inserted: false };

  const { data, error } = await supabase
    .from('memory')
    .insert({
      pharmacy_id: args.pharmacyId,
      kind: args.kind,
      source: args.source,
      content: args.content,
      metadata: (args.metadata ?? {}) as Json,
      importance: args.importance ?? 0.5,
      related_entity_type: args.relatedEntityType ?? null,
      related_entity_id: args.relatedEntityId ?? null,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`writeMemory failed: ${error?.message ?? 'no row returned'}`);
  }

  // Best-effort: write Voyage embedding after the row is in place. If creds
  // are missing or the call fails, the row stays without an embedding and the
  // pg_trgm fallback covers retrieval. Backfill script can re-fill later.
  try {
    const vectors = await embed(args.content);
    if (vectors && vectors[0]) {
      // pgvector over PostgREST accepts the bracketed-string form
      // '[0.1,0.2,...]'. The generated types treat the column as
      // `string | null`, so we serialize the number[] explicitly. Direct
      // array assignment fails type-checking AND occasionally serializes
      // wrong on the wire (Postgres rejects with "malformed array literal").
      const vectorLiteral = '[' + vectors[0].join(',') + ']';
      const { error: embedErr } = await supabase
        .from('memory')
        .update({
          embedding: vectorLiteral as unknown as string,
          embedding_model: VOYAGE_EMBEDDING_MODEL,
        })
        .eq('id', data.id);
      if (embedErr) {
        console.warn(
          `[memory.write] embed update failed for ${data.id}: ${embedErr.message}`,
        );
      }
    }
  } catch (err) {
    console.warn(
      '[memory.write] embed step exception:',
      err instanceof Error ? err.message : err,
    );
    Sentry.captureException(err, { tags: { stage: 'memory-embed' } });
  }

  return { id: data.id, inserted: true };
}
