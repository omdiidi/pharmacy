// Inserts dev fixtures so the Inbox + Chat aren't empty in local dev.
// Run with: npm run seed:dev   (i.e. tsx scripts/seed-dev-data.ts)
//
// Uses the service role key — server-only, never bundled into the Next.js app.
// Idempotent: products use (pharmacy_id, asin) on conflict do nothing; memory
// + briefings de-dupe via natural keys (content / title).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PHARMACY_ID = '00000000-0000-0000-0000-000000000001';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Product = {
  pharmacy_id: string;
  name: string;
  brand: string;
  asin: string;
  upc: string;
  ndc: string;
  category: string;
  form: string;
  pack_size: string;
  watchlist_status: 'none' | 'watching' | 'active' | 'paused' | 'blocked';
};

const PRODUCTS: Product[] = [
  {
    pharmacy_id: PHARMACY_ID,
    name: 'Vitamin D3 5000 IU',
    brand: 'Nature Made',
    asin: 'B004U3Y9FU',
    upc: '031604026677',
    ndc: '31604-0266-77',
    category: 'supplement',
    form: 'softgel',
    pack_size: '90ct',
    watchlist_status: 'active',
  },
  {
    pharmacy_id: PHARMACY_ID,
    name: 'Omega-3 Fish Oil 1000mg',
    brand: 'Nordic Naturals',
    asin: 'B001GKPASE',
    upc: '768990017605',
    ndc: '76899-0017-60',
    category: 'supplement',
    form: 'softgel',
    pack_size: '120ct',
    watchlist_status: 'watching',
  },
  {
    pharmacy_id: PHARMACY_ID,
    name: 'Melatonin 5mg',
    brand: 'NOW Foods',
    asin: 'B0019LRY8A',
    upc: '733739032553',
    ndc: '73373-9032-55',
    category: 'supplement',
    form: 'tablet',
    pack_size: '180ct',
    watchlist_status: 'active',
  },
  {
    pharmacy_id: PHARMACY_ID,
    name: 'Magnesium Glycinate 400mg',
    brand: "Doctor's Best",
    asin: 'B000BD0RT0',
    upc: '753950001244',
    ndc: '75395-0001-24',
    category: 'supplement',
    form: 'tablet',
    pack_size: '240ct',
    watchlist_status: 'watching',
  },
  {
    pharmacy_id: PHARMACY_ID,
    name: 'Tinactin Antifungal Cream 1oz',
    brand: 'Bayer',
    asin: 'B000GCL1KY',
    upc: '041100808646',
    ndc: '04110-0808-64',
    category: 'otc_drug',
    form: 'cream',
    pack_size: '1oz',
    watchlist_status: 'active',
  },
];

type MemoryRow = {
  pharmacy_id: string;
  kind: 'episodic' | 'procedural' | 'semantic' | 'preferences';
  source: string;
  content: string;
};

const MEMORY: MemoryRow[] = [
  {
    pharmacy_id: PHARMACY_ID,
    kind: 'episodic',
    source: 'kaleem',
    content:
      'Sold Tinactin Apr 8 at $51 vs $7 cost during stock-out window — confirmed FBM-wins-when-FBA-empty pattern.',
  },
  {
    pharmacy_id: PHARMACY_ID,
    kind: 'semantic',
    source: 'research_analyst',
    content:
      'Nature Made / Pharmavite filed IP complaints against unauthorized resellers in 2023.',
  },
  {
    pharmacy_id: PHARMACY_ID,
    kind: 'semantic',
    source: 'research_analyst',
    content: 'ABC ships within 1 business day from SLC distribution center.',
  },
  {
    pharmacy_id: PHARMACY_ID,
    kind: 'semantic',
    source: 'research_analyst',
    content:
      'Amazon expanded TIC requirement to ALL supplements Dec 2025 — verified brands required.',
  },
  {
    pharmacy_id: PHARMACY_ID,
    kind: 'procedural',
    source: 'reflector',
    content: 'Reprice melatonin upward when Amazon FBA flag flips empty.',
  },
  {
    pharmacy_id: PHARMACY_ID,
    kind: 'procedural',
    source: 'reflector',
    content: 'Block listing if remaining shelf life < 270 days at dispatch.',
  },
  {
    pharmacy_id: PHARMACY_ID,
    kind: 'episodic',
    source: 'kaleem',
    content:
      'Paused Omega-3 listing Apr 12 after FBA inventory restocked and Buy Box returned to Amazon.',
  },
  {
    pharmacy_id: PHARMACY_ID,
    kind: 'episodic',
    source: 'repricer',
    content:
      'Held Vitamin D3 at $18.99 over the weekend; Buy Box was still FBM-only Sunday morning.',
  },
  {
    pharmacy_id: PHARMACY_ID,
    kind: 'episodic',
    source: 'fulfillment_ops',
    content:
      'Cardinal beat ABC by $0.40/unit on Magnesium Glycinate Apr 15 — switched preferred supplier for that SKU only.',
  },
  {
    pharmacy_id: PHARMACY_ID,
    kind: 'episodic',
    source: 'kaleem',
    content:
      'Declined a Melatonin restock proposal Apr 18 — wanted to wait for Keepa price-history confirmation first.',
  },
];

