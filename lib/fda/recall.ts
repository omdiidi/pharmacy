// openFDA drug recall enforcement. Class I + II only (Class III is not
// material for arbitrage decisions). Filtered to recent recalls.

import { fdaFetch } from './client';
import type { FdaResponse, FdaRecallRecord } from './types';

export async function getRecentDrugRecalls(opts: {
  since: string; // YYYY-MM-DD
  limit?: number;
}): Promise<FdaRecallRecord[]> {
  const limit = opts.limit ?? 50;
  const sinceCompact = opts.since.replace(/-/g, '');
  try {
    const search =
      `product_type:Drugs AND (classification:"Class I" OR classification:"Class II") AND report_date:[${sinceCompact} TO 99991231]`;
    const res = await fdaFetch<FdaResponse<FdaRecallRecord>>(
      '/drug/enforcement.json',
      { search, sort: 'report_date:desc', limit },
    );
    return res.results ?? [];
  } catch (err) {
    console.warn(
      '[fda.recall] fetch failed; returning empty:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
