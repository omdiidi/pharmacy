// EDI facade. Cred-gated by EZRIRX_SFTP_HOST presence (plus user/key).
// Real mode polls SFTP for the latest 832 envelopes; fixture mode loads
// vendor/edi-fixtures/wholesaler-832-*.edi files via parse832().

import { getRealCatalogClient } from './_real';
import { getFixtureCatalogClient } from './_fixtures';
import type { WholesalerSnapshot } from './types';

export type { Wholesaler, WholesalerSnapshot, AdvanceShipNotice } from './types';

export interface CatalogClient {
  getSnapshotsForNdcs(ndcs: string[]): Promise<WholesalerSnapshot[]>;
}

export function ediCredsPresent(): boolean {
  return (
    !!process.env.EZRIRX_SFTP_HOST &&
    !!process.env.EZRIRX_SFTP_USER &&
    !!process.env.EZRIRX_SFTP_KEY
  );
}

export const getWholesalerCatalogClient = (): CatalogClient =>
  ediCredsPresent() ? getRealCatalogClient() : getFixtureCatalogClient();
