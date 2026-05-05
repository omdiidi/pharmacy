// /product — full product detail for a single ASIN. We default to update=24
// to coalesce on Keepa's cache and avoid burning tokens on stable data.

import { keepaFetch } from './client';
import type { KeepaProduct, KeepaProductResponse } from './types';

export type ProductOpts = {
  stats?: number; // window in days, e.g. 90
  history?: 0 | 1;
  update?: number; // hours; cache hint
};

export async function getProduct(
  asin: string,
  opts: ProductOpts = {},
): Promise<KeepaProduct | null> {
  const query: Record<string, string | number> = {
    domain: 1,
    asin,
    stats: opts.stats ?? 90,
    history: opts.history ?? 0,
    update: opts.update ?? 24,
  };
  const res = await keepaFetch<KeepaProductResponse>('/product', query);
  return (res.products ?? [])[0] ?? null;
}
