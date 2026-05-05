// Real-mode CatalogClient placeholder. Wave 3 ships fixture mode only;
// the real EzriRx SFTP poll lands post-launch when Kaleem completes EDI
// onboarding (see docs/kaleem-onboarding.md and docs/wholesaler-connections.md).

import type { CatalogClient } from './index';

export function getRealCatalogClient(): CatalogClient {
  return {
    async getSnapshotsForNdcs(): Promise<never> {
      throw new Error(
        '[edi._real] EzriRx SFTP poller not implemented yet. Wave 3 ships fixture-mode only. ' +
          'See docs/kaleem-onboarding.md for the EzriRx onboarding playbook.',
      );
    },
  };
}
