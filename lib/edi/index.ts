// EDI facade. Cred-gated by EZRIRX_SFTP_HOST/USER/KEY presence AND an explicit
// EZRIRX_REAL_CLIENT_READY=true opt-in flag (the real SFTP poller is still a
// NotImplementedError stub — fail-loud if someone flips the flag before the
// poller is wired). Fixture mode loads vendor/edi-fixtures/wholesaler-832-*.edi.

import { allEnvReal } from '@/lib/env-gate';
import { getRealCatalogClient } from './_real';
import { getFixtureCatalogClient } from './_fixtures';
import type { WholesalerSnapshot } from './types';

export type { Wholesaler, WholesalerSnapshot, AdvanceShipNotice } from './types';

export interface CatalogClient {
  getSnapshotsForNdcs(ndcs: string[]): Promise<WholesalerSnapshot[]>;
}

export function ediCredsPresent(): boolean {
  return allEnvReal('EZRIRX_SFTP_HOST', 'EZRIRX_SFTP_USER', 'EZRIRX_SFTP_KEY');
}

function ediReady(): boolean {
  return ediCredsPresent() && process.env.EZRIRX_REAL_CLIENT_READY === 'true';
}

export const getWholesalerCatalogClient = (): CatalogClient =>
  ediReady() ? getRealCatalogClient() : getFixtureCatalogClient();
