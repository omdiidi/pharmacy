// Public surface for the Keepa facade. Cred-gated by KEEPA_API_KEY presence
// (env-gate-sanitized via allEnvReal — no opt-in flag because the real Keepa
// client is genuinely production-ready).

import { allEnvReal } from '@/lib/env-gate';
import { getRecentDeals as realGetRecentDeals, type DealOpts } from './deal';
import { getProduct as realGetProduct, type ProductOpts } from './product';
import { keepaFetch } from './client';
import {
  getFixtureDeals,
  getFixtureProduct,
  getFixtureToken,
} from './_fixtures';
import type { KeepaDeal, KeepaProduct, KeepaTokenResponse } from './types';

export type { KeepaDeal, KeepaProduct, KeepaTokenResponse, DealOpts, ProductOpts };

export interface KeepaClient {
  getRecentDeals(opts?: DealOpts): Promise<KeepaDeal[]>;
  getProduct(asin: string, opts?: ProductOpts): Promise<KeepaProduct | null>;
  getTokenStatus(): Promise<KeepaTokenResponse>;
}

export function keepaCredsPresent(): boolean {
  return allEnvReal('KEEPA_API_KEY');
}

const realClient: KeepaClient = {
  getRecentDeals: (opts) => realGetRecentDeals(opts),
  getProduct: (asin, opts) => realGetProduct(asin, opts),
  getTokenStatus: () => keepaFetch<KeepaTokenResponse>('/token', {}),
};

const fixtureClient: KeepaClient = {
  getRecentDeals: () => getFixtureDeals(),
  getProduct: (asin) => getFixtureProduct(asin),
  getTokenStatus: () => getFixtureToken(),
};

export const getKeepaClient = (): KeepaClient =>
  keepaCredsPresent() ? realClient : fixtureClient;
