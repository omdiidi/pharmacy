// Reports client. Real mode runs the full async cycle:
//   createReport → poll getReport → getReportDocument (presigned URL) → fetch+parse.
// Polling: 30s base, exponential backoff capped at 2 min, total wall ≤ 12 min.
// Reuses an existing DONE report for the same type within the last 6 hours to
// keep daily cron cost low.
//
// Fixture mode loads vendor/sp-api-fixtures/seller-performance-report-sample.json.

import { spFetch } from './client';
import { loadRawFixture } from './_fixtures';
import type { SellerPerformanceSnapshot } from './types';

export interface ReportsClient {
  fetchLatestSellerPerformance(pharmacyId: string): Promise<SellerPerformanceSnapshot>;
}

const REPORT_TYPE = 'GET_V1_SELLER_PERFORMANCE_REPORT';
const REUSE_WINDOW_MS = 6 * 60 * 60 * 1000;
const POLL_BASE_MS = 30_000;
const POLL_CAP_MS = 2 * 60 * 1000;
const POLL_TOTAL_MAX_MS = 12 * 60 * 1000;

type ReportSummary = {
  reportId: string;
  reportType: string;
  processingStatus: 'IN_QUEUE' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | 'FATAL' | string;
  reportDocumentId?: string;
  createdTime?: string;
};

export const getRealReportsClient = (): ReportsClient => ({
  async fetchLatestSellerPerformance(_pharmacyId): Promise<SellerPerformanceSnapshot> {
    const marketplaceId = process.env.SP_API_MARKETPLACE_ID ?? 'ATVPDKIKX0DER';

    // 1. Look for a recent DONE report of this type to reuse.
    const since = new Date(Date.now() - REUSE_WINDOW_MS).toISOString();
    const list = await spFetch<{ reports?: ReportSummary[] }>(
      `/reports/2021-06-30/reports?reportTypes=${encodeURIComponent(REPORT_TYPE)}&processingStatuses=DONE&createdSince=${encodeURIComponent(since)}&pageSize=1`,
      { method: 'GET' },
    );
    let report = (list.reports ?? [])[0];

    // 2. Otherwise create a new report and poll until DONE.
    if (!report) {
      const created = await spFetch<{ reportId: string }>('/reports/2021-06-30/reports', {
        method: 'POST',
        body: JSON.stringify({ reportType: REPORT_TYPE, marketplaceIds: [marketplaceId] }),
      });
      const startedAt = Date.now();
      let attempt = 0;
      while (true) {
        if (Date.now() - startedAt > POLL_TOTAL_MAX_MS) {
          throw new Error('reports.fetchLatestSellerPerformance: poll timeout (12 min)');
        }
        const delay = Math.min(POLL_BASE_MS * 2 ** attempt, POLL_CAP_MS);
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
        const r = await spFetch<ReportSummary>(`/reports/2021-06-30/reports/${created.reportId}`, {
          method: 'GET',
        });
        if (r.processingStatus === 'DONE') {
          report = r;
          break;
        }
        if (r.processingStatus === 'CANCELLED' || r.processingStatus === 'FATAL') {
          throw new Error(`reports.fetchLatestSellerPerformance: report ${r.processingStatus}`);
        }
      }
    }

    if (!report.reportDocumentId) {
      throw new Error('reports.fetchLatestSellerPerformance: report missing reportDocumentId');
    }

    // 3. Get the presigned URL.
    const doc = await spFetch<{ url: string }>(
      `/reports/2021-06-30/documents/${report.reportDocumentId}`,
      { method: 'GET' },
    );

    // 4. Fetch + parse the document. Amazon returns this as JSON for SELLER_PERFORMANCE.
    const docRes = await fetch(doc.url);
    if (!docRes.ok) {
      throw new Error(`reports.fetchLatestSellerPerformance: document fetch ${docRes.status}`);
    }
    const parsed = (await docRes.json()) as Record<string, unknown>;

    // The real GET_V1_SELLER_PERFORMANCE_REPORT JSON varies; extract the four
    // fields our classifier cares about. Keys here mirror the documented shape;
    // any missing fields default to 0 to keep the classifier defensive.
    const get = (k: string): number => {
      const v = parsed[k];
      return typeof v === 'number' ? v : 0;
    };
    return {
      odr: get('orderDefectRate'),
      late_ship_rate: get('lateShipmentRate'),
      cancellation_rate: get('preFulfillmentCancellationRate'),
      vtr: get('validTrackingRate'),
      buybox_pct: get('featuredOfferPercentage'),
      captured_at: report.createdTime ?? new Date().toISOString(),
    };
  },
});

export const getFixtureReportsClient = (): ReportsClient => ({
  async fetchLatestSellerPerformance(): Promise<SellerPerformanceSnapshot> {
    return loadRawFixture<SellerPerformanceSnapshot>('seller-performance-report-sample.json');
  },
});
