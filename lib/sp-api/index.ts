// Public surface for the SP-API facade. Each factory tests for credentials
// at call-time and returns the real client when present, the fixture client
// otherwise. Phase 4a hardening: cred presence uses allEnvReal() so empty /
// placeholder env values don't fool the gate. Messaging additionally requires
// SP_API_MESSAGING_REAL_CLIENT_READY === 'true' (real client throws
// NotImplementedError today).

import { allEnvReal } from '@/lib/env-gate';
import { getFixtureListingsClient, getRealListingsClient, type ListingsClient } from './listings';
import { getFixturePricingClient, getRealPricingClient, type PricingClient } from './pricing';
import {
  getFixtureNotificationsClient,
  getRealNotificationsClient,
  type NotificationsClient,
} from './notifications';
import { getFixtureReportsClient, getRealReportsClient, type ReportsClient } from './reports';
import { getFixtureMessagingClient, getRealMessagingClient, type MessagingClient } from './messaging';

export type { ListingsClient, PricingClient, NotificationsClient, ReportsClient, MessagingClient };
export type {
  CompetitiveSummaryBatchRequest,
  CompetitiveSummaryBatchResponse,
  FoepBatchRequest,
  FoepBatchRequestEntry,
  FoepBatchResponse,
  ListingsItem,
  NotificationEnvelope,
  SellerPerformanceSnapshot,
} from './types';

export function spApiCredsPresent(): boolean {
  return allEnvReal('SP_API_REFRESH_TOKEN', 'LWA_CLIENT_ID', 'LWA_CLIENT_SECRET');
}

// Messaging real client requires explicit opt-in (we ship a stub today; the
// real client throws NotImplementedError until post-launch implementation lands).
function messagingReady(): boolean {
  return spApiCredsPresent() && process.env.SP_API_MESSAGING_REAL_CLIENT_READY === 'true';
}

export const getListingsClient = (): ListingsClient =>
  spApiCredsPresent() ? getRealListingsClient() : getFixtureListingsClient();
export const getPricingClient = (): PricingClient =>
  spApiCredsPresent() ? getRealPricingClient() : getFixturePricingClient();
export const getNotificationsClient = (): NotificationsClient =>
  spApiCredsPresent() ? getRealNotificationsClient() : getFixtureNotificationsClient();
export const getReportsClient = (): ReportsClient =>
  spApiCredsPresent() ? getRealReportsClient() : getFixtureReportsClient();
export const getMessagingClient = (): MessagingClient =>
  messagingReady() ? getRealMessagingClient() : getFixtureMessagingClient();
