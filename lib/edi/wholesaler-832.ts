// Parse 832 (Price/Sales Catalog) interchange into WholesalerSnapshot[].
// We walk transaction segments directly because the X12 query engine's path
// syntax is awkward for the LIN/PID/PO4/CTP loop we need.
//
// Segment layout per dossier:
//   BCT  — header with capture date in element 5
//   LIN  — line item; LIN02='N4' qualifier, LIN03=NDC11
//   PID  — product description
//   PO4  — physical details (pack info)
//   CTP  — composite price (we want CTP02='WHL', CTP03=unit price)

import type { X12Interchange, X12Segment } from 'node-x12';
import { parseInterchange } from './x12';
import type { Wholesaler, WholesalerSnapshot } from './types';

const DEFAULT_ETA: Record<Wholesaler, number> = {
  abc: 1,
  mckesson: 1,
  cardinal: 2,
  parmed: 2,
  ezrirx: 1,
};

function elem(seg: X12Segment | undefined, idx: number): string {
  if (!seg) return '';
  return seg.elements[idx]?.value ?? '';
}

function isoFromBct(seg: X12Segment | undefined): string {
  // BCT05 is YYYYMMDD per dossier example.
  const raw = elem(seg, 4);
  if (!/^\d{8}$/.test(raw)) return new Date().toISOString();
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  return `${y}-${m}-${d}T00:00:00.000Z`;
}

export function parse832(
  edi: string,
  wholesaler: Wholesaler,
): WholesalerSnapshot[] {
  let interchange: X12Interchange;
  try {
    interchange = parseInterchange(edi);
  } catch (err) {
    console.warn(
      `[edi.832] parse failed for ${wholesaler}:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }

  const out: WholesalerSnapshot[] = [];
  for (const fg of interchange.functionalGroups) {
    for (const tx of fg.transactions) {
      const segments = tx.segments;
      const bct = segments.find((s) => s.tag === 'BCT');
      const capturedAt = isoFromBct(bct);

      let cur: {
        ndc?: string;
        name?: string;
        packSize?: string;
        wholesalePrice?: number;
      } = {};

      const flush = () => {
        if (cur.ndc && typeof cur.wholesalePrice === 'number') {
          out.push({
            wholesaler,
            ndc: cur.ndc,
            product_name: cur.name ?? '',
            unit_price: cur.wholesalePrice,
            pack_size: cur.packSize ?? '',
            // 832 has no real-time stock; synthesize a default so downstream
            // payloads have a numeric value to compare.
            stock_qty: 100,
            eta_days: DEFAULT_ETA[wholesaler],
            captured_at: capturedAt,
          });
        }
      };

      for (const seg of segments) {
        if (seg.tag === 'LIN') {
          // New line — flush previous.
          flush();
          cur = {};
          // Qualifier in LIN02; NDC in LIN03 per dossier shape.
          if (elem(seg, 1) === 'N4') {
            cur.ndc = elem(seg, 2);
          }
        } else if (seg.tag === 'PID') {
          cur.name = elem(seg, 4);
        } else if (seg.tag === 'PO4') {
          // PO401 = pack qty, PO402 = pack size num, PO403 = unit of measure.
          // We collapse into "<num><uom>" e.g. "15GR".
          const qty = elem(seg, 1);
          const uom = elem(seg, 2);
          cur.packSize = `${qty}${uom}`.trim();
        } else if (seg.tag === 'CTP') {
          // CTP02 = price qualifier, CTP03 = unit price as decimal string.
          if (elem(seg, 1) === 'WHL') {
            const raw = elem(seg, 2);
            const num = Number(raw);
            if (Number.isFinite(num)) cur.wholesalePrice = num;
          }
        }
      }
      flush();
    }
  }
  return out;
}
