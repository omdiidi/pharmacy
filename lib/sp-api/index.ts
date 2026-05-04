// Public surface for the SP-API facade. Each factory tests for credentials
// at call-time and returns the real client when present, the fixture client
// otherwise. There is no flag, no toggle — credential presence drives
// everything.

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
  return (
    !!process.env.SP_API_REFRESH_TOKEN &&
    !!process.env.LWA_CLIENT_ID &&
    !!process.env.LWA_CLIENT_SECRET
  );
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
  spApiCredsPresent() ? getRealMessagingClient() : getFixtureMessagingClient();
