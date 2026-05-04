// Listings client. Wave 2 only reads (getListingsItem); put/patch are real-mode
// stubs the executor branches will swap in post-Wave-3.

import { spFetch } from './client';
import { loadFixture } from './_fixtures';
import type { ListingsItem } from './types';

export interface ListingsClient {
  getListingsItem(sellerId: string, sku: string, marketplaceId: string): Promise<ListingsItem>;
  putListingsItem(sellerId: string, sku: string, body: unknown): Promise<ListingsItem>;
  patchListingsItem(sellerId: string, sku: string, body: unknown): Promise<ListingsItem>;
}

export const getRealListingsClient = (): ListingsClient => ({
  async getListingsItem(sellerId, sku, marketplaceId) {
    const qs = new URLSearchParams({ marketplaceIds: marketplaceId, includedData: 'attributes,offers' });
    return spFetch<ListingsItem>(
      `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}?${qs.toString()}`,
      { method: 'GET' },
    );
  },
  async putListingsItem(sellerId, sku, body) {
    return spFetch<ListingsItem>(
      `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`,
      { method: 'PUT', body: JSON.stringify(body) },
    );
  },
  async patchListingsItem(sellerId, sku, body) {
    return spFetch<ListingsItem>(
      `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
  },
});

export const getFixtureListingsClient = (): ListingsClient => ({
  async getListingsItem(_sellerId, sku) {
    const base = loadFixture<ListingsItem>('getListingsItem');
    return { ...base, sku };
  },
  async putListingsItem(_sellerId, sku) {
    const base = loadFixture<ListingsItem>('putListingsItem');
    return { ...base, sku };
  },
  async patchListingsItem(_sellerId, sku) {
    const base = loadFixture<ListingsItem>('patchListingsItem');
    return { ...base, sku };
  },
});
