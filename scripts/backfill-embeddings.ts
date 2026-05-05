// Backfill script for memory.embedding using Voyage AI.
// Idempotent: walks `memory WHERE embedding IS NULL` in batches and updates
// each row with the embedding + embedding_model. Safe to re-run — failed rows
// stay NULL and get retried.
//
// Local: npm run embeddings:backfill
//
// Error handling:
// - VOYAGE_API_KEY missing → exit cleanly with message.
// - Per-row UPDATE error → log + continue.
// - Voyage 5xx (embed throws) → catch, log, sleep 5s, continue to next batch.

import { createAdminClient } from '@/lib/supabase/admin';
import { embed, VOYAGE_EMBEDDING_MODEL } from '@/lib/voyage/embed';

const BATCH_SIZE = 100;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!process.env.VOYAGE_API_KEY) {
    console.log('[backfill] VOYAGE_API_KEY not set; skipping');
    return;
  }

  const supabase = createAdminClient();
  let processed = 0;
  let failed = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    const { data: rows, error } = await supabase
      .from('memory')
      .select('id, content')
      .is('embedding', null)
      .limit(BATCH_SIZE);
    if (error) {
      console.error(`[backfill] read batch ${batchNum} failed:`, error.message);
      break;
    }
    if (!rows || rows.length === 0) {
      console.log(`[backfill] no more rows; processed=${processed} failed=${failed}`);
      break;
    }

    let vectors: number[][] | null;
    try {
      vectors = await embed(rows.map((r) => r.content));
    } catch (err) {
      console.warn(
        `[backfill] embed batch ${batchNum} threw:`,
        err instanceof Error ? err.message : err,
      );
      console.warn(`[backfill] first row id ${rows[0]?.id}; sleeping 5s and continuing`);
      await sleep(5000);
      continue;
    }

    if (vectors === null) {
      console.log(
        `[backfill] Voyage creds missing mid-run; processed ${processed} rows before stop`,
      );
      break;
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const vec = vectors[i];
      if (!vec) {
        console.warn(`[backfill] row ${row.id} no vector returned; skipping`);
        failed++;
        continue;
      }
      const literal = '[' + vec.join(',') + ']';
      const { error: updErr } = await supabase
        .from('memory')
        .update({
          embedding: literal as unknown as string,
          embedding_model: VOYAGE_EMBEDDING_MODEL,
        })
        .eq('id', row.id);
      if (updErr) {
        console.warn(`[backfill] row ${row.id} update failed: ${updErr.message}`);
        failed++;
        continue;
      }
      processed++;
    }
    console.log(`[backfill] batch ${batchNum} done; processed=${processed} failed=${failed}`);
  }
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
