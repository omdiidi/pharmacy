// /deal — opportunity discovery. 5 tokens/page, up to 150 deals/page.

import { keepaFetch } from './client';
import type { KeepaDeal, KeepaDealResponse } from './types';

export type DealOpts = {
  categories?: number[]; // default Health & Household 3760931
  dateRange?: 0 | 1 | 2 | 3; // 0=day, 1=week, 2=month, 3=90d
  limit?: number;
};

export async function getRecentDeals(opts: DealOpts = {}): Promise<KeepaDeal[]> {
  const body = {
    page: 0,
    domainId: 1,
    includeCategories: opts.categories ?? [3760931],
    priceTypes: [0, 1, 18], // AMAZON, NEW, BUY_BOX_SHIPPING
    deltaPercentRange: [10, 100],
    salesRankRange: [1, 50000],
    minRating: 30,
    isRangeEnabled: true,
    isFilterEnabled: true,
    filterErotic: true,
    hasReviews: true,
    isOutOfStock: false,
    dateRange: opts.dateRange ?? 1,
    sortType: 4,
  };

  const res = await keepaFetch<KeepaDealResponse>('/deal', {}, {
    method: 'POST',
    body,
  });
  const deals = res.dr ?? [];
  return typeof opts.limit === 'number' ? deals.slice(0, opts.limit) : deals;
}
