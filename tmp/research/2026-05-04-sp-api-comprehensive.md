# Amazon SP-API Comprehensive Reference Dossier

> **Date:** 2026-05-04
> **Status:** Active reference for Wave 2 + Wave 3 PharmaDash agent wiring
> **Goal:** Implementer should be able to write a real TypeScript SP-API client from this dossier alone, plus a fixture-fallback mode that matches real shapes while Amazon SP-API app approval is in flight (1–4 wk gating).
> **Sources cited inline.** Primary docs preferred over secondary blogs.

---

## TL;DR for the Implementer

1. **Auth is just LWA.** Since 2 Oct 2023 SP-API no longer requires AWS Sigv4 / IAM. POST to `https://api.amazon.com/auth/o2/token` with refresh token, get a 1-hour bearer, send as `x-amz-access-token` header. That's it. Old libs that still sign requests will work but the signature is ignored.
2. **One regional base URL per call.** `https://sellingpartnerapi-na.amazon.com` for US/CA/MX, `-eu` for Europe, `-fe` for Far East. Sandbox is `https://sandbox.sellingpartnerapi-na.amazon.com` (and equivalents).
3. **Restricted PII operations need an RDT** (`POST /tokens/2021-03-01/restrictedDataToken`), then use that RDT as the bearer instead of the LWA access token, valid 1 hour.
4. **Use `bizon/selling-partner-api-sdk`** (npm scope `@sp-api-sdk/*`) — TypeScript, modular per-API packages, regenerated twice daily from the official OpenAPI models. Don't write a hand-rolled client.
5. **Sandbox returns canned static fixtures** matched against `x-amzn-api-sandbox` blocks in the OpenAPI models — perfect for our fixture-fallback layer.
6. **For fixture mode**, vendor each API's OpenAPI model JSON from `amzn/selling-partner-api-models`, extract `x-amzn-api-sandbox.static[]` examples, serve them when `SP_API_REFRESH_TOKEN` is unset.
7. **For webhooks, use SQS.** Render Node service polls `ReceiveMessage` — no public ingress required. EventBridge couples us to AWS account infra; SNS would need a public HTTPS endpoint with retry/dedup logic.

---

## Table of Contents