type BriefingSeed = {
  briefing_type:
    | 'hot_arbitrage'
    | 'reprice_down'
    | 'account_health';
  source_agent: string;
  title: string;
  summary: string;
  rationale: string;
  confidence: number;
  urgency: number;
};

const BRIEFINGS: BriefingSeed[] = [
  {
    briefing_type: 'hot_arbitrage',
    source_agent: 'research_analyst',
    title:
      'Magnesium Glycinate Buy Box flipped to FBM — list at $34.99',
    summary:
      "Doctor's Best Magnesium Glycinate 400mg lost FBA inventory overnight. FBM Buy Box at $34.99, ABC cost $9.20. Margin window likely 2-5 days.",
    rationale:
      'Keepa shows FBA stock-out at 02:14 UTC. Last 3 stock-outs lasted 3-7 days. Pharmavite is not the brand; no IP risk. Recommend list now at $34.99.',
    confidence: 0.78,
    urgency: 4,
  },
  {
    briefing_type: 'reprice_down',
    source_agent: 'repricer',
    title: 'Tinactin scarcity premium expired — drop from $51 to $34',
    summary:
      'Amazon FBA restocked Tinactin 1oz overnight. Buy Box returned to FBA at $33.95. Hold-or-drop decision needed.',
    rationale:
      'Three competing FBM listings repriced down within 90 minutes. Held inventory will not move at $51. Drop to $34 to stay in second-position consideration set.',
    confidence: 0.65,
    urgency: 2,
  },
  {
    briefing_type: 'account_health',
    source_agent: 'account_health',
    title: 'All Amazon health metrics green this week',
    summary:
      'ODR 0.4%, Late Ship 1.2%, Cancellation 0.3%, VTR 99.1%. No interventions proposed.',
    rationale:
      'All metrics inside Amazon thresholds; trailing 30-day trend stable. Continue current dispatch SLA and tracking-upload cadence.',
    confidence: 0.95,
    urgency: 1,
  },
];

async function main() {
  console.log('[seed] connecting to', SUPABASE_URL);

  // -------------------------------------------------------------------------
  // Products — upsert on (pharmacy_id, asin)
  // -------------------------------------------------------------------------
  const { error: prodErr } = await supabase
    .from('products')
    .upsert(PRODUCTS, { onConflict: 'pharmacy_id,asin', ignoreDuplicates: true });
  if (prodErr) {
    console.error('[seed] products error:', prodErr);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Memory — insert only if exact content not already present.
  // -------------------------------------------------------------------------
  let memInserted = 0;
  for (const row of MEMORY) {
    const { data: existing } = await supabase
      .from('memory')
      .select('id')
      .eq('pharmacy_id', row.pharmacy_id)
      .eq('content', row.content)
      .limit(1);
    if (existing && existing.length > 0) continue;

    const { error } = await supabase.from('memory').insert(row);
    if (error) {
      console.error('[seed] memory insert error:', error);
      process.exit(1);
    }
    memInserted += 1;
  }

  // -------------------------------------------------------------------------
  // Briefings + matching inbox_items.
  // -------------------------------------------------------------------------
  let briefingsInserted = 0;
  let inboxInserted = 0;
  for (const b of BRIEFINGS) {
    const { data: existing } = await supabase
      .from('briefings')
      .select('id')
      .eq('pharmacy_id', PHARMACY_ID)
      .eq('title', b.title)
      .limit(1);

    let briefingId: string | undefined = existing?.[0]?.id;

    if (!briefingId) {
      const { data: inserted, error } = await supabase
        .from('briefings')
        .insert({ pharmacy_id: PHARMACY_ID, ...b })
        .select('id')
        .single();
      if (error || !inserted) {
        console.error('[seed] briefing insert error:', error);
        process.exit(1);
      }
      briefingId = inserted.id;
      briefingsInserted += 1;
    }

    const { data: existingInbox } = await supabase
      .from('inbox_items')
      .select('id')
      .eq('briefing_id', briefingId)
      .limit(1);

    if (!existingInbox || existingInbox.length === 0) {
      const { error: inboxErr } = await supabase.from('inbox_items').insert({
        pharmacy_id: PHARMACY_ID,
        briefing_id: briefingId,
        state: 'pending',
      });
      if (inboxErr) {
        console.error('[seed] inbox_items insert error:', inboxErr);
        process.exit(1);
      }
      inboxInserted += 1;
    }
  }

  console.log(
    `[seed] Inserted ${PRODUCTS.length} products, ${memInserted} memory rows, ${briefingsInserted} briefings, ${inboxInserted} inbox_items.`
  );
}

main().catch((err) => {
  console.error('[seed] fatal:', err);
  process.exit(1);
});
