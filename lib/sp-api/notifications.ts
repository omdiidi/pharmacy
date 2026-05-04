// Notifications client. Used at *setup time* (creating the destination + subscribing
// to NotificationTypes); not at agent runtime. Fixture mode is a no-op.

import { spFetch } from './client';

export interface NotificationsClient {
  createDestination(name: string, sqsArn: string): Promise<{ destinationId: string }>;
  createSubscription(notificationType: string, destinationId: string): Promise<{ subscriptionId: string }>;
}

export const getRealNotificationsClient = (): NotificationsClient => ({
  async createDestination(name, sqsArn) {
    const res = await spFetch<{ payload: { destinationId: string; name: string } }>(
      '/notifications/v1/destinations',
      {
        method: 'POST',
        body: JSON.stringify({ name, resourceSpecification: { sqs: { arn: sqsArn } } }),
      },
    );
    return { destinationId: res.payload.destinationId };
  },
  async createSubscription(notificationType, destinationId) {
    const res = await spFetch<{ payload: { subscriptionId: string } }>(
      `/notifications/v1/subscriptions/${encodeURIComponent(notificationType)}`,
      {
        method: 'POST',
        body: JSON.stringify({ payloadVersion: '1.0', destinationId }),
      },
    );
    return { subscriptionId: res.payload.subscriptionId };
  },
});

export const getFixtureNotificationsClient = (): NotificationsClient => ({
  async createDestination() {
    return { destinationId: 'fixture-destination' };
  },
  async createSubscription() {
    return { subscriptionId: 'fixture-subscription-id' };
  },
});
