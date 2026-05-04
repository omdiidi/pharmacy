// scripts/extract-sp-api-fixtures.ts
// Idempotent SP-API fixture generator.
//
// For each operation we care about, attempt to fetch its OpenAPI JSON model from
// raw.githubusercontent.com (Amazon's public selling-partner-api-models repo)
// into vendor/sp-api-models/ (gitignored), then extract `x-amzn-api-sandbox.static[]`
// example bodies and write per-operation files into vendor/sp-api-fixtures/
// (committed). When the upstream model is unreachable or doesn't carry sandbox
// examples, fall back to a hand-synthesized fixture matching the dossier shapes.
//
// Three notification envelopes (`notification-any-offer-changed`,
// `notification-account-status-changed`, `notification-customer-message-received`)
// and the parsed seller-performance report are not in any OpenAPI model — they
// are synthesized unconditionally.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO = 'amzn/selling-partner-api-models';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/models`;

const OPERATIONS: { operationId: string; modelPath: string }[] = [
  { operationId: 'getListingsItem', modelPath: 'listings-items-api-model/listingsItems_2021-08-01.json' },
  { operationId: 'putListingsItem', modelPath: 'listings-items-api-model/listingsItems_2021-08-01.json' },
  { operationId: 'patchListingsItem', modelPath: 'listings-items-api-model/listingsItems_2021-08-01.json' },
  { operationId: 'getCompetitiveSummary', modelPath: 'product-pricing-api-model/productPricingV2022-05-01.json' },
  { operationId: 'getFeaturedOfferExpectedPriceBatch', modelPath: 'product-pricing-api-model/productPricingV2022-05-01.json' },
  { operationId: 'createSubscription', modelPath: 'notifications-api-model/notifications.json' },
  { operationId: 'createDestination', modelPath: 'notifications-api-model/notifications.json' },
  { operationId: 'createReport', modelPath: 'reports-api-model/reports_2021-06-30.json' },
  { operationId: 'getReport', modelPath: 'reports-api-model/reports_2021-06-30.json' },
  { operationId: 'getReportDocument', modelPath: 'reports-api-model/reports_2021-06-30.json' },
  { operationId: 'createConfirmDeliveryDetails', modelPath: 'solicitations-api-model/solicitations.json' },
];

const FIXTURES_DIR = path.resolve(process.cwd(), 'vendor/sp-api-fixtures');
const MODELS_DIR = path.resolve(process.cwd(), 'vendor/sp-api-models');

function fallbackFixture(operationId: string): unknown {
  // Minimal sandbox-style envelope mirroring x-amzn-api-sandbox.static[] shape.
  // examples[].response.body is what loadFixture<T>() returns.
  const baseEnvelope = (body: unknown) => ({
    examples: [{ request: {}, response: { body } }],
  });
  switch (operationId) {
    case 'getFeaturedOfferExpectedPriceBatch':
      return baseEnvelope({
        responses: [
          {
            status: { statusCode: 200, reasonPhrase: 'Success' },
            body: {
              offerIdentifier: { marketplaceId: 'ATVPDKIKX0DER', sku: 'fixture-sku' },
              featuredOfferExpectedPriceResults: [
                {
                  featuredOfferExpectedPrice: { listingPrice: { currencyCode: 'USD', amount: 19.99 } },
                  resultStatus: 'VALID_FOEP',
                },
              ],
            },
          },
        ],
      });
    case 'getCompetitiveSummary':
      return baseEnvelope({
        responses: [
          {
            asin: 'B00FIXTUREASIN',
            marketplaceId: 'ATVPDKIKX0DER',
            featuredBuyingOptions: [
              {
                segmentedFeaturedOffers: [
                  {
                    listingPrice: { amount: 19.99, currencyCode: 'USD' },
                    shippingOptions: [{ shippingOptionType: 'DEFAULT', price: { amount: 0, currencyCode: 'USD' } }],
                  },
                ],
              },
            ],
          },
        ],
      });
    case 'getListingsItem':
      return baseEnvelope({
        sku: 'fixture-sku',
        attributes: { item_name: [{ value: 'Fixture OTC Product' }] },
        offers: [{ price: { currency: 'USD', amount: 19.99 } }],
      });
    case 'putListingsItem':
    case 'patchListingsItem':
      return baseEnvelope({ sku: 'fixture-sku', status: 'ACCEPTED', submissionId: 'fixture-submission-id' });
    case 'createSubscription':
      return baseEnvelope({
        payload: { subscriptionId: 'fixture-subscription-id', payloadVersion: '1.0', destinationId: 'fixture-destination' },
      });
    case 'createDestination':
      return baseEnvelope({
        payload: { destinationId: 'fixture-destination', name: 'pharm1-destination' },
      });
    case 'createReport':
      return baseEnvelope({ reportId: 'fixture-report-id' });
    case 'getReport':
      return baseEnvelope({
        reportId: 'fixture-report-id',
        reportType: 'GET_V1_SELLER_PERFORMANCE_REPORT',
        processingStatus: 'DONE',
        reportDocumentId: 'fixture-report-document-id',
        createdTime: '2026-05-04T05:00:00.000Z',
      });
    case 'getReportDocument':
      return baseEnvelope({
        reportDocumentId: 'fixture-report-document-id',
        url: 'https://example.invalid/fixture-report-presigned-url',
      });
    case 'createConfirmDeliveryDetails':
      return baseEnvelope({}); // 201 with empty body in real API
    default:
      return baseEnvelope({});
  }
}

