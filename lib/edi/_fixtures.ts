// Fixture-mode CatalogClient. Loads vendor/edi-fixtures/wholesaler-832-*.edi,
// parses each via parse832, returns merged WholesalerSnapshot[]. Filters by
// the requested NDC list at parse time.

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse832 } from './wholesaler-832';
import type { CatalogClient } from './index';
import type { Wholesaler, WholesalerSnapshot } from './types';
import { WHOLESALERS } from './types';

const FIXTURE_DIR = path.resolve(process.cwd(), 'vendor', 'edi-fixtures');

async function loadOne(w: Wholesaler): Promise<WholesalerSnapshot[]> {
  const file = path.join(FIXTURE_DIR, `wholesaler-832-${w}.edi`);
  try {
    const edi = await readFile(file, 'utf8');
    return parse832(edi, w);
  } catch (err) {
    console.warn(
      `[edi.fixtures] could not load ${file}:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export function getFixtureCatalogClient(): CatalogClient {
  return {
    async getSnapshotsForNdcs(ndcs: string[]): Promise<WholesalerSnapshot[]> {
      const all: WholesalerSnapshot[] = [];
      for (const w of WHOLESALERS) {
        const snaps = await loadOne(w);
        all.push(...snaps);
      }
      const set = new Set(ndcs.map((n) => n.replace(/-/g, '')));
      return all.filter((s) => set.has(s.ndc.replace(/-/g, '')));
    },
  };
}
