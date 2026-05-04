// Shared TS interfaces for the SP-API facade. Hand-rolled (no @sp-api-sdk/*).
// Shapes mirror the dossier definitions; we expose only the bits our agents
// consume. NotificationType is intentionally typed as `string` so the webhook
// route accepts both real SP-API types (ANY_OFFER_CHANGED, etc.) and our own
// convention type CUSTOMER_MESSAGE_RECEIVED.

export type Money = { currencyCode?: string; CurrencyCode?: string; amount?: number; Amount?: number };

// --- Pricing API (Featured Offer Expected Price + Competitive Summary) ---

export type FoepBatchRequestEntry = {
  method: 'POST';
  uri: string;
  marketplaceId: string;
  sku: string;
};
export type FoepBatchRequest = {
  requests: FoepBatchRequestEntry[];
};
export type FoepResultStatus = 'VALID_FOEP' | 'NOT_ELIGIBLE_TO_COMPETE' | string;
export type FoepResponseEntry = {
  status?: { statusCode: number; reasonPhrase?: string };
  body: {
    offerIdentifier?: { marketplaceId: string; sku: string };
    featuredOfferExpectedPriceResults?: Array<{
      featuredOfferExpectedPrice?: { listingPrice?: Money };
      resultStatus?: FoepResultStatus;
    }>;
  };
};
export type FoepBatchResponse = {
  responses: FoepResponseEntry[];
};

export type CompetitiveSummaryBatchRequest = {
  requests: Array<{
    asin: string;
    marketplaceId: string;
    includedData: string[];
    method: 'GET';
    uri: string;
  }>;
};
export type CompetitiveSummaryBatchResponse = {
  responses: Array<{
    asin: string;
    marketplaceId: string;
    featuredBuyingOptions?: Array<{
      segmentedFeaturedOffers?: Array<{
        listingPrice?: Money;
        shippingOptions?: Array<{ shippingOptionType?: string; price?: Money }>;
      }>;
    }>;
  }>;
};

// --- Listings API ---

export type ListingsItem = {
  sku: string;
  attributes?: Record<string, unknown>;
  offers?: Array<{ price?: { currency?: string; amount?: number } }>;
  status?: string;
  submissionId?: string;
};

// --- Notifications API ---

export type NotificationEnvelope = {
  NotificationVersion: string;
  // string (not a string-literal union) so we accept ANY_OFFER_CHANGED, ACCOUNT_STATUS_CHANGED,
  // LISTINGS_ITEM_ISSUES_CHANGE, LISTINGS_ITEM_STATUS_CHANGE, LISTINGS_ITEM_MFN_QUANTITY_CHANGE,
  // and our own convention CUSTOMER_MESSAGE_RECEIVED.
  NotificationType: string;
  PayloadVersion: string;
  EventTime: string;
  Payload: Record<string, unknown>;
  NotificationMetadata: {
    ApplicationId: string;
    SubscriptionId: string;
    PublishTime: string;
    NotificationId: string;
  };
};

// --- Reports API (parsed seller-performance shape) ---

export type SellerPerformanceSnapshot = {
  odr: number;
  late_ship_rate: number;
  cancellation_rate: number;
  vtr: number;
  buybox_pct: number;
  captured_at: string;
};