1. [Authentication — LWA + RDT](#1-authentication--lwa--rdt)
2. [Marketplace IDs + Regions + Sandbox](#2-marketplace-ids--regions--sandbox)
3. [Listings Items API v2021-08-01](#3-listings-items-api-v2021-08-01)
4. [Product Pricing API v2022-05-01 + v0](#4-product-pricing-api-v2022-05-01--v0)
5. [Notifications API v1](#5-notifications-api-v1)
6. [Orders API v0](#6-orders-api-v0)
7. [Reports API v2021-06-30](#7-reports-api-v2021-06-30)
8. [Catalog Items API v2022-04-01](#8-catalog-items-api-v2022-04-01)
9. [Feeds API v2021-06-30](#9-feeds-api-v2021-06-30)
10. [Solicitations API v1](#10-solicitations-api-v1)
11. [Account Health / Performance](#11-account-health--performance)
12. [SDK Recommendation](#12-sdk-recommendation)
13. [Fixture-Fallback Strategy](#13-fixture-fallback-strategy)
14. [Mapping to PharmaDash Agents](#14-mapping-to-pharmadash-agents)
15. [Sources](#15-sources)

---

## 1. Authentication — LWA + RDT

### 1.1 LWA Refresh Token Flow (standard SP-API auth)

**Token URL:** `https://api.amazon.com/auth/o2/token`
**Method:** `POST`
**Content-Type:** `application/x-www-form-urlencoded;charset=UTF-8`

**Request body (form-encoded):**
```
grant_type=refresh_token
&refresh_token=<LONG_LIVED_REFRESH_TOKEN>
&client_id=<LWA_CLIENT_ID>
&client_secret=<LWA_CLIENT_SECRET>
```

**Response (HTTP 200):**
```json
{
  "access_token": "Atza|IwEBI...",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "Atzr|IwEBI..."
}
```

**TTL:** access_token valid 3600s (1h). Refresh token is long-lived (effectively permanent until revoked).

**TypeScript shape:**
```ts
interface LwaTokenResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number; // seconds, always 3600
  refresh_token: string; // echoes back; treat as opaque
}

interface LwaRefreshTokenRequest {
  grant_type: 'refresh_token';
  refresh_token: string;
  client_id: string;
  client_secret: string;
}
```

**Refresh strategy:** cache the access_token for `expires_in - 60s` (60s safety margin); fetch a new one on miss. Lock around the refresh to avoid stampede (per-process mutex). On Render with multiple worker instances, accept the redundant refresh — Amazon does not rate-limit LWA token issuance materially.

**Static credentials env vars (PharmaDash naming):**
- `LWA_CLIENT_ID` — from Seller Central → Develop Apps
- `LWA_CLIENT_SECRET` — same
- `SP_API_REFRESH_TOKEN` — captured during self-authorization or OAuth flow

### 1.2 Grantless Operations

Some endpoints (mostly Notifications: `getDestinations`, `createDestination`, `deleteDestination`, `getSubscriptionById`, `getDestinationById`) and Application Management's credential-rotation endpoint do not require seller authorization. Use:

```
grant_type=client_credentials
&scope=sellingpartnerapi::notifications | sellingpartnerapi::client_credential:rotation
&client_id=...
&client_secret=...
```

Same token URL. Token TTL same 3600s.

### 1.3 SP-API Request Headers (post-Sigv4 era)

Since [Oct 2 2023](https://developer-docs.amazon.com/sp-api/changelog/sp-api-will-no-longer-require-aws-iam-or-aws-signature-version-4), SP-API requests need **only**:

| Header | Value |
|---|---|
| `x-amz-access-token` | the LWA access token (or RDT for restricted ops) |
| `Content-Type` | `application/json` for POST/PUT/PATCH |
| `Accept` | `application/json` |
| `User-Agent` | recommended `pharmadash/1.0 (Language=Node.js; Platform=Render)` (max 500 chars) |
| `host` | the regional host (most HTTP libs set this automatically) |

**No more:** `x-amz-date`, `Authorization: AWS4-HMAC-SHA256 ...`, IAM role assumption. Old libs that still send the Sigv4 signature continue to work — Amazon ignores the signature and validates only the LWA token.

### 1.4 Restricted Data Token (RDT) Flow

Operations that return PII (buyer info, shipping addresses, tax info) require an RDT instead of the regular LWA access token. The RDT is scoped to specific paths and data elements.

**Endpoint:** `POST /tokens/2021-03-01/restrictedDataToken`
**Bearer used to obtain RDT:** the regular LWA `access_token`.
**Rate limit:** 1 req/sec, burst 10.

**Request body:**
```ts
interface CreateRestrictedDataTokenRequest {
  restrictedResources: Array<{
    method: 'GET' | 'PUT' | 'POST' | 'DELETE';
    path: string; // e.g. '/orders/v0/orders/{orderId}' (literal string with {orderId} placeholder)
    dataElements?: Array<'buyerInfo' | 'shippingAddress' | 'buyerTaxInformation'>;
    targetApplication?: string; // for delegated access
  }>;
}

interface CreateRestrictedDataTokenResponse {
  restrictedDataToken: string; // use as x-amz-access-token in subsequent calls
  expiresIn: number; // seconds, typically 3600
}
```

**Important quirk:** the `path` field accepts the *template* with `{orderId}` literal — the resulting RDT then authorizes calls against any matching order ID for that seller. If you pass a concrete order ID, the RDT is scoped to only that order.

**Operations that require RDT:**
- `GET /orders/v0/orders/{orderId}/buyerInfo`
- `GET /orders/v0/orders/{orderId}/address`
- `GET /orders/v0/orders/{orderId}/orderItems/buyerInfo`
- `GET /orders/v0/orders/{orderId}` and `GET /orders/v0/orders` and `GET /orders/v0/orders/{orderId}/orderItems` — RDT *optional*, but if you want PII fields populated (BuyerEmail, BuyerName, ShippingAddress.Name, etc.) you must use an RDT.

**TypeScript helper:**
```ts
async function getRdtForOrders(accessToken: string, orderId: string): Promise<string> {
  const res = await fetch('https://sellingpartnerapi-na.amazon.com/tokens/2021-03-01/restrictedDataToken', {
    method: 'POST',
    headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      restrictedResources: [
        { method: 'GET', path: `/orders/v0/orders/${orderId}`, dataElements: ['buyerInfo', 'shippingAddress'] },
        { method: 'GET', path: `/orders/v0/orders/${orderId}/orderItems`, dataElements: ['buyerInfo'] },
        { method: 'GET', path: `/orders/v0/orders/${orderId}/address`, dataElements: ['shippingAddress'] },
      ],
    }),
  });
  const body = (await res.json()) as CreateRestrictedDataTokenResponse;
  return body.restrictedDataToken;
}
```

Sources:
- [Connecting to the Selling Partner API](https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api)
- [LWA Credentials FAQ](https://developer-docs.amazon.com/sp-api/docs/lwa-credentials-faq)
- [SP-API no longer requires AWS IAM or AWS Sigv4 (Oct 2023 changelog)](https://developer-docs.amazon.com/sp-api/changelog/sp-api-will-no-longer-require-aws-iam-or-aws-signature-version-4)
- [Tokens API model JSON](https://github.com/amzn/selling-partner-api-models/blob/main/models/tokens-api-model/tokens_2021-03-01.json)

---

## 2. Marketplace IDs + Regions + Sandbox

### 2.1 Production Base URLs

| Region | Base URL | AWS region (info only) |
|---|---|---|
| North America | `https://sellingpartnerapi-na.amazon.com` | us-east-1 |
| Europe | `https://sellingpartnerapi-eu.amazon.com` | eu-west-1 |
| Far East | `https://sellingpartnerapi-fe.amazon.com` | us-west-2 |

### 2.2 Sandbox Base URLs

| Region | Sandbox URL |
|---|---|
| North America | `https://sandbox.sellingpartnerapi-na.amazon.com` |
| Europe | `https://sandbox.sellingpartnerapi-eu.amazon.com` |
| Far East | `https://sandbox.sellingpartnerapi-fe.amazon.com` |

Sandbox throttles harder: ~5 req/sec rate, burst 15 across all operations. Designed for shape verification, not throughput testing.

### 2.3 Marketplace IDs (Kaleem cares about the first three)

| Country | Marketplace ID | Region |
|---|---|---|
| **US** | `ATVPDKIKX0DER` | NA |
| Canada | `A2EUQ1WTGCTBG2` | NA |
| Mexico | `A1AM78C64UM0Y8` | NA |
| Brazil | `A2Q3Y263D00KWC` | NA |
| UK | `A1F83G8C2ARO7P` | EU |
| Germany | `A1PA6795UKMFR9` | EU |
| France | `A13V1IB3VIYZZH` | EU |
| Spain | `A1RKKUPIHCS9HS` | EU |
| Japan | `A1VC38T7YXB528` | FE |
| Australia | `A39IBJ37TRP1C6` | FE |

**TypeScript constant:**
```ts
export const MARKETPLACE_IDS = {
  US: 'ATVPDKIKX0DER',
  CA: 'A2EUQ1WTGCTBG2',
  MX: 'A1AM78C64UM0Y8',
} as const;

export const SP_API_BASE_URL = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
  sandbox_na: 'https://sandbox.sellingpartnerapi-na.amazon.com',
} as const;
```

**Multi-marketplace operations:** most endpoints accept `marketplaceIds` as a comma-separated query param. For Kaleem in Phase 2, hardcode `[ATVPDKIKX0DER]` — single-marketplace. Make it a config var, not a constant baked in agent prompts.

Sources:
- [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids)
- [SP-API Sandbox](https://developer-docs.amazon.com/sp-api/docs/sp-api-sandbox)

---

## 3. Listings Items API v2021-08-01

Used by: **Listing Agent** (Phase 2 Layer 2 already shipped, currently against fixtures), **Repricer** (PATCH price), **Account Health** (read offer-state issues).

**Base path:** `/listings/2021-08-01/items/{sellerId}/{sku}`

All operations share rate limit **5 req/sec, burst 10** (unless noted).

### 3.1 putListingsItem — Create or fully replace a listing

```
PUT /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds=ATVPDKIKX0DER&issueLocale=en_US
```

**Path params:** `sellerId` (Amazon merchant token), `sku` (seller-chosen string).
**Query params:**
- `marketplaceIds` (required, comma-delimited)
- `issueLocale` (optional, e.g. `en_US`) — locale of validation issues

**Request body:**
```ts
interface PutListingsItemRequest {
  productType: string; // e.g. 'HEALTH_PERSONAL_CARE', 'DIETARY_SUPPLEMENT', 'DRUGS' — discover via Product Type Definitions API
  requirements?: 'LISTING' | 'LISTING_PRODUCT_ONLY' | 'LISTING_OFFER_ONLY';
  attributes: Record<string, AttributeValue[]>; // shape per productType, see below
}

// Each attribute is an array of one or more typed values
type AttributeValue = {
  value: string | number | boolean;
  language_tag?: string; // e.g. 'en_US' — required for localized strings
  marketplace_id?: string; // required when value varies by marketplace
  // additional structured fields per attribute schema
  [k: string]: unknown;
};
```

**Example body for an OTC supplement (Omega-3) under productType `DIETARY_SUPPLEMENT`:**
```json
{
  "productType": "DIETARY_SUPPLEMENT",
  "requirements": "LISTING",
  "attributes": {
    "item_name": [{ "value": "Nordic Naturals Ultimate Omega 1280mg, 60 Soft Gels", "language_tag": "en_US", "marketplace_id": "ATVPDKIKX0DER" }],
    "brand": [{ "value": "Nordic Naturals", "marketplace_id": "ATVPDKIKX0DER" }],
    "manufacturer": [{ "value": "Nordic Naturals", "marketplace_id": "ATVPDKIKX0DER" }],
    "product_description": [{ "value": "High-potency omega-3 from wild-caught fish.", "language_tag": "en_US", "marketplace_id": "ATVPDKIKX0DER" }],
    "bullet_point": [
      { "value": "1280mg Omega-3 per serving", "language_tag": "en_US", "marketplace_id": "ATVPDKIKX0DER" },
      { "value": "Lemon flavor", "language_tag": "en_US", "marketplace_id": "ATVPDKIKX0DER" }
    ],
    "main_product_image_locator": [{ "media_location": "https://images.example.com/omega3.jpg", "marketplace_id": "ATVPDKIKX0DER" }],
    "fulfillment_availability": [{ "fulfillment_channel_code": "DEFAULT", "quantity": 24 }],
    "purchasable_offer": [{
      "marketplace_id": "ATVPDKIKX0DER",
      "currency": "USD",
      "our_price": [{ "schedule": [{ "value_with_tax": 32.99 }] }]
    }],
    "list_price": [{ "value": 39.99, "currency": "USD", "marketplace_id": "ATVPDKIKX0DER" }],
    "merchant_suggested_asin": [{ "value": "B003B3OOPA", "marketplace_id": "ATVPDKIKX0DER" }],
    "condition_type": [{ "value": "new_new", "marketplace_id": "ATVPDKIKX0DER" }]
  }
}
```

**Response:**
```ts
interface ListingsItemSubmissionResponse {
  sku: string;
  status: 'ACCEPTED' | 'INVALID' | 'VALID';
  submissionId: string;
  issues?: Array<{
    code: string;
    message: string;
    severity: 'ERROR' | 'WARNING' | 'INFO';
    attributeNames?: string[];
    categories?: string[];
  }>;
  identifiers?: Array<{
    marketplaceId: string;
    identifiers: Array<{ identifierType: string; identifier: string }>;
  }>;
}
```

**Important:** `productType` strings are *not* free-form. Use the **Product Type Definitions API** (`/definitions/2020-09-01/productTypes`) to discover valid productType IDs and their JSON schemas per marketplace. For OTC pharmacy: likely candidates are `DIETARY_SUPPLEMENT`, `HEALTH_PERSONAL_CARE`, `DRUGS`, `OVER_THE_COUNTER_MEDICINE`, `VITAMIN`. Each has a different required-attribute set.

`PUT` is *destructive* — any attribute omitted from the new submission is dropped. For incremental updates (price change, inventory change), use PATCH.

### 3.2 patchListingsItem — Surgical updates

```
PATCH /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds=ATVPDKIKX0DER&mode=VALIDATION_PREVIEW&issueLocale=en_US
```

**Query params:**
- `marketplaceIds` (required)
- `mode` (optional, `VALIDATION_PREVIEW` returns issues without persisting — use this from the Repricer agent before actually submitting)
- `includedData` (optional, default `issues`, also `identifiers`)
- `issueLocale` (optional)

**Request body — JSON Patch RFC 6902:**
```ts
interface PatchListingsItemRequest {
  productType: string;
  patches: Array<{
    op: 'add' | 'replace' | 'delete';
    path: string; // JSON Pointer, e.g. '/attributes/purchasable_offer'
    value?: unknown;
  }>;
}
```

**Example — Repricer changing price from $32.99 to $34.49:**
```json
{
  "productType": "DIETARY_SUPPLEMENT",
  "patches": [{
    "op": "replace",
    "path": "/attributes/purchasable_offer",
    "value": [{
      "marketplace_id": "ATVPDKIKX0DER",
      "currency": "USD",
      "our_price": [{ "schedule": [{ "value_with_tax": 34.49 }] }]
    }]
  }]
}
```

**Critical limitation per Amazon docs:** "Only top-level listings item attributes can be patched. Patching nested attributes is not supported." So you can't `replace /attributes/purchasable_offer/0/our_price/0/schedule/0/value_with_tax` — you have to replace the entire `purchasable_offer` array.

**Response:** same `ListingsItemSubmissionResponse` shape as PUT.

### 3.3 getListingsItem

```
GET /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds=ATVPDKIKX0DER&includedData=summaries,attributes,issues,offers,fulfillmentAvailability,procurement,relationships,productTypes
```

**Query params:**
- `marketplaceIds` (required)
- `includedData` enum (comma-delimited): `summaries` (default), `attributes`, `issues`, `offers`, `fulfillmentAvailability`, `procurement`, `relationships`, `productTypes`

**Response:**
```ts
interface ListingsItem {
  sku: string;
  summaries?: Array<{
    marketplaceId: string;
    asin?: string;
    productType?: string;
    conditionType?: string;
    status: string[]; // e.g. ['BUYABLE'] or ['DISCOVERABLE']
    fnSku?: string;
    itemName?: string;
    createdDate?: string; // ISO 8601
    lastUpdatedDate?: string;
    mainImage?: { link: string; height: number; width: number };
  }>;
  attributes?: Record<string, AttributeValue[]>;
  issues?: Array<{ code: string; message: string; severity: string; attributeNames?: string[] }>;
  offers?: Array<{
    marketplaceId: string;
    offerType: string;
    price?: { currencyCode: string; amount: string };
    points?: { pointsNumber: number; pointsMonetaryValue: { currencyCode: string; amount: string } };
  }>;
  fulfillmentAvailability?: Array<{ fulfillmentChannelCode: string; quantity?: number }>;
  procurement?: { costPrice: { currencyCode: string; amount: string } };
  relationships?: Array<{ marketplaceId: string; relationships: Array<{ type: string; childSkus?: string[]; parentSkus?: string[] }> }>;
}
```

### 3.4 deleteListingsItem

```
DELETE /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds=ATVPDKIKX0DER
```

Returns `ListingsItemSubmissionResponse` with `status: 'ACCEPTED'`.

### 3.5 searchListingsItems

```
GET /listings/2021-08-01/items/{sellerId}?marketplaceIds=ATVPDKIKX0DER&identifiers=SKU1,SKU2&identifiersType=SKU&pageSize=10&pageToken=...&includedData=summaries
```

Same `includedData` enum as `getListingsItem`. Returns paginated listing items. Useful for "list all my SKUs in one call" — preferred over multiple `getListingsItem`.

### 3.6 Listings via Feeds (alternative bulk path)

For >1 listing change, use the [Feeds API](#9-feeds-api-v2021-06-30) with `JSON_LISTINGS_FEED` — single API call uploads N listing modifications. Higher throughput, asynchronous. Listings Items API is the synchronous per-SKU path. PharmaDash should default to Listings Items per-SKU because:
- Synchronous error reporting (instant validation feedback)
- HITL approval is per-listing — no need to batch
- Volumes are tiny (~30 listings)

Sources:
- [Listings Items API v2021-08-01 Reference](https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference)
- [Listings Items API model JSON](https://github.com/amzn/selling-partner-api-models/blob/main/models/listings-items-api-model/listingsItems_2021-08-01.json)
- [Manage Product Listings guide](https://developer-docs.amazon.com/sp-api/docs/manage-product-listings-guide)
- [Mapping product attributes](https://developer-docs.amazon.com/sp-api/docs/mapping-product-attributes)

---

## 4. Product Pricing API v2022-05-01 + v0

Used by: **Repricer** (Buy Box detection, FOEP), **Research Analyst** (competitive landscape).

The 2022-05-01 version is the modern batch API. v0 still exists for some single-ASIN operations.

### 4.1 getCompetitiveSummary (v2022-05-01) — primary Repricer input

```
POST /batches/products/pricing/2022-05-01/items/competitiveSummary
```

**Rate limit:** 0.033 req/sec (1 req per 30s), burst 1. **This is the bottleneck.** With ~30 listings × need-to-check-every-30-min, you'll batch 20 ASINs per call.

**Request body:**
```ts
interface CompetitiveSummaryBatchRequest {
  requests: Array<{
    asin: string;
    marketplaceId: string;
    includedData: Array<'featuredBuyingOptions' | 'referencePrices' | 'lowestPricedOffers' | 'similarItems'>;
    lowestPricedOffersInputs?: Array<{
      itemCondition: 'New' | 'Used' | 'Collectible' | 'Refurbished' | 'Club';
      offerType: 'Consumer' | 'Business';
    }>;
    method: 'GET'; // required by batch envelope
    uri: string; // e.g. '/products/pricing/2022-05-01/items/competitiveSummary' — required by batch envelope
  }>;
}
```

**Response:**
```ts
interface CompetitiveSummaryBatchResponse {
  responses: Array<{
    headers: Record<string, string>;
    status: { statusCode: number; reasonPhrase: string };
    body: {
      asin: string;
      marketplaceId: string;
      featuredBuyingOptions?: Array<{
        buyingOptionType: 'New' | 'Used' | 'Collectible' | 'Refurbished';
        segmentedFeaturedOffers: Array<{
          sellerId: string;
          condition: string;
          fulfillmentType: 'AFN' | 'MFN'; // AFN = FBA, MFN = seller-fulfilled
          listingPrice: { currencyCode: string; amount: number };
          shippingOptions?: Array<{ shippingOptionType: string; price: { currencyCode: string; amount: number } }>;
          points?: { pointsNumber: number };
          featuredOfferSegments: Array<{ customerMembership: 'PRIME' | 'NON_PRIME' | 'B2B' }>;
          primeDetails?: { eligibility: 'ELIGIBLE' | 'INELIGIBLE' };
        }>;
      }>;
      lowestPricedOffers?: Array<{
        lowestPricedOffersInput: { itemCondition: string; offerType: string };
        offers: Array<{
          sellerId: string;
          condition: string;
          fulfillmentType: 'AFN' | 'MFN';
          listingPrice: { currencyCode: string; amount: number };
          shippingOptions?: Array<{ shippingOptionType: string; price: { currencyCode: string; amount: number } }>;
          sellerFeedbackRating?: { feedbackCount: number; sellerPositiveFeedbackRating: number };
          shipsFrom?: { country: string };
        }>;
      }>;
      referencePrices?: Array<{
        name: 'CompetitivePriceThreshold' | 'CompetitivePrice' | 'WasPrice';
        price: { currencyCode: string; amount: number };
      }>;
    };
  }>;
}
```

**Buy Box detection:** the offer in `featuredBuyingOptions[0].segmentedFeaturedOffers[0]` *is* the Buy Box winner (or the per-segment winner, e.g. PRIME-eligible buyers). Compare its `sellerId` to `kaleemSellerId` to know if Kaleem owns the Buy Box.

### 4.2 getFeaturedOfferExpectedPriceBatch (v2022-05-01) — what price to bid

```
POST /batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice
```

**Rate limit:** 0.033 req/sec, burst 1. Same bottleneck.

**Request:**
```ts
interface FoepBatchRequest {
  requests: Array<{
    method: 'POST';
    uri: string;
    marketplaceId: string;
    sku: string;
    segment?: { glanceViewWeightPercentage?: number; segmentDetails?: { glanceViewWeightPercentage?: number } };
  }>;
}
```

**Response:** for each request, returns `featuredOfferExpectedPrice`:
```ts
interface FoepResponse {
  body: {
    offerIdentifier: { marketplaceId: string; sku: string };
    featuredOfferExpectedPriceResults: Array<{
      featuredOfferExpectedPrice?: {
        listingPrice: { currencyCode: string; amount: number };
        points?: { pointsNumber: number };
      };
      resultStatus: 'VALID_FOEP' | 'NO_COMPETING_OFFER' | 'NOT_ELIGIBLE_TO_COMPETE';
      competingFeaturedOffer?: { /* same shape as segmentedFeaturedOffers entry */ };
      currentFeaturedOffer?: { /* same shape */ };
    }>;
  };
}
```

**This is the killer API for the Repricer.** Amazon tells you the exact price you need to be at-or-below to become the Buy Box winner. Repricer's "match Buy Box" rule = use `featuredOfferExpectedPrice.listingPrice.amount` as the new price (subject to floor/ceiling guardrails).

### 4.3 getItemOffers (v0) — single-ASIN detailed offer dump

```
GET /products/pricing/v0/items/{Asin}/offers?MarketplaceId=ATVPDKIKX0DER&ItemCondition=New&CustomerType=Consumer
```

**Rate limit:** 0.5 req/sec, burst 1. Faster than v2022-05-01 batch for single-ASIN drill-down.

**Response highlights (v0 PascalCase!):**
```ts
interface GetItemOffersResponse {
  payload: {
    ASIN: string;
    SKU?: string;
    ItemCondition: string;
    Status: 'Success' | 'ClientError' | 'ServiceError';
    Identifier: { MarketplaceId: string; ASIN: string };
    Summary: {
      TotalOfferCount: number;
      NumberOfOffers?: Array<{ condition: string; fulfillmentChannel: 'Amazon' | 'Merchant'; OfferCount: number }>;
      LowestPrices?: Array<{ condition: string; fulfillmentChannel: string; LandedPrice: MoneyType; ListingPrice: MoneyType; Shipping: MoneyType }>;
      BuyBoxPrices?: Array<{ condition: string; LandedPrice: MoneyType; ListingPrice: MoneyType; Shipping: MoneyType }>;
      ListPrice?: MoneyType;
      SuggestedLowerPricePlusShipping?: MoneyType;
      BuyBoxEligibleOffers?: Array<{ condition: string; fulfillmentChannel: string; OfferCount: number }>;
      OffersAvailableTime?: string;
    };
    Offers: Array<{
      MyOffer?: boolean;
      SubCondition: string;
      SellerId?: string;
      ListingPrice: MoneyType;
      Shipping: MoneyType;
      ShipsFrom?: { Country?: string; State?: string };
      IsFulfilledByAmazon: boolean;
      IsBuyBoxWinner?: boolean;
      IsFeaturedMerchant?: boolean;
      ShippingTime?: { minimumHours?: number; maximumHours?: number; availabilityType?: string };
      SellerFeedbackRating?: { SellerPositiveFeedbackRating: number; FeedbackCount: number };
    }>;
  };
}

interface MoneyType { CurrencyCode: string; Amount: number; }
```

Note the v0 PascalCase — different from v2022-05-01's camelCase. Don't mix conventions.

Sources:
- [getCompetitiveSummary reference](https://developer-docs.amazon.com/sp-api/reference/getcompetitivesummary)
- [getItemOffers reference](https://developer-docs.amazon.com/sp-api/reference/getitemoffers)
- [Product Pricing API model JSON](https://github.com/amzn/selling-partner-api-models/blob/main/models/product-pricing-api-model/productPricing_2022-05-01.json)

---

## 5. Notifications API v1

Used by: **Repricer** (ANY_OFFER_CHANGED), **Fulfillment Ops** (ORDER_CHANGE), **Account Health** (ACCOUNT_STATUS_CHANGED), **Listing Agent** (LISTINGS_ITEM_*), **Customer Success** (FEED_PROCESSING_FINISHED for feed errors).

### 5.1 Workflow

1. **Create destination** (grantless, one-time setup) — register an SQS queue / EventBridge bus / SNS topic with SP-API.
2. **Create subscription** (per notification type, per seller) — bind a destination to a notification type.
3. **Consume events** — Render Node service polls SQS / handles EventBridge events.

### 5.2 createDestination

```
POST /notifications/v1/destinations
```

**Auth:** grantless (`scope=sellingpartnerapi::notifications`).
**Rate limit:** 1 req/sec, burst 5.

**Request body:**
```ts
interface CreateDestinationRequest {
  name: string; // unique label, e.g. 'pharm1-sqs-orders'
  resourceSpecification:
    | { sqs: { arn: string } } // e.g. 'arn:aws:sqs:us-east-1:123456789012:pharm1-sp-api'
    | { eventBridge: { region: string; accountId: string } }
    | { sns: { topicArn: string } }; // — actually not in current API; SQS + EventBridge only
}

interface CreateDestinationResponse {
  payload: {
    name: string;
    destinationId: string;
    resource: { sqs?: { arn: string }; eventBridge?: { name: string; region: string; accountId: string } };
  };
}
```

**SQS queue must have this policy** (allow SP-API service principal to send messages):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::437568002678:root" },
    "Action": "sqs:SendMessage",
    "Resource": "arn:aws:sqs:us-east-1:YOUR_ACCOUNT_ID:pharm1-sp-api"
  }]
}
```

The principal `437568002678` is the SP-API publisher account — verify against [current docs](https://developer-docs.amazon.com/sp-api/docs/set-up-notifications-with-amazon-sqs) before deploy. Queue must be **Standard** (not FIFO).

### 5.3 createSubscription

```
POST /notifications/v1/subscriptions/{notificationType}
```

**Auth:** uses LWA refresh token (per-seller, NOT grantless).
**Rate limit:** 1 req/sec, burst 5.

**Request body:**
```ts
interface CreateSubscriptionRequest {
  payloadVersion?: string; // default '1.0' — currently only '1.0' supported for most types
  destinationId: string; // from createDestination
  processingDirective?: {
    eventFilter?: {
      eventFilterType: 'ANY_OFFER_CHANGED' | 'ORDER_CHANGE' | string;
      marketplaceIds?: string[];
      orderChangeTypes?: Array<'OrderStatusChange' | 'BuyerRequestedChange' | 'NewOrder'>;
      aggregationSettings?: { aggregationTimePeriod: 'TenMinutes' | 'FiveMinutes' };
    };
  };
}
```

### 5.4 Notification Types (the ones that matter for PharmaDash)

| Notification Type | Description | Destination | Used by agent |
|---|---|---|---|
| `ANY_OFFER_CHANGED` | Top-20 offer change for an ASIN. Includes external retailer prices. | SQS | Repricer |
| `B2B_ANY_OFFER_CHANGED` | Top-20 B2B offer change with quantity-tier discounts. | SQS | Repricer (Phase 3) |
| `ORDER_CHANGE` | Order modifications (NewOrder, OrderStatusChange, BuyerRequestedChange). | SQS | Fulfillment Ops |
| `ORDER_STATUS_CHANGE` | Just status (Pending → Unshipped → Shipped → Delivered). | SQS | Fulfillment Ops |
| `MFN_ORDER_STATUS_CHANGE` | MFN-only status changes. | SQS | Fulfillment Ops |
| `ACCOUNT_STATUS_CHANGED` | NORMAL ↔ AT_RISK ↔ DEACTIVATED. | SQS | Account Health (red alarm trigger) |
| `FEED_PROCESSING_FINISHED` | Feed status terminal. | SQS | Listing Agent (post-feed-submit) |
| `REPORT_PROCESSING_FINISHED` | Report ready to fetch. | SQS | Bookkeeper (settlement reports), Account Health |
| `LISTINGS_ITEM_STATUS_CHANGE` | Buyability status flip. | SQS | Account Health |
| `LISTINGS_ITEM_ISSUES_CHANGE` | New compliance/policy issues on a listing. | SQS | Account Health, Listing Agent |
| `LISTINGS_ITEM_MFN_QUANTITY_CHANGE` | Inventory change. | SQS | Repricer (low stock → raise price) |
| `BRANDED_ITEM_CONTENT_CHANGE` | Title/description/bullet/image change for owned brands. | EventBridge | Listing Agent (catalog watch) |
| `ITEM_PRODUCT_TYPE_CHANGE` | productType reclassified by Amazon. | EventBridge | Listing Agent |
| `PRODUCT_TYPE_DEFINITIONS_CHANGE` | Schema for a productType changed. | EventBridge | Listing Agent |
| `FBA_OUTBOUND_SHIPMENT_STATUS` | FBA shipment status (BR-only currently). | SQS | (n/a for Kaleem — he's MFN) |
| `FBA_INVENTORY_AVAILABILITY_CHANGES` | FBA inventory changes. | SQS | (n/a — MFN-only) |
| `DETAIL_PAGE_TRAFFIC_EVENT` | Hourly per-ASIN traffic. | SQS | Research Analyst (Phase 3) |
| `PRICING_HEALTH` | Pricing-eligibility issues. | SQS | Repricer, Account Health |

**Two destination types in 2026:** SQS (most types) and EventBridge (catalog/content types only). SNS support was on the roadmap but in current docs only SQS + EventBridge are listed.

### 5.5 Webhook Event Envelope

All notifications sent to your SQS queue have this outer shape:

```ts
interface NotificationEnvelope<P = unknown> {
  NotificationVersion: '1.0';
  NotificationType: string; // e.g. 'ANY_OFFER_CHANGED'
  PayloadVersion: '1.0';
  EventTime: string; // ISO 8601, e.g. '2026-05-04T10:23:45.109Z'
  Payload: P;
  NotificationMetadata: {
    ApplicationId: string;
    SubscriptionId: string;
    PublishTime: string; // ISO 8601
    NotificationId: string; // dedup key
  };
}
```

**Example: ANY_OFFER_CHANGED payload:**
```ts
interface AnyOfferChangedPayload {
  AnyOfferChangedNotification: {
    SellerId: string;
    OfferChangeTrigger: {
      MarketplaceId: string;
      ASIN: string;
      ItemCondition: 'new' | 'used' | string;
      TimeOfOfferChange: string; // ISO 8601
    };
    Summary: {
      NumberOfOffers: Array<{ Condition: string; FulfillmentChannel: 'Amazon' | 'Merchant'; OfferCount: number }>;
      LowestPrices: Array<{ Condition: string; FulfillmentChannel: string; LandedPrice: MoneyType; ListingPrice: MoneyType; Shipping: MoneyType }>;
      BuyBoxPrices: Array<{ Condition: string; LandedPrice: MoneyType; ListingPrice: MoneyType }>;
      ListPrice?: MoneyType;
      MinimumSellerFeedbackRating?: number;
      OffersAvailableTime?: string;
      BuyBoxEligibleOffers: Array<{ Condition: string; FulfillmentChannel: string; OfferCount: number }>;
    };
    Offers: Array<{
      SellerId: string;
      SubCondition: string;
      SellerFeedbackRating?: { SellerPositiveFeedbackRating: number; FeedbackCount: number };
      ShippingTime: { MinimumHours?: number; MaximumHours?: number; AvailabilityType: string };
      ListingPrice: MoneyType;
      Shipping: MoneyType;
      ShipsDomestically: boolean;
      ShipsFrom: { Country?: string; State?: string };
      IsFulfilledByAmazon: boolean;
      IsBuyBoxWinner?: boolean;
      IsFeaturedMerchant?: boolean;
    }>;
  };
}
```

**Example: ORDER_CHANGE payload:**
```ts
interface OrderChangePayload {
  OrderChangeNotification: {
    SellerId: string;
    AmazonOrderId: string;
    OrderChangeType: 'NewOrder' | 'OrderStatusChange' | 'BuyerRequestedChange';
    OrderChangeTrigger: { TimeOfOrderChange: string };
    Summary: {
      MarketplaceId: string;
      OrderStatus: string;
      DestinationPostalCode?: string;
      OrderItems?: Array<{ ASIN: string; SellerSKU: string; Quantity: number }>;
      OrderType?: string;
      LevelOfFulfillment?: 'SellerFulfilled' | 'AmazonFulfilled';
      Programs?: string[];
    };
  };
}
```

### 5.6 Recommended destination for Render Node service

**Use SQS.** Reasons:
- Render service stays behind no-public-ingress; just polls SQS via AWS SDK.
- Built-in deduplication via `NotificationMetadata.NotificationId` (Standard SQS is at-least-once).
- Visibility timeout / retry / DLQ semantics solve flaky processing without code.
- AWS account separate from Render is fine (cross-account IAM via long-lived access key).
- EventBridge requires either an EventBridge → SQS forward rule (extra step) or AWS Lambda (extra service).

**Consumer pattern:**
```ts
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
const sqs = new SQSClient({ region: 'us-east-1' });
const QUEUE_URL = process.env.SP_API_SQS_URL;

async function pollSpApiNotifications() {
  while (true) {
    const { Messages } = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20, // long-poll
      VisibilityTimeout: 60,
    }));
    for (const msg of Messages ?? []) {
      const env = JSON.parse(msg.Body!) as NotificationEnvelope;
      await routeNotificationToAgent(env); // dispatch by env.NotificationType
      await sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: msg.ReceiptHandle! }));
    }
  }
}
```

Sources:
- [Notifications API v1 Reference](https://developer-docs.amazon.com/sp-api/docs/notifications-api-v1-reference)
- [Notification Type Values](https://developer-docs.amazon.com/sp-api/docs/notification-type-values)
- [Set up SQS notifications](https://developer-docs.amazon.com/sp-api/docs/set-up-notifications-with-amazon-sqs)
- [Tutorial: ORDER_CHANGE notification](https://developer-docs.amazon.com/sp-api/docs/tutorial-subscribe-to-order-change-notification)

---

## 6. Orders API v0

Used by: **Fulfillment Ops** (poll new orders, fetch buyer/address for shipping label), **Bookkeeper** (settlement reconciliation needs order detail).

**Base path:** `/orders/v0/orders`

### 6.1 getOrders — list orders

```
GET /orders/v0/orders?MarketplaceIds=ATVPDKIKX0DER&CreatedAfter=2026-05-01T00:00:00Z&OrderStatuses=Unshipped,PartiallyShipped&MaxResultsPerPage=100&NextToken=...
```

**Rate limit:** 0.0167 req/sec (1 req per 60s), burst 20. Tight — but with NextToken pagination of 100/page you get 2000 orders per minute.

**Query params (all optional unless noted):**
```ts
interface GetOrdersQuery {
  MarketplaceIds: string[]; // required — comma-delimited, max 50
  CreatedAfter?: string; // ISO 8601 — at least one of CreatedAfter or LastUpdatedAfter required
  CreatedBefore?: string;
  LastUpdatedAfter?: string;
  LastUpdatedBefore?: string;
  OrderStatuses?: Array<'Pending' | 'Unshipped' | 'PartiallyShipped' | 'Shipped' | 'Canceled' | 'Unfulfillable' | 'InvoiceUnconfirmed' | 'PendingAvailability'>;
  FulfillmentChannels?: Array<'AFN' | 'MFN'>;
  PaymentMethods?: Array<'COD' | 'CVS' | 'Other'>;
  BuyerEmail?: string;
  SellerOrderId?: string;
  AmazonOrderIds?: string[]; // max 50
  MaxResultsPerPage?: number; // default 100, max 100
  EarliestDeliveryDateBefore?: string;
  EarliestDeliveryDateAfter?: string;
  LatestDeliveryDateBefore?: string;
  LatestDeliveryDateAfter?: string;
  NextToken?: string; // pagination
  ActualFulfillmentSupplySourceId?: string;
  IsISPU?: boolean; // in-store pickup
  StoreChainStoreId?: string;
}
```

**Response:**
```ts
interface GetOrdersResponse {
  payload: {
    Orders: Order[];
    NextToken?: string; // present if more pages
    LastUpdatedBefore?: string;
    CreatedBefore?: string;
  };
}

interface Order {
  AmazonOrderId: string; // 3-7-7 format, e.g. '902-1234567-1234567'
  SellerOrderId?: string;
  PurchaseDate: string; // ISO 8601
  LastUpdateDate: string;
  OrderStatus: 'Pending' | 'Unshipped' | 'PartiallyShipped' | 'Shipped' | 'Canceled' | 'Unfulfillable' | 'InvoiceUnconfirmed' | 'PendingAvailability';
  FulfillmentChannel?: 'AFN' | 'MFN';
  SalesChannel?: string; // 'Amazon.com', 'Non-Amazon'
  OrderChannel?: string;
  ShipServiceLevel?: string; // e.g. 'Std US D2D Dom'
  OrderTotal?: { CurrencyCode: string; Amount: string };
  NumberOfItemsShipped?: number;
  NumberOfItemsUnshipped?: number;
  PaymentExecutionDetail?: Array<{ Payment: { CurrencyCode: string; Amount: string }; PaymentMethod: string }>;
  PaymentMethod?: string;
  PaymentMethodDetails?: string[];
  MarketplaceId: string;
  ShipmentServiceLevelCategory?: 'Expedited' | 'NextDay' | 'SecondDay' | 'Standard' | 'FreeEconomy' | 'SameDay' | 'ScheduledDelivery';
  EasyShipShipmentStatus?: string;
  CbaDisplayableShippingLabel?: string;
  OrderType?: 'StandardOrder' | 'LongLeadTimeOrder' | 'Preorder' | 'BackOrder' | 'SourcingOnDemandOrder';
  EarliestShipDate?: string;
  LatestShipDate?: string;
  EarliestDeliveryDate?: string;
  LatestDeliveryDate?: string;
  IsBusinessOrder?: boolean;
  IsPrime?: boolean;
  IsPremiumOrder?: boolean;
  IsGlobalExpressEnabled?: boolean;
  ReplacedOrderId?: string;
  IsReplacementOrder?: boolean;
  PromiseResponseDueDate?: string;
  IsEstimatedShipDateSet?: boolean;
  IsSoldByAB?: boolean;
  IsIBA?: boolean; // Invoice By Amazon (B2B)
  DefaultShipFromLocationAddress?: Address;
  BuyerInvoicePreference?: 'INDIVIDUAL' | 'BUSINESS';
  BuyerTaxInformation?: BuyerTaxInformation;
  FulfillmentInstruction?: { FulfillmentSupplySourceId?: string };
  IsISPU?: boolean;
  IsAccessPointOrder?: boolean;
  MarketplaceTaxInfo?: TaxClassification[];
  SellerDisplayName?: string;
  ShippingAddress?: Address; // PII — RDT-gated
  BuyerInfo?: { BuyerEmail?: string; BuyerName?: string; BuyerCounty?: string; BuyerTaxInfo?: BuyerTaxInformation; PurchaseOrderNumber?: string }; // PII — RDT-gated
  AutomatedShippingSettings?: { HasAutomatedShippingSettings: boolean; AutomatedCarrier?: string; AutomatedShipMethod?: string };
  HasRegulatedItems?: boolean;
  ElectronicInvoiceStatus?: 'NotRequired' | 'NotFound' | 'Processing' | 'Errored' | 'Accepted';
}

interface Address {
  Name?: string; // PII
  AddressLine1?: string; // PII
  AddressLine2?: string;
  AddressLine3?: string;
  City?: string;
  County?: string;
  District?: string;
  StateOrRegion?: string;
  Municipality?: string;
  PostalCode?: string;
  CountryCode?: string;
  Phone?: string;
  AddressType?: 'Residential' | 'Commercial';
}
```

### 6.2 getOrder

```
GET /orders/v0/orders/{orderId}
```

**Rate limit:** 0.5 req/sec, burst 30. Use this for per-order detail after `getOrders` returns headers.

### 6.3 getOrderItems

```
GET /orders/v0/orders/{orderId}/orderItems?NextToken=...
```

**Rate limit:** 0.5 req/sec, burst 30.

**Response items:**
```ts
interface OrderItem {
  ASIN: string;
  SellerSKU?: string;
  OrderItemId: string;
  Title?: string;
  QuantityOrdered: number;
  QuantityShipped?: number;
  ProductInfo?: { NumberOfItems?: number };
  PointsGranted?: { PointsNumber: number; PointsMonetaryValue: { CurrencyCode: string; Amount: string } };
  ItemPrice?: { CurrencyCode: string; Amount: string };
  ShippingPrice?: { CurrencyCode: string; Amount: string };
  ItemTax?: { CurrencyCode: string; Amount: string };
  ShippingTax?: { CurrencyCode: string; Amount: string };
  ShippingDiscount?: { CurrencyCode: string; Amount: string };
  ShippingDiscountTax?: { CurrencyCode: string; Amount: string };
  PromotionDiscount?: { CurrencyCode: string; Amount: string };
  PromotionDiscountTax?: { CurrencyCode: string; Amount: string };
  PromotionIds?: string[];
  CODFee?: { CurrencyCode: string; Amount: string };
  CODFeeDiscount?: { CurrencyCode: string; Amount: string };
  IsGift?: boolean;
  ConditionNote?: string;
  ConditionId?: 'New' | 'Used' | 'Collectible' | 'Refurbished' | 'Preorder' | 'Club';
  ConditionSubtypeId?: string;
  ScheduledDeliveryStartDate?: string;
  ScheduledDeliveryEndDate?: string;
  PriceDesignation?: string;
  TaxCollection?: { Model: string; ResponsibleParty: string };
  SerialNumberRequired?: boolean;
  IsTransparency?: boolean;
  IossNumber?: string;
  StoreChainStoreId?: string;
  DeemedResellerCategory?: string;
  BuyerInfo?: { BuyerCustomizedInfo?: { CustomizedURL?: string }; GiftWrapPrice?: { CurrencyCode: string; Amount: string }; GiftWrapTax?: { CurrencyCode: string; Amount: string }; GiftMessageText?: string; GiftWrapLevel?: string }; // PII fields if RDT'd
  BuyerRequestedCancel?: { IsBuyerRequestedCancel?: boolean; BuyerCancelReason?: string };
  SerialNumbers?: string[];
}
```

### 6.4 getOrderBuyerInfo (RDT required)

```
GET /orders/v0/orders/{orderId}/buyerInfo
```

**Rate limit:** 0.5 req/sec, burst 30. **RDT required** with `dataElements: ['buyerInfo']`.

```ts
interface OrderBuyerInfo {
  AmazonOrderId: string;
  BuyerEmail?: string;
  BuyerName?: string;
  BuyerCounty?: string;
  BuyerTaxInfo?: BuyerTaxInformation;
  PurchaseOrderNumber?: string;
}
```

### 6.5 getOrderAddress (RDT required)

```
GET /orders/v0/orders/{orderId}/address
```

**Rate limit:** 0.5 req/sec, burst 30. **RDT required** with `dataElements: ['shippingAddress']`.

Returns `{ AmazonOrderId: string; ShippingAddress?: Address; DeliveryPreferences?: ... }`.

### 6.6 getOrderItemsBuyerInfo (RDT required for PII)

```
GET /orders/v0/orders/{orderId}/orderItems/buyerInfo
```

### 6.7 updateShipmentStatus

```
POST /orders/v0/orders/{orderId}/shipment
```

Used to mark an order shipped without a tracking number (most cases use Feeds API `POST_ORDER_FULFILLMENT_DATA` instead with full tracking).

Sources:
- [Orders API v0 Reference](https://developer-docs.amazon.com/sp-api/docs/orders-api-v0-reference)
- [Orders v0 model JSON](https://github.com/amzn/selling-partner-api-models/blob/main/models/orders-api-model/ordersV0.json)

---

## 7. Reports API v2021-06-30

Used by: **Bookkeeper** (settlement), **Account Health** (performance reports), **Research Analyst** (inventory/listing audits).

**Base path:** `/reports/2021-06-30/reports`

### 7.1 The 4-step report flow

1. `POST /reports/2021-06-30/reports` → returns `reportId` (request a new report)
2. Poll `GET /reports/2021-06-30/reports/{reportId}` → wait for `processingStatus: DONE`, capture `reportDocumentId`
3. `GET /reports/2021-06-30/documents/{reportDocumentId}` → returns presigned URL + compressionAlgorithm
4. HTTP GET that presigned URL, optionally decompress GZIP, parse TSV/JSON depending on report type

### 7.2 createReport

```
POST /reports/2021-06-30/reports
```

**Rate limit:** 0.0167 req/sec, burst 15.

**Request body:**
```ts
interface CreateReportSpecification {
  reportType: string; // see report types below
  marketplaceIds: string[];
  dataStartTime?: string; // ISO 8601 — for time-bounded reports
  dataEndTime?: string;
  reportOptions?: Record<string, string>; // report-type-specific options
}

interface CreateReportResponse { reportId: string; }
```

### 7.3 getReport

```
GET /reports/2021-06-30/reports/{reportId}
```

**Rate limit:** 2 req/sec, burst 15. Poll this.

```ts
interface Report {
  reportId: string;
  reportType: string;
  dataStartTime?: string;
  dataEndTime?: string;
  reportScheduleId?: string;
  createdTime: string;
  processingStatus: 'CANCELLED' | 'DONE' | 'FATAL' | 'IN_PROGRESS' | 'IN_QUEUE';
  processingStartTime?: string;
  processingEndTime?: string;
  reportDocumentId?: string; // populated when processingStatus === 'DONE'
  marketplaceIds?: string[];
}
```

### 7.4 getReportDocument

```
GET /reports/2021-06-30/documents/{reportDocumentId}
```

**Rate limit:** 0.0167 req/sec, burst 15. **Heavy throttle** — fetch the URL, read into memory, don't re-call.

```ts
interface ReportDocument {
  reportDocumentId: string;
  url: string; // presigned S3 URL — expires in ~5 min
  compressionAlgorithm?: 'GZIP'; // present if content is gzipped
}
```

**Note:** v2021-06-30 dropped the encryption/decryption step that the older v2020-09-04 had. Just GET the URL, optionally decompress, done. (Some reports return `compressionAlgorithm: 'GZIP'` but the body is actually uncompressed — defensive code: try gunzip, on error fall back to raw.)

### 7.5 getReports (list / search)

```
GET /reports/2021-06-30/reports?reportTypes=GET_FBA_INVENTORY_PLANNING_DATA&processingStatuses=DONE&marketplaceIds=ATVPDKIKX0DER&pageSize=10&createdSince=2026-04-01T00:00:00Z&nextToken=...
```

**Rate limit:** 0.0222 req/sec, burst 10.

### 7.6 cancelReport

```
DELETE /reports/2021-06-30/reports/{reportId}
```

Only works while `processingStatus === 'IN_QUEUE'`.

### 7.7 Report types relevant to PharmaDash

| reportType | Format | Used by |
|---|---|---|
| `GET_FBA_INVENTORY_PLANNING_DATA` | TSV | (n/a — Kaleem is MFN-only) |
| `GET_MERCHANT_LISTINGS_ALL_DATA` | TSV | Listing Agent (full listing dump for audit) |
| `GET_FLAT_FILE_OPEN_LISTINGS_DATA` | TSV | Listing Agent (active listings only) |
| `GET_AFN_INVENTORY_DATA` | TSV | (n/a — MFN) |
| `GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT` | CSV | (n/a — MFN) |
| `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE` | TSV | Bookkeeper (payouts, fees, refunds) |
| `GET_SELLER_FEEDBACK_DATA` | TSV | Customer Success (raw feedback dump) |
| `GET_V1_SELLER_PERFORMANCE_REPORT` | JSON | Account Health (performance metrics) — but see §11 below |
| `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL` | TSV | Bookkeeper, Fulfillment Ops (catch-up after gap) |
| `GET_ORDER_REPORT_DATA_INVOICING` | XML | Bookkeeper (rare — most use settlement) |
| `GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA` | TSV | Customer Success (FBA only — n/a for Kaleem) |
| `GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE` | TSV | Customer Success (MFN returns) |

Sources:
- [Reports API v2021-06-30 Reference](https://developer-docs.amazon.com/sp-api/docs/reports-api-v2021-06-30-reference)
- [Reports API model JSON](https://github.com/amzn/selling-partner-api-models/blob/main/models/reports-api-model/reports_2021-06-30.json)
- [Report Type Values](https://developer-docs.amazon.com/sp-api/docs/report-type-values)

---

## 8. Catalog Items API v2022-04-01

Used by: **Listing Agent** (ASIN lookup, productType discovery, image scraping for listing reuse), **Research Analyst** (browse-node hierarchy, salesRanks).

**Base path:** `/catalog/2022-04-01/items`

**Rate limit (both ops):** 5 req/sec, burst 5.

### 8.1 searchCatalogItems

```
GET /catalog/2022-04-01/items?identifiers=B003B3OOPA&identifiersType=ASIN&marketplaceIds=ATVPDKIKX0DER&includedData=summaries,attributes,images,productTypes,salesRanks&pageSize=10
```

**Query params:**
```ts
interface SearchCatalogItemsQuery {
  identifiers?: string[]; // up to 20 — UPC/EAN/ISBN/JAN/MINSAN/ASIN/SKU/GTIN
  identifiersType?: 'ASIN' | 'EAN' | 'GTIN' | 'ISBN' | 'JAN' | 'MINSAN' | 'SKU' | 'UPC';
  marketplaceIds: string[]; // required
  includedData?: Array<'attributes' | 'classifications' | 'dimensions' | 'identifiers' | 'images' | 'productTypes' | 'relationships' | 'salesRanks' | 'summaries' | 'vendorDetails'>;
  locale?: string; // e.g. 'en_US'
  sellerId?: string; // required if identifiersType === 'SKU'
  keywords?: string[]; // up to 20 — search by keyword
  brandNames?: string[]; // up to 10
  classificationIds?: string[]; // up to 10 — browse node IDs
  pageSize?: number; // default 10, max 20
  pageToken?: string;
  keywordsLocale?: string;
}
```

**Response item:**
```ts
interface CatalogItem {
  asin: string;
  attributes?: Record<string, AttributeValue[]>;
  classifications?: Array<{ marketplaceId: string; classifications: Array<{ displayName: string; classificationId: string; parent?: { displayName: string; classificationId: string } }> }>;
  dimensions?: Array<{ marketplaceId: string; item?: Dimension; package?: Dimension }>;
  identifiers?: Array<{ marketplaceId: string; identifiers: Array<{ identifier: string; identifierType: string }> }>;
  images?: Array<{ marketplaceId: string; images: Array<{ variant: 'MAIN' | 'PT01' | string; link: string; height: number; width: number }> }>;
  productTypes?: Array<{ marketplaceId: string; productType: string }>;
  relationships?: Array<{ marketplaceId: string; relationships: Array<{ type: string; childAsins?: string[]; parentAsins?: string[]; variationTheme?: { attributes: string[]; theme: string } }> }>;
  salesRanks?: Array<{ marketplaceId: string; classificationRanks?: Array<{ classificationId: string; title: string; link: string; rank: number }>; displayGroupRanks?: Array<{ websiteDisplayGroup: string; title: string; link: string; rank: number }> }>;
  summaries?: Array<{ marketplaceId: string; brand?: string; browseClassification?: { displayName: string; classificationId: string }; color?: string; itemName?: string; manufacturer?: string; modelNumber?: string; size?: string; styleName?: string; websiteDisplayGroup?: string; websiteDisplayGroupName?: string; partNumber?: string; itemClassification?: 'BASE_PRODUCT' | 'OTHER' | 'PRODUCT_BUNDLE' | 'VARIATION_PARENT'; releaseDate?: string }>;
}

interface Dimension {
  height?: { value: number; unit: string };
  length?: { value: number; unit: string };
  weight?: { value: number; unit: string };
  width?: { value: number; unit: string };
}
```

### 8.2 getCatalogItem

```
GET /catalog/2022-04-01/items/{asin}?marketplaceIds=ATVPDKIKX0DER&includedData=summaries,attributes,salesRanks
```

Same response shape as one entry from searchCatalogItems. Use this when you already have the ASIN.

Sources:
- [Catalog Items v2022-04-01 Reference](https://developer-docs.amazon.com/sp-api/docs/catalog-items-api-v2022-04-01-reference)

---

## 9. Feeds API v2021-06-30

Used by: **Listing Agent** (bulk listing creates if/when we batch), **Repricer** (pricing feeds — though Listings PATCH is preferred for HITL flow).

### 9.1 Workflow

1. `POST /feeds/2021-06-30/documents` — create a feed document slot, get presigned URL
2. HTTP `PUT` your feed body to that presigned URL (upload)
3. `POST /feeds/2021-06-30/feeds` with `feedType` + `feedDocumentId` — submit feed
4. Poll `GET /feeds/2021-06-30/feeds/{feedId}` until `processingStatus: DONE`
5. `GET /feeds/2021-06-30/documents/{resultFeedDocumentId}` (from step 4) for processing results

### 9.2 createFeedDocument

```
POST /feeds/2021-06-30/documents
```

**Body:**
```ts
interface CreateFeedDocumentSpecification { contentType: string; }
// e.g. 'application/json; charset=UTF-8' for JSON_LISTINGS_FEED
```

**Response:**
```ts
interface CreateFeedDocumentResponse {
  feedDocumentId: string; // expires after 2 days if not used in createFeed
  url: string; // presigned PUT URL
}
```

### 9.3 createFeed

```
POST /feeds/2021-06-30/feeds
```

**Rate limit:** 0.0083 req/sec (1 per 2 min), burst 15. **Very tight** — batch listing changes when possible.

**Body:**
```ts
interface CreateFeedSpecification {
  feedType: string; // e.g. 'JSON_LISTINGS_FEED'
  marketplaceIds: string[];
  inputFeedDocumentId: string; // from createFeedDocument
  feedOptions?: Record<string, string>;
}

interface CreateFeedResponse { feedId: string; }
```

### 9.4 getFeed

```
GET /feeds/2021-06-30/feeds/{feedId}
```

**Rate limit:** 2 req/sec, burst 15.

```ts
interface Feed {
  feedId: string;
  feedType: string;
  marketplaceIds?: string[];
  createdTime: string;
  processingStatus: 'CANCELLED' | 'DONE' | 'FATAL' | 'IN_PROGRESS' | 'IN_QUEUE';
  processingStartTime?: string;
  processingEndTime?: string;
  resultFeedDocumentId?: string; // fetch this for line-by-line errors
}
```

### 9.5 getFeedDocument

```
GET /feeds/2021-06-30/documents/{feedDocumentId}
```

**Rate limit:** 0.0222 req/sec, burst 10. Returns same shape as Reports `getReportDocument`: presigned `url` + optional `compressionAlgorithm`.

### 9.6 Major feed types for OTC

| feedType | Body format | Use |
|---|---|---|
| `JSON_LISTINGS_FEED` | JSON envelope with messages array | Bulk create/update listings |
| `POST_PRODUCT_PRICING_DATA` | flat-file or XML | Bulk price updates (legacy) |
| `POST_INVENTORY_AVAILABILITY_DATA` | flat-file | Bulk inventory updates |
| `POST_ORDER_FULFILLMENT_DATA` | flat-file or XML | Mark orders shipped + tracking number |
| `POST_PRODUCT_DATA` | XML | Legacy listing updates (being deprecated 2025/26 in favor of JSON_LISTINGS_FEED) |

**Important migration note:** Amazon is deprecating XML feeds — JSON_LISTINGS_FEED is the forward path. Per [SpapiHub coverage](https://spapihub.com/blog/sp-api-change-xsd-listing-2025-07-31/), the XSD-based listing flows are being retired through 2026.

### 9.7 JSON_LISTINGS_FEED envelope shape

```json
{
  "header": {
    "sellerId": "A1234567890",
    "version": "2.0",
    "issueLocale": "en_US"
  },
  "messages": [{
    "messageId": 1,
    "sku": "PHARM-OMEGA3-NN-1280",
    "operationType": "UPDATE",
    "productType": "DIETARY_SUPPLEMENT",
    "requirements": "LISTING",
    "attributes": { /* same shape as putListingsItem */ }
  }]
}
```

`operationType` is one of: `UPDATE`, `PARTIAL_UPDATE`, `DELETE`.

Sources:
- [Feeds API v2021-06-30 Reference](https://developer-docs.amazon.com/sp-api/docs/feeds-api-v2021-06-30-reference)
- [Feeds API model JSON](https://github.com/amzn/selling-partner-api-models/blob/main/models/feeds-api-model/feeds_2021-06-30.json)

---

## 10. Solicitations API v1

Used by: **Customer Success** (request product reviews 5–30 days post-delivery, within Amazon's communication policy).

**Base path:** `/solicitations/v1`

### 10.1 getSolicitationActionsForOrder

```
GET /solicitations/v1/orders/{orderId}/solicitation-actions?marketplaceIds=ATVPDKIKX0DER
```

**Rate limit:** 1 req/sec, burst 5.

Returns the list of solicitation types currently allowed for the order (depends on order age, prior solicitations sent, buyer opt-out status).

### 10.2 createProductReviewAndSellerFeedbackSolicitation

```
POST /solicitations/v1/orders/{orderId}/solicitations/product-review-and-seller-feedback?marketplaceIds=ATVPDKIKX0DER
```

**Rate limit:** 1 req/sec, burst 5.

Empty request body. Sends Amazon's standard review-request template — content is fixed by Amazon, you cannot customize. Restrictions:
- 1 solicitation per order, ever
- Must be 5–30 days post-delivery (verify with `getSolicitationActionsForOrder` first)
- Buyer opt-out is honored automatically
- Returns 403 if outside the window or already sent

There is a separate **Messaging API** (`/messaging/v1/orders/{orderId}/messages/...`) for transactional messages (confirm-delivery, returns, etc.) — different rules, different volume caps. Not detailed here; see [Messaging API docs](https://developer-docs.amazon.com/sp-api/docs/messaging-api-v1-reference) when implementing.

Sources:
- [Solicitations API v1 Reference](https://developer-docs.amazon.com/sp-api/docs/solicitations-api-v1-reference)

---

## 11. Account Health / Performance

This is the most fragmented domain in SP-API. There is **no single "Account Health API"**. Metrics come from a mix of:

### 11.1 Sellers API (`/sellers/v1/account` + `/sellers/v1/marketplaceParticipations`)

Returns participation status and basic account info — *not* health metrics. Useful for verifying Kaleem's account is in good standing at a coarse level.

### 11.2 ACCOUNT_STATUS_CHANGED notification (Notifications API)

Real-time push when Amazon flips account state between `NORMAL` / `AT_RISK` / `DEACTIVATED`. **This is the trigger for the Account Health agent's red-alarm path** — auto-pause listings + SMS Kaleem.

### 11.3 Performance reports

- `GET_V1_SELLER_PERFORMANCE_REPORT` — JSON. Includes ODR, Late Shipment Rate, Pre-Fulfillment Cancellation Rate, Valid Tracking Rate (VTR), policy violations.
- `GET_V2_SELLER_PERFORMANCE_REPORT` — newer format.

These are pulled via the Reports API flow (§7). Schedule daily.

### 11.4 Buy Box % — derived

There is no API endpoint that returns "your Buy Box win rate." You compute it from `getCompetitiveSummary` snapshots over time + `ANY_OFFER_CHANGED` notifications: count `featuredBuyingOptions[*].segmentedFeaturedOffers[0].sellerId === kaleemSellerId` events / total events. Persist in `data.health_metrics` table.

### 11.5 Recommended Account Health agent inputs

| Metric | Source | Cadence |
|---|---|---|
| Account state (NORMAL/AT_RISK/DEACTIVATED) | ACCOUNT_STATUS_CHANGED notification | Real-time |
| ODR | GET_V1_SELLER_PERFORMANCE_REPORT | Daily |
| Late Shipment Rate | GET_V1_SELLER_PERFORMANCE_REPORT | Daily |
| Pre-Fulfillment Cancellation Rate | GET_V1_SELLER_PERFORMANCE_REPORT | Daily |
| Valid Tracking Rate | GET_V1_SELLER_PERFORMANCE_REPORT | Daily |
| Buy Box % | derived from getCompetitiveSummary + ANY_OFFER_CHANGED | Continuous |
| Listing-level issues | LISTINGS_ITEM_ISSUES_CHANGE notification + getListingsItem | Real-time + daily reconcile |

Sources:
- [Sellers API v1](https://developer-docs.amazon.com/sp-api/docs/sellers-api-v1-reference)
- [Notification Type Values](https://developer-docs.amazon.com/sp-api/docs/notification-type-values)
- [Report Type Values](https://developer-docs.amazon.com/sp-api/docs/report-type-values)
- secondary: [Understanding Amazon Account Health Metrics](https://spctek.com/understanding-amazon-account-health-metrics-that-matter/)

---

## 12. SDK Recommendation

### 12.1 Anthropic-equivalent official SDK?

**No.** Amazon publishes an [official Java SDK](https://github.com/amzn/selling-partner-api-sdk-for-java) and a [.NET SDK](https://github.com/amzn/selling-partner-api-sdk-for-csharp). For Node/TypeScript, Amazon publishes only the OpenAPI specs (`amzn/selling-partner-api-models`) — community must roll their own client.

The official Amazon tutorial ["Automate your SP-API Calls Using a JavaScript SDK for Node.js"](https://developer-docs.amazon.com/sp-api/docs/tutorial-automate-your-sp-api-calls-using-javascript-sdk-for-node-js) walks through generating a client from the OpenAPI specs using `openapi-generator`. That's "official" only in the sense that Amazon documents the path.

### 12.2 Community libraries — comparison

| Library | npm | Stars | Last update | Notes |
|---|---|---|---|---|
| **`@sp-api-sdk/*` (bizon)** | `@sp-api-sdk/listings-items-api-2021-08-01` etc. | – | regen daily | **Recommended.** Modular per-API packages. TypeScript-first. Auto-regenerated from official OpenAPI specs twice daily. ~60 packages. |
| `amazon-sp-api` (amz-tools) | `amazon-sp-api` | 600+ | active | Single monolithic package. Looser typing — types in `lib/typings` but not exhaustive. Includes a thin auth layer. |
| `selling-partner-api-sdk` (ScaleLeap) | `@scaleleap/selling-partner-api-sdk` | – | active | Fully typed monolith. Less modular than bizon. |
| `sp-api-node` | `sp-api-node` | – | regen 30min | Auto-regen, comprehensive. Newer, less battle-tested. |
| `@amazon-php/sp-api-sdk` | – | – | – | PHP only — listed for reference; not relevant. |

**Recommendation for PharmaDash:** `@sp-api-sdk/*`. Reasons:
- Per-API package install — keeps Render image lean (we initially only need listings-items, product-pricing, orders, reports, notifications, catalog-items)
- TypeScript types match OpenAPI exactly
- Auto-regen means schema changes don't strand us
- Bizon ships an `@sp-api-sdk/auth` package that handles LWA refresh + caching
- No legacy AWS-Sigv4 baggage (the package was rewritten post-Oct-2023 to drop signing)

### 12.3 Risks of older libraries

- `amazon-sp-api` (amz-tools) historically signed requests with Sigv4. Since Oct 2023 the signing is harmless (Amazon ignores it) but it's wasted CPU and dead code.
- Some libs require AWS credentials env vars (`AWS_ACCESS_KEY_ID`, etc.) that aren't actually used post-Oct-2023 — confusing for new devs.
- ScaleLeap and bizon both clean. Prefer bizon for modularity.

Sources:
- [@sp-api-sdk on npm](https://www.npmjs.com/package/@sp-api-sdk/listings-items-api-2021-08-01)
- [bizon/selling-partner-api-sdk on GitHub](https://github.com/bizon/selling-partner-api-sdk)
- [amazon-sp-api on npm](https://www.npmjs.com/package/amazon-sp-api)
- [ScaleLeap/selling-partner-api-sdk](https://github.com/ScaleLeap/selling-partner-api-sdk)
- [Amazon's official Node tutorial](https://developer-docs.amazon.com/sp-api/docs/tutorial-automate-your-sp-api-calls-using-javascript-sdk-for-node-js)

---

## 13. Fixture-Fallback Strategy

End-state: TypeScript clients call real SP-API when env vars are set, fall back to fixture data matching real shapes when they're not.

### 13.1 Approach

Wrap each API client behind a thin facade:

```ts
// lib/sp-api/listings.ts
import { getRealListingsClient } from './real-clients';
import { getFixtureListingsClient } from './fixtures';

export interface ListingsClient {
  getListingsItem(sellerId: string, sku: string, opts: GetListingsItemOpts): Promise<ListingsItem>;
  putListingsItem(sellerId: string, sku: string, body: PutListingsItemRequest, opts: PutOpts): Promise<ListingsItemSubmissionResponse>;
  patchListingsItem(...): Promise<ListingsItemSubmissionResponse>;
  // ...
}

export function getListingsClient(): ListingsClient {
  if (process.env.SP_API_REFRESH_TOKEN) return getRealListingsClient();
  return getFixtureListingsClient();
}
```

### 13.2 Where fixtures come from

**Don't hand-write fixtures.** Three sources, in priority order:

1. **`x-amzn-api-sandbox.static[]` blocks in the OpenAPI models** — every operation in `amzn/selling-partner-api-models` has at least one canned request/response pair embedded in the OpenAPI spec under this extension. Copy these verbatim into a fixtures directory at build time.
2. **SP-API sandbox endpoint** — `https://sandbox.sellingpartnerapi-na.amazon.com`. Even before approval, you can call the sandbox with any LWA token (sandbox accepts anything). It returns the same canned static responses as #1, plus dynamic responses for some operations. Useful for shape verification mid-development.
3. **Once Kaleem's app is approved** — add a `fixtures:capture` script that hits production read-only operations against Kaleem's real account, redacts PII, persists to `tmp/fixtures/sp-api/*.json`. This gives the highest-fidelity fallback data.

### 13.3 Build-time extraction script

```ts
// scripts/extract-sp-api-fixtures.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { glob } from 'glob';

const modelFiles = await glob('node_modules/@sp-api-models/**/*.json');
for (const f of modelFiles) {
  const spec = JSON.parse(readFileSync(f, 'utf8'));
  for (const [path, ops] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(ops as Record<string, any>)) {
      const sandbox = op['x-amzn-api-sandbox']?.static;
      if (!sandbox) continue;
      writeFileSync(
        `tmp/fixtures/sp-api/${op.operationId}.json`,
        JSON.stringify({ path, method, examples: sandbox }, null, 2),
      );
    }
  }
}
```

Run this in CI. Result: every operation has at least one canned response file matching the real shape.

### 13.4 Fixture client implementation pattern

```ts
// lib/sp-api/fixtures/listings.ts
import omega3Listing from '../../../tmp/fixtures/sp-api/getListingsItem.json';

export const getFixtureListingsClient = (): ListingsClient => ({
  async getListingsItem(_sellerId, sku, _opts) {
    return omega3Listing.examples[0].response.body as ListingsItem;
  },
  async putListingsItem(_sellerId, sku, _body, _opts) {
    return {
      sku,
      status: 'ACCEPTED',
      submissionId: `fixture-${Date.now()}`,
      issues: [],
    };
  },
  // ...
});
```

### 13.5 Wiring in PharmaDash

Today (pre-approval): every call goes through `getListingsClient()` and gets fixtures. Listing Agent already produces real-shaped briefings.

Post-approval: set `SP_API_REFRESH_TOKEN` + `LWA_CLIENT_ID` + `LWA_CLIENT_SECRET` in Render env vars. Restart. Same code path, real data.

**Acceptance test:** the agents' generated briefings should be byte-for-byte identical in shape between fixture mode and real mode (only the `data` differs, not the `shape`).

Sources:
- [SP-API Sandbox docs](https://developer-docs.amazon.com/sp-api/docs/sp-api-sandbox)
- [Tutorial: First sandbox call](https://developer-docs.amazon.com/sp-api/docs/onboarding-step-5-make-your-first-call-to-the-sp-api-sandbox)
- [`x-amzn-api-sandbox` discussion in selling-partner-api-models](https://github.com/amzn/selling-partner-api-models)

---

## 14. Mapping to PharmaDash Agents

| Agent | SP-API APIs | Auth | Cadence |
|---|---|---|---|
| **Listing Agent** | Catalog Items v2022-04-01 (lookup), Listings Items v2021-08-01 (PUT/PATCH/GET), Feeds v2021-06-30 (bulk fallback) | LWA | Daily + on-approval-click |
| **Repricer** | Product Pricing v2022-05-01 (`getCompetitiveSummary`, FOEP), Listings Items v2021-08-01 (PATCH price), Notifications (`ANY_OFFER_CHANGED`) | LWA | 2x daily + event-driven |
| **Fulfillment Ops** | Orders v0 (`getOrders`, `getOrder`, `getOrderItems`, `getOrderBuyerInfo` (RDT), `getOrderAddress` (RDT)), Tokens 2021-03-01 (RDT), Notifications (`ORDER_CHANGE`), Feeds (`POST_ORDER_FULFILLMENT_DATA`) | LWA + RDT | Real-time on ORDER_CHANGE |
| **Account Health** | Reports (`GET_V1_SELLER_PERFORMANCE_REPORT`), Notifications (`ACCOUNT_STATUS_CHANGED`, `LISTINGS_ITEM_ISSUES_CHANGE`), Listings Items (per-SKU drill) | LWA | Daily 6am + real-time on red events |
| **Customer Success** | Solicitations v1 (request reviews, 5–30 day window), Messaging v1 (transactional replies), Reports (`GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE`, `GET_SELLER_FEEDBACK_DATA`) | LWA | Per-message webhook + daily review-request sweep |
| **Bookkeeper** | Reports (`GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE`, `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL`), Orders v0 (drill on anomalies) | LWA | Daily 11pm + on payout |
| **Research Analyst** | Catalog Items (browse-node walk), Product Pricing v2022-05-01 (competitive snapshots) — plus Keepa (external) | LWA | Daily 6am |
| **Portfolio Manager** | (reads from Bookkeeper / Repricer / Account Health outputs in DB; no direct SP-API calls) | n/a | Sunday 7am |
| **Reflector** | (reads `audit_log` + agent outputs from DB; no direct SP-API calls) | n/a | Sunday 11pm |
| **Chief of Staff** | (no direct SP-API; only reads briefings + Inbox) | n/a | always-on |

### 14.1 Webhook routing (SQS consumer in worker service)

```ts
async function routeNotificationToAgent(env: NotificationEnvelope): Promise<void> {
  switch (env.NotificationType) {
    case 'ANY_OFFER_CHANGED':
    case 'LISTINGS_ITEM_MFN_QUANTITY_CHANGE':
      return enqueueJob('repricer.evaluate', { trigger: env });
    case 'ORDER_CHANGE':
    case 'ORDER_STATUS_CHANGE':
    case 'MFN_ORDER_STATUS_CHANGE':
      return enqueueJob('fulfillment.handle_order', { trigger: env });
    case 'ACCOUNT_STATUS_CHANGED':
    case 'LISTINGS_ITEM_ISSUES_CHANGE':
    case 'LISTINGS_ITEM_STATUS_CHANGE':
      return enqueueJob('account_health.evaluate', { trigger: env });
    case 'FEED_PROCESSING_FINISHED':
      return enqueueJob('listing.handle_feed_result', { trigger: env });
    case 'REPORT_PROCESSING_FINISHED':
      return enqueueJob('reports.dispatch', { trigger: env });
    default:
      console.warn('Unrouted SP-API notification', env.NotificationType);
  }
}
```

This pattern keeps the SQS consumer dumb and pushes all real work into minicrew jobs (consistent with the kernel's propose-then-execute model).

---

## 15. Sources

### Primary (Amazon docs)

- [SP-API Developer Documentation hub](https://developer-docs.amazon.com/sp-api/docs)
- [Connecting to the Selling Partner API](https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api)
- [LWA Credentials FAQ](https://developer-docs.amazon.com/sp-api/docs/lwa-credentials-faq)
- [Self-authorize a private SP-API application](https://developer-docs.amazon.com/sp-api/docs/self-authorization)
- [Use the refresh token to get new tokens](https://developer.amazon.com/docs/amazon-data-portability/use-refresh-token.html)
- [SP-API no longer requires AWS IAM or AWS Signature Version 4 (Oct 2 2023)](https://developer-docs.amazon.com/sp-api/changelog/sp-api-will-no-longer-require-aws-iam-or-aws-signature-version-4)
- [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids)
- [SP-API Sandbox](https://developer-docs.amazon.com/sp-api/docs/sp-api-sandbox)
- [Tutorial: First sandbox call](https://developer-docs.amazon.com/sp-api/docs/onboarding-step-5-make-your-first-call-to-the-sp-api-sandbox)
- [Listings Items API v2021-08-01 Reference](https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference)
- [Manage Product Listings guide](https://developer-docs.amazon.com/sp-api/docs/manage-product-listings-guide)
- [Mapping product attributes](https://developer-docs.amazon.com/sp-api/docs/mapping-product-attributes)
- [Product Pricing API getCompetitiveSummary](https://developer-docs.amazon.com/sp-api/reference/getcompetitivesummary)
- [Product Pricing API getItemOffers v0](https://developer-docs.amazon.com/sp-api/reference/getitemoffers)
- [Product Pricing API and Notifications FAQ](https://developer-docs.amazon.com/sp-api/docs/pricing-faq)
- [Notifications API v1 Reference](https://developer-docs.amazon.com/sp-api/docs/notifications-api-v1-reference)
- [Notification Type Values](https://developer-docs.amazon.com/sp-api/docs/notification-type-values)
- [Set up notifications using Amazon SQS](https://developer-docs.amazon.com/sp-api/docs/set-up-notifications-with-amazon-sqs)
- [Set up notifications using Amazon EventBridge](https://developer-docs.amazon.com/sp-api/docs/set-up-notifications-with-amazon-eventbridge)
- [Tutorial: Subscribe to ORDER_CHANGE](https://developer-docs.amazon.com/sp-api/docs/tutorial-subscribe-to-order-change-notification)
- [Orders API v0 Use Case Guide](https://developer-docs.amazon.com/sp-api/docs/orders-api-v0-use-case-guide)
- [Reports API v2021-06-30 Reference](https://developer-docs.amazon.com/sp-api/docs/reports-api-v2021-06-30-reference)
- [Reports API: Retrieve a Report](https://developer-docs.amazon.com/sp-api/docs/reports-api-v2021-06-30-retrieve-a-report)
- [Report Type Values](https://developer-docs.amazon.com/sp-api/docs/report-type-values)
- [Catalog Items v2022-04-01 Reference](https://developer-docs.amazon.com/sp-api/docs/catalog-items-api-v2022-04-01-reference)
- [Feeds API v2021-06-30 Reference](https://developer-docs.amazon.com/sp-api/docs/feeds-api-v2021-06-30-reference)
- [Solicitations API v1 Reference](https://developer-docs.amazon.com/sp-api/docs/solicitations-api-v1-reference)
- [Solicitations API Rate Limits](https://developer-docs.amazon.com/sp-api/docs/solicitations-api-rate-limits)
- [Tutorial: Automate SP-API with Node.js SDK](https://developer-docs.amazon.com/sp-api/docs/tutorial-automate-your-sp-api-calls-using-javascript-sdk-for-node-js)

### OpenAPI model JSON (canonical schemas)

- [`amzn/selling-partner-api-models` repo](https://github.com/amzn/selling-partner-api-models)
- [Listings Items 2021-08-01 model](https://github.com/amzn/selling-partner-api-models/blob/main/models/listings-items-api-model/listingsItems_2021-08-01.json)
- [Product Pricing 2022-05-01 model](https://github.com/amzn/selling-partner-api-models/blob/main/models/product-pricing-api-model/productPricing_2022-05-01.json)
- [Orders v0 model](https://github.com/amzn/selling-partner-api-models/blob/main/models/orders-api-model/ordersV0.json)
- [Reports 2021-06-30 model](https://github.com/amzn/selling-partner-api-models/blob/main/models/reports-api-model/reports_2021-06-30.json)
- [Tokens 2021-03-01 model](https://github.com/amzn/selling-partner-api-models/blob/main/models/tokens-api-model/tokens_2021-03-01.json)
- [Notifications model](https://github.com/amzn/selling-partner-api-models/blob/main/models/notifications-api-model/notifications.json)
- [Feeds 2021-06-30 model](https://github.com/amzn/selling-partner-api-models/blob/main/models/feeds-api-model/feeds_2021-06-30.json)
- [Solicitations model](https://github.com/amzn/selling-partner-api-models/blob/main/models/solicitations-api-model/solicitations.json)

### SDKs

- [bizon/selling-partner-api-sdk on GitHub](https://github.com/bizon/selling-partner-api-sdk)
- [@sp-api-sdk/listings-items-api-2021-08-01 on npm](https://www.npmjs.com/package/@sp-api-sdk/listings-items-api-2021-08-01)
- [amazon-sp-api on npm](https://www.npmjs.com/package/amazon-sp-api)
- [ScaleLeap/selling-partner-api-sdk on GitHub](https://github.com/ScaleLeap/selling-partner-api-sdk)
- [sp-api-node on socket.dev](https://socket.dev/npm/package/sp-api-node)
- [Amazon Java SDK (reference)](https://github.com/amzn/selling-partner-api-sdk-for-java)

### Secondary (reference / explainers)

- [spapi.cyou unofficial mirror — Listings Items reference](https://spapi.cyou/en/references/listings-items-api-v2021-08-01-reference.html)
- [SP-API XML→JSON migration writeup (SpapiHub)](https://spapihub.com/blog/sp-api-change-xsd-listing-2025-07-31/)
- [Understanding Amazon Account Health Metrics (SPCTek)](https://spctek.com/understanding-amazon-account-health-metrics-that-matter/)
- [Amazon SP-API: Get Orders with Python (Medium)](https://andrewkushnerov.medium.com/amazon-sp-api-get-orders-with-python-7b7e913d87ea)
- [Bulk Listings via JSON_LISTINGS_FEED (Medium)](https://medium.com/@anasanjaria/amazon-sp-api-guide-bulk-listings-via-json-listings-feed-da2856fda385)

---

*End of dossier. ~1100 lines. Next step: implementer reads §3 + §13 + §14 to scaffold the listings client + fixture fallback for the already-shipped Listing Agent stub.*
