// One-shot openFDA probe. Verifies real fetch works without a key.
// Local: npm run fda:smoke

import { getActiveOtcShortages, getRecentDrugRecalls } from '@/lib/fda';

async function main() {
  console.log('[fda-smoke] fetching first 3 OTC shortages...');
  const shortages = await getActiveOtcShortages(3);
  console.log(`[fda-smoke] got ${shortages.length} shortages`);
  for (const s of shortages) {
    console.log(
      `  - ${s.proprietary_name ?? s.generic_name ?? '?'} status=${s.status ?? '?'} updated=${s.update_date ?? '?'}`,
    );
  }

  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  console.log(`[fda-smoke] fetching recalls since ${since}...`);
  const recalls = await getRecentDrugRecalls({ since, limit: 3 });
  console.log(`[fda-smoke] got ${recalls.length} recalls`);
  for (const r of recalls) {
    console.log(
      `  - ${r.product_description?.slice(0, 80) ?? '?'} class=${r.classification ?? '?'} reported=${r.report_date ?? '?'}`,
    );
  }
}

main().catch((err) => {
  console.error('[fda-smoke] fatal:', err);
  process.exit(1);
});
