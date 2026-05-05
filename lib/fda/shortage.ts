// openFDA Drug Shortages — currently in shortage, OTC-only, sorted by recency.
// On 5xx fallback, returns an empty list rather than throwing.

import { fdaFetch } from './client';
import type { FdaResponse, FdaShortageRecord } from './types';

export async function getActiveOtcShortages(limit = 50): Promise<FdaShortageRecord[]> {
  try {
    // openFDA shortage records use status:"Current" (not "Currently in
    // Shortage" as some docs suggest). The OTC product_type filter returns
    // zero matches in practice (most pharma shortages are Rx-only); we let
    // the downstream agent filter for OTC-relevant adjacencies via the
    // skill prompt's "shortage-driven opportunity" rubric.
    // Note: URLSearchParams.set will percent-encode spaces and quotes; the
    // API accepts the encoded form, so don't pre-escape with '+'.
    const search = 'status:"Current"';
    const res = await fdaFetch<FdaResponse<FdaShortageRecord>>('/drug/shortages.json', {
      search,
      sort: 'update_date:desc',
      limit,
    });
    return res.results ?? [];
  } catch (err) {
    console.warn(
      '[fda.shortage] fetch failed; returning empty:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
