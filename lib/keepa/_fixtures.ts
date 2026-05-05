// Fixture-mode Keepa client. Loads pre-baked JSON envelopes from
// vendor/keepa-fixtures/ so Research Analyst can run end-to-end without a
// KEEPA_API_KEY. Same shape as the real client; agents do not branch.

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type {
  KeepaDeal,
  KeepaDealResponse,
  KeepaProduct,
  KeepaProductResponse,
  KeepaTokenResponse,
} from './types';

async function loadFixture<T>(name: string): Promise<T> {
  const p = path.resolve(process.cwd(), 'vendor', 'keepa-fixtures', `${name}.json`);
  const raw = await readFile(p, 'utf8');
  return JSON.parse(raw) as T;
}

export async function getFixtureDeals(): Promise<KeepaDeal[]> {
  const env = await loadFixture<KeepaDealResponse>('deal');
  return env.dr ?? [];
}

export async function getFixtureProduct(_asin: string): Promise<KeepaProduct | null> {
  const env = await loadFixture<KeepaProductResponse>('product');
  return (env.products ?? [])[0] ?? null;
}

export async function getFixtureToken(): Promise<KeepaTokenResponse> {
  return loadFixture<KeepaTokenResponse>('token');
}
