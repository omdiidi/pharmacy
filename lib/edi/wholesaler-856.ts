// Parse 856 (Advance Ship Notice) into AdvanceShipNotice. Used by post-launch
// inbound-shipment correlation; Wave 3 keeps this as a stub for tests.
//
// Segment layout (per dossier):
//   BSN — purpose code, ASN id, date, time
//   REF*BM — carrier tracking number
//   LIN — item NDC (LIN02='N4', LIN03=NDC11)
//   SN1 — shipped quantity (SN102) and pack size (SN103)

import type { X12Interchange, X12Segment } from 'node-x12';
import { parseInterchange } from './x12';
import type { AdvanceShipNotice } from './types';

function elem(seg: X12Segment | undefined, idx: number): string {
  if (!seg) return '';
  return seg.elements[idx]?.value ?? '';
}

export function parse856(edi: string): AdvanceShipNotice | null {
  let interchange: X12Interchange;
  try {
    interchange = parseInterchange(edi);
  } catch (err) {
    console.warn(
      '[edi.856] parse failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  for (const fg of interchange.functionalGroups) {
    for (const tx of fg.transactions) {
      const segs = tx.segments;
      const bsn = segs.find((s) => s.tag === 'BSN');
      if (!bsn) continue;

      const refBm = segs.find((s) => s.tag === 'REF' && elem(s, 0) === 'BM');
      const tracking = refBm ? elem(refBm, 1) : null;

      // Compose ISO date from BSN03 (YYYYMMDD) + BSN04 (HHMM).
      const dateRaw = elem(bsn, 2);
      const timeRaw = elem(bsn, 3);
      let shippedAt = new Date().toISOString();
      if (/^\d{8}$/.test(dateRaw)) {
        const hh = /^\d{4}$/.test(timeRaw) ? timeRaw.slice(0, 2) : '00';
        const mm = /^\d{4}$/.test(timeRaw) ? timeRaw.slice(2, 4) : '00';
        shippedAt = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(
          6,
          8,
        )}T${hh}:${mm}:00.000Z`;
      }

      const items: AdvanceShipNotice['items'] = [];
      let curNdc: string | null = null;
      for (const seg of segs) {
        if (seg.tag === 'LIN' && elem(seg, 1) === 'N4') {
          curNdc = elem(seg, 2);
        } else if (seg.tag === 'SN1') {
          const qty = Number(elem(seg, 1));
          const pack = elem(seg, 2) || null;
          if (curNdc && Number.isFinite(qty)) {
            items.push({ ndc: curNdc, quantity: qty, pack_size: pack });
          }
          curNdc = null;
        }
      }

      return {
        bsn_number: elem(bsn, 1),
        tracking_number: tracking || null,
        shipped_at: shippedAt,
        items,
      };
    }
  }
  return null;
}