async function tryFetchModel(modelPath: string): Promise<unknown | null> {
  // Best-effort fetch. If offline or 404, return null and synthesize.
  try {
    const url = `${RAW_BASE}/${modelPath}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.warn(`[fixtures] ${modelPath} → ${res.status}; synthesizing`);
      return null;
    }
    const text = await res.text();
    const localPath = path.join(MODELS_DIR, path.basename(modelPath));
    await writeFile(localPath, text, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    console.warn(
      `[fixtures] fetch failed for ${modelPath}: ${err instanceof Error ? err.message : err}; synthesizing`,
    );
    return null;
  }
}

function extractSandboxExamples(model: unknown, operationId: string): unknown | null {
  // Walk paths object looking for an operation matching operationId, then read
  // x-amzn-api-sandbox.static[]. Returns null if not present.
  if (!model || typeof model !== 'object') return null;
  const m = model as Record<string, unknown>;
  const paths = m.paths as Record<string, Record<string, unknown>> | undefined;
  if (!paths) return null;
  for (const operations of Object.values(paths)) {
    for (const op of Object.values(operations)) {
      if (typeof op !== 'object' || op === null) continue;
      const opObj = op as Record<string, unknown>;
      if (opObj.operationId !== operationId) continue;
      const sandbox = opObj['x-amzn-api-sandbox'] as { static?: unknown[] } | undefined;
      if (sandbox?.static && Array.isArray(sandbox.static) && sandbox.static.length > 0) {
        return { examples: sandbox.static };
      }
      return null;
    }
  }
  return null;
}

async function readExistingFixture(filename: string): Promise<unknown | null> {
  try {
    const raw = await readFile(path.join(FIXTURES_DIR, filename), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeFixture(filename: string, payload: unknown): Promise<void> {
  // Idempotent: only rewrite if the new content differs from the existing.
  const newJson = JSON.stringify(payload, null, 2) + '\n';
  const existing = await readExistingFixture(filename);
  const existingJson = existing === null ? '' : JSON.stringify(existing, null, 2) + '\n';
  if (existingJson === newJson) return;
  await writeFile(path.join(FIXTURES_DIR, filename), newJson, 'utf8');
  console.log(`[fixtures] wrote ${filename}`);
}

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });
  await mkdir(MODELS_DIR, { recursive: true });

  // Cache models we've fetched to avoid re-downloading the same shared file.
  const modelCache = new Map<string, unknown | null>();

  for (const { operationId, modelPath } of OPERATIONS) {
    let model = modelCache.get(modelPath);
    if (model === undefined) {
      model = await tryFetchModel(modelPath);
      modelCache.set(modelPath, model);
    }
    const sandbox = extractSandboxExamples(model, operationId);
    const payload = sandbox ?? fallbackFixture(operationId);
    await writeFixture(`${operationId}.json`, payload);
  }

  // --- Hand-synthesized notification envelopes (not in any OpenAPI model). ---

  await writeFixture('notification-any-offer-changed.json', {
    NotificationVersion: '1.0',
    NotificationType: 'ANY_OFFER_CHANGED',
    PayloadVersion: '1.0',
    EventTime: '2026-05-04T13:00:00.000Z',
    Payload: {
      AnyOfferChangedNotification: {
        SellerId: 'A1B2C3D4E5F6G7',
        OfferChangeTrigger: {
          MarketplaceId: 'ATVPDKIKX0DER',
          ASIN: 'B00FIXTUREASIN',
          ItemCondition: 'new',
          TimeOfOfferChange: '2026-05-04T12:59:50.000Z',
        },
        Summary: {
          NumberOfOffers: [{ OfferCount: 3, condition: 'new', fulfillmentChannel: 'Amazon' }],
          BuyBoxPrices: [
            {
              condition: 'new',
              LandedPrice: { Amount: 19.99, CurrencyCode: 'USD' },
              ListingPrice: { Amount: 19.99, CurrencyCode: 'USD' },
              Shipping: { Amount: 0, CurrencyCode: 'USD' },
            },
          ],
        },
      },
    },
    NotificationMetadata: {
      ApplicationId: 'amzn1.sp.solution.fixture',
      SubscriptionId: 'fixture-subscription-id',
      PublishTime: '2026-05-04T13:00:00.000Z',
      NotificationId: 'fixture-notif-aoc-001',
    },
  });

  await writeFixture('notification-account-status-changed.json', {
    NotificationVersion: '1.0',
    NotificationType: 'ACCOUNT_STATUS_CHANGED',
    PayloadVersion: '1.0',
    EventTime: '2026-05-04T06:00:00.000Z',
    Payload: {
      AccountStatusChangedNotification: {
        AccountId: 'A1B2C3D4E5F6G7',
        MarketplaceId: 'ATVPDKIKX0DER',
        PreviousStatus: 'NORMAL',
        CurrentStatus: 'AT_RISK',
        ChangeTime: '2026-05-04T05:59:00.000Z',
      },
    },
    NotificationMetadata: {
      ApplicationId: 'amzn1.sp.solution.fixture',
      SubscriptionId: 'fixture-subscription-id',
      PublishTime: '2026-05-04T06:00:00.000Z',
      NotificationId: 'fixture-notif-asc-001',
    },
  });

  await writeFixture('notification-customer-message-received.json', {
    NotificationVersion: '1.0',
    NotificationType: 'CUSTOMER_MESSAGE_RECEIVED',
    PayloadVersion: '1.0',
    EventTime: '2026-05-04T15:30:00.000Z',
    Payload: {
      CustomerMessageReceivedNotification: {
        Message: {
          customer_message_id: 'fixture-msg-001',
          amazon_order_id: '111-1234567-1234567',
          customer_text: "Hi, when will my order ship? It's been 3 days.",
          channel: 'amazon',
        },
      },
    },
    NotificationMetadata: {
      ApplicationId: 'pharm1.internal',
      SubscriptionId: 'fixture-subscription-id',
      PublishTime: '2026-05-04T15:30:00.000Z',
      NotificationId: 'fixture-notif-cmr-001',
    },
  });

  await writeFixture('seller-performance-report-sample.json', {
    odr: 0.005,
    late_ship_rate: 0.02,
    cancellation_rate: 0.01,
    vtr: 0.97,
    buybox_pct: 0.75,
    captured_at: '2026-05-04T05:00:00.000Z',
  });

  console.log('[fixtures] done');
}

main().catch((err) => {
  console.error('[fixtures] fatal:', err);
  process.exit(1);
});
