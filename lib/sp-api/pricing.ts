// Pricing client — featuredOfferExpectedPriceBatch + competitiveSummary.
// Real mode chunks at 20 SKUs and sleeps 30s between chunks (Amazon's documented
// rate-limit ceiling for the batch endpoint). Fixture mode synthesizes per-SKU
// price variation from a single base example so each agent run sees varied data.

import { spFetch } from './client';
import { loadFixture } from './_fixtures';
import type {
  CompetitiveSummaryBatchRequest,
  CompetitiveSummaryBatchResponse,
  FoepBatchRequest,
  FoepBatchResponse,
} from './types';

export interface PricingClient {
  getFeaturedOfferExpectedPriceBatch(req: FoepBatchRequest): Promise<FoepBatchResponse>;
  getCompetitiveSummary(req: CompetitiveSummaryBatchRequest): Promise<CompetitiveSummaryBatchResponse>;
}

const CHUNK_SIZE = 20;
const SLEEP_MS = 30_000;

export const getRealPricingClient = (): PricingClient => ({
  async getFeaturedOfferExpectedPriceBatch(req) {
    const chunks: FoepBatchRequest['requests'][] = [];
    for (let i = 0; i < req.requests.length; i += CHUNK_SIZE) {
      chunks.push(req.requests.slice(i, i + CHUNK_SIZE));
    }
    const responses: FoepBatchResponse['responses'] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, SLEEP_MS));
      const chunkResp = await spFetch<FoepBatchResponse>(
        '/batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice',
        { method: 'POST', body: JSON.stringify({ requests: chunks[i] }) },
      );
      responses.push(...chunkResp.responses);
    }
    return { responses };
  },
  async getCompetitiveSummary(req) {
    return spFetch<CompetitiveSummaryBatchResponse>(
      '/batches/products/pricing/2022-05-01/items/competitiveSummary',
      { method: 'POST', body: JSON.stringify(req) },
    );
  },
});

export const getFixturePricingClient = (): PricingClient => ({
  async getFeaturedOfferExpectedPriceBatch(req) {
    const base = loadFixture<FoepBatchResponse>('getFeaturedOfferExpectedPriceBatch');
    const baseEntry = base.responses[0];
    return {
      responses: req.requests.map((r, i) => ({
        ...baseEntry,
        body: {
          ...baseEntry.body,
          offerIdentifier: { marketplaceId: r.marketplaceId, sku: r.sku },
          featuredOfferExpectedPriceResults: [
            {
              featuredOfferExpectedPrice: {
                listingPrice: { currencyCode: 'USD', amount: Math.max(1, 19.99 - i * 0.5) },
              },
              resultStatus: 'VALID_FOEP' as const,
            },
          ],
        },
      })),
    };
  },
  async getCompetitiveSummary(req) {
    const base = loadFixture<CompetitiveSummaryBatchResponse>('getCompetitiveSummary');
    const baseEntry = base.responses[0];
    return {
      responses: req.requests.map((r) => ({
        ...baseEntry,
        asin: r.asin,
        marketplaceId: r.marketplaceId,
      })),
    };
  },
});
