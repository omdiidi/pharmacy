# FDA APIs + Google Trends Data Sources — Research Dossier

> Written 2026-05-04. Scope: Research Analyst (Wave 3) data sources for scoring listing opportunities.
> Two pillars: (1) openFDA — drug shortages + recalls, free no-auth path. (2) Google Trends — no official API; document realistic trade-offs.

---

## TL;DR / Recommendation

| Source | Use it? | Auth | Cost | Reliability |
|---|---|---|---|---|
| openFDA Drug Shortage | YES | None (key optional) | Free | Production-grade. FDA-operated. |
| openFDA Drug Enforcement (Recalls) | YES | None (key optional) | Free | Production-grade. FDA-operated. |
| openFDA NDC + Drug Label | YES (lookup helper) | None (key optional) | Free | Production-grade. |
| pytrends (unofficial scraper) | NO (last resort only) | None | Free | Repo archived 2025-04-17. 429s endemic. |
| pytrends-async (community fork) | Maybe (Phase 2.5) | None | Free | Same scrape risk; better retry/proxy support. |
| SerpAPI Google Trends | YES if budget | API key | $75/mo for 5k searches ($0.015/q) | 99.8% uptime claim. |
| DataForSEO Google Trends | YES (cheaper) | API key | $0.00225/task standard, $0.009 live | Solid; daily 500k cap shared. |
| Brave Search (trending) | NO (no Trends-equivalent endpoint) | API key | $5/1k req | No trending-search endpoint. |

**Pragmatic phasing for PharmaDash:**

1. **Wave 3 ship:** openFDA (shortage + recall) — both endpoints, no key required, fixture-based fallback if FDA returns 5xx. The Drug Shortage endpoint alone gives the Research Analyst its highest-leverage signal: every active shortage is a stock-out arbitrage candidate Kaleem can list against FBA-trust-decayed competitors.
2. **Defer Google Trends to Phase 2.5.** The signal value is real but sub-linear vs FDA shortage data, and no path is both free + reliable. If pursued, **SerpAPI** is the lowest-friction integration ($75/mo dev tier — fits PharmaDash's per-month budget envelope) — paid TypeScript-first so no Python sidecar.
3. **Skip pytrends.** Repo archived; 429s after a single request reported on GitHub issues; not safe to run unattended in a Render cron.

---

## 1. openFDA Drug Shortage API

### Auth model
None required. API key optional but strongly recommended for non-trivial usage.
- No key: 240 req/min/IP, 1,000 req/day/IP
- Free key: 240 req/min/key, 120,000 req/day/key
- Key passed as `?api_key=...` or HTTP Basic auth header.
- Get key: https://open.fda.gov/apis/authentication/

### Endpoint
- **Base:** `https://api.fda.gov`
- **Path:** `/drug/shortages.json`
- **HTTPS only.** Data source: FDA Drug Shortage Database. Update cadence: daily-ish (FDA publishes "last_updated" in `meta`).

### Query syntax
Standard openFDA syntax (per https://open.fda.gov/apis/query-syntax/):
- `search=field:term` — single field/term
- `search=field:term1+AND+field:term2` — AND
- `search=field:term1+field:term2` — OR (default joiner)
- `field:"exact phrase"` — exact match (URL-encode quotes)
- `field.exact:value` — match whole-token (vs sub-tokens)
- `sort=field:desc` (or `:asc`) — order results
- `count=field.exact` — aggregate count by distinct field value
- `limit=N` (max 1000) — page size
- `skip=N` — pagination offset
- Date ranges: `field:[YYYYMMDD+TO+YYYYMMDD]` (yes, square brackets URL-encoded as `%5B`/`%5D`)

### Response shape

```typescript
interface FdaShortageResponse {
  meta: {
    disclaimer: string;
    terms: string;
    license: string;
    last_updated: string; // ISO date
    results: { skip: number; limit: number; total: number };
  };
  results: FdaShortageRecord[];
}

interface FdaShortageRecord {
  // Core update / status
  update_type: string;            // e.g., "New", "Update", "Resolved"
  initial_posting_date: string;   // YYYY-MM-DD
  update_date: string;
  status: string;                 // "Currently in Shortage" | "Resolved" | "Discontinuation" | ...
  availability: string;           // free-text supply notes
  related_info: string;           // free-text, often empty

  // Product identifiers
  package_ndc: string;            // e.g., "12345-678-90"
  generic_name: string;           // primary join key for our DB
  brand_name: string;
  dosage_form: string;            // "TABLET", "CAPSULE", etc.
  presentation: string;           // strength + form, e.g. "500 MG TABLETS"

  // Company
  company_name: string;
  contact_info: string;

  // Clinical
  therapeutic_category: string[];
  route: string[];                // ["ORAL"], ["TOPICAL"], etc.

  // Standardized cross-dataset identifiers (this is the goldmine)
  openfda: {
    application_number?: string[];
    manufacturer_name?: string[];
    product_ndc?: string[];
    product_type?: string[];      // "HUMAN OTC DRUG" — filter on this for our use case
    substance_name?: string[];
    rxcui?: string[];             // RxNorm clinical concept
    unii?: string[];              // FDA substance identifier
    spl_id?: string[];
    spl_set_id?: string[];
  };
}
```

### High-value queries for PharmaDash

```
# All currently-shorted OTC drugs, newest update first, top 50
GET /drug/shortages.json
   ?search=status:%22Currently+in+Shortage%22+AND+openfda.product_type:%22HUMAN+OTC+DRUG%22
   &sort=update_date:desc
   &limit=50

# Match shortages against our product catalog by generic_name
GET /drug/shortages.json
   ?search=generic_name:%22acetaminophen%22+AND+status:%22Currently+in+Shortage%22

# Aggregate: count of shortages by therapeutic_category
GET /drug/shortages.json
   ?search=status:%22Currently+in+Shortage%22
   &count=therapeutic_category.exact
```

### Reliability + sandbox
- Production-grade FDA-operated API. No formal sandbox; just hit prod with `limit=1`.
- Failure modes: occasional 5xx during FDA maintenance (rare, weekend mornings). Plan: catch 5xx, fall back to last-cached snapshot in our DB (we'll mirror shortage rows into `data.fda_shortages` table on each cron tick).
- No quota means our daily cron (1 request) can run keyless; if Wave 3 expands to per-product joined queries, request a free key.

### Fixture fallback (when offline / 5xx)
Drop a static JSON fixture at `tmp/fixtures/fda-shortages.sample.json` mirroring the `results[]` shape above. Worker reads from fixture when `process.env.OPENFDA_USE_FIXTURE === 'true'` OR when live request 5xx-fails. Same pattern we used for the listing-agent stub.

---

## 2. openFDA Drug Enforcement (Recall) API

### Auth + rate limits
Same as above: keyless 1k/day/IP; free key 120k/day/key.

### Endpoint
- **Base:** `https://api.fda.gov`
- **Path:** `/drug/enforcement.json`
- **Coverage:** 2004 to present, **weekly update cadence** (per FDA docs).
- **Important caveat from FDA:** "FDA does not update the status of a recall after it is published." Status field reflects the snapshot at publication, not lifecycle. Don't use this for "is this recall over" decisions; use it for "did this product ever get recalled, and how serious was it" decisions.

### Searchable fields (full list)
| Field | Type | Use |
|---|---|---|
| address_1, address_2, city, state, postal_code, country | string | Firm location |
| center_classification_date | string | When FDA classified the recall |
| classification | string | "Class I" (severe), "Class II" (mod), "Class III" (low) |
| code_info | string | Lot/batch identifiers |
| distribution_pattern | string | Geographic scope (e.g., "Nationwide", "UT, NV, AZ") |
| event_id | string | Unique recall event ID |
| initial_firm_notification | string | How firm notified (e.g., "Letter") |
| more_code_info | string | Extended lot info |
| openfda | object | Cross-dataset identifiers (same shape as shortage) |
| product_code | string | FDA product code |
| product_description | string | Free-text product description |
| product_quantity | string | How much was recalled |
| product_type | (unspec) | "Drugs", "Devices", etc. |
| reason_for_recall | string | Free-text cause |
| recall_initiation_date | string | When firm started recall |
| recall_number | string | Official designation (e.g., "D-1234-2025") |
| recalling_firm | string | Company name |
| report_date | string | When recall was filed/published |
| status | string | "Ongoing", "Completed", "Terminated" (snapshot only) |
| termination_date | string | When closed (if present) |
| voluntary_mandated | string | "Voluntary: Firm initiated" / "FDA Mandated" |

### Response shape

```typescript
interface FdaRecallResponse {
  meta: {
    disclaimer: string;
    terms: string;
    license: string;
    last_updated: string;
    results: { skip: number; limit: number; total: number };
  };
  results: FdaRecallRecord[];
}

interface FdaRecallRecord {
  event_id: string;
  recall_number: string;
  status: 'Ongoing' | 'Completed' | 'Terminated' | string;
  classification: 'Class I' | 'Class II' | 'Class III' | string;
  product_type: string;        // "Drugs"
  recalling_firm: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  product_description: string;
  product_quantity: string;
  code_info: string;
  more_code_info: string;
  reason_for_recall: string;
  voluntary_mandated: string;
  distribution_pattern: string;
  initial_firm_notification: string;
  recall_initiation_date: string; // YYYYMMDD
  center_classification_date: string;
  report_date: string;
  termination_date: string;
  openfda: {
    application_number?: string[];
    manufacturer_name?: string[];
    product_ndc?: string[];
    product_type?: string[];
    substance_name?: string[];
    rxcui?: string[];
    unii?: string[];
    spl_id?: string[];
    spl_set_id?: string[];
  };
}
```

### High-value queries for PharmaDash

```
# Class I + II OTC drug recalls in the last 90 days, newest first
GET /drug/enforcement.json
   ?search=product_type:%22Drugs%22
     +AND+(classification:%22Class+I%22+classification:%22Class+II%22)
     +AND+report_date:[20260204+TO+20260504]
   &sort=report_date:desc
   &limit=100

# Match against our catalog by manufacturer
GET /drug/enforcement.json
   ?search=recalling_firm:%22Bayer%22+AND+report_date:[20260101+TO+20260504]

# Match by NDC (when we have it from listing data)
GET /drug/enforcement.json
   ?search=openfda.product_ndc:%2211523-7338%22
```

### How Research Analyst uses this
1. **Listing-veto signal:** if any Class I or active-Ongoing recall matches a candidate product's NDC or manufacturer, refuse to propose the listing. Hard rule.
2. **Competitive-window signal:** Class II/III recall on a competing brand widens Kaleem's selling window for the unaffected brand. Soft signal, scored.
3. **Account Health adjacent:** if Kaleem has live listings for a recalled SKU, escalate immediately.

---

## 3. openFDA Drug Label + NDC (lookup helpers)

These two endpoints aren't primary signals — they're **join-table helpers** for matching shortage/recall rows to our internal product catalog.

### `/drug/ndc.json` — National Drug Code directory
- Same auth/rate limits as above.
- One row per labeled drug product. Use when we have a UPC/NDC and need to resolve generic_name + manufacturer + product_type ("HUMAN OTC DRUG" filter).

```typescript
interface FdaNdcRecord {
  product_ndc: string;
  generic_name: string;
  labeler_name: string;
  brand_name: string;
  brand_name_base: string;
  finished: boolean;
  packaging: Array<{
    package_ndc: string;
    description: string;
    marketing_start_date: string;
    sample: boolean;
  }>;
  listing_expiration_date: string;
  marketing_category: string;        // e.g., "OTC MONOGRAPH DRUG"
  dosage_form: string;
  product_type: string;              // "HUMAN OTC DRUG" — primary filter
  marketing_start_date: string;
  product_id: string;
  application_number: string;
  spl_id: string;
  openfda: {
    manufacturer_name?: string[];
    spl_set_id?: string[];
    is_original_packager?: boolean[];
  };
}
```

### `/drug/label.json` — Structured Product Labeling
- Useful when matching by Amazon listing title (no NDC) — search `openfda.brand_name` to backfill NDC.
- Heavy response shape (200+ fields per record); only request fields you need via `?_source` is **NOT supported** by openFDA — full record is always returned. Keep `limit` low.

### Common matching strategy
```
Amazon ASIN/title → fuzzy match → brand_name or generic_name in /drug/ndc.json
                                → resolve product_ndc + manufacturer
                                → join to /drug/shortages.json (active shortage?)
                                → join to /drug/enforcement.json (any recall?)
```

Cache `/drug/ndc.json` as a nightly snapshot table in Supabase (~150k rows, ~50MB JSONL). The shortage + recall endpoints stay live (small daily diffs).

---

## 4. Google Trends — No Official API (the realistic options)

### The honest picture
**Google does not publish an official Google Trends API.** Every option below is one of:
- (a) Scraping the unofficial endpoint that powers the Trends website (cheap, fragile, blocked).
- (b) A paid third party that scrapes it on your behalf with proxy rotation (expensive, reliable).

There is no fourth option. If reliability matters, you pay. If budget matters, you self-scrape and accept the breakage.

### Option A: pytrends (DON'T)

- **Repo:** https://github.com/GeneralMills/pytrends
- **Status:** Repository **archived 2025-04-17**, last release v4.9.1 (April 2023). 136 open issues at archive time, many tagged 429.
- **What it does:** Python library, scrapes Google Trends front-door endpoints. Returns interest-over-time, related queries, related topics.
- **Auth:** None.
- **Cost:** $0.
- **Reliability:** Bad and worsening. GitHub issues #243, #535, #561, #602, #625, #631, #492 all report `429 Too Many Requests` — sometimes after a single request. The README admits "Only good until Google changes their backend again." Maintainer asks for new owners.
- **Sandbox:** N/A.
- **Verdict:** Not safe to run unattended in production. Even with 60s sleeps + proxy rotation it will pause our cron randomly. Skip.

### Option B: pytrends-async (community fork, marginal improvement)

- **PyPI:** https://pypi.org/project/pytrends-async/
- Async/await + `tenacity` retry with exponential backoff (`backoff_factor * (2 ^ retries)` seconds).
- HTTP/1.1 (vs HTTP/2 in upstream), proper connection cleanup, proxy support built in.
- Same fundamental risk: Google can block the upstream endpoint at any time.
- **Verdict:** If we *had to* self-scrape, this is the better starting point. Still defer.

### Option C: SerpAPI Google Trends (recommended paid path)

- **Docs:** https://serpapi.com/google-trends-api
- **Auth:** API key (`?api_key=...`).
- **Endpoint:** `https://serpapi.com/search?engine=google_trends&q=...`
- **Pricing (2026):**
  - Free trial: 100 credits, **expires monthly, requires CC** — not a true free tier.
  - **Developer: $75/mo for 5,000 searches** ($0.015/q).
  - Higher tiers down to $0.005/q at volume.
  - **Credits don't roll over** — unused credits expire each cycle. Real cost can drift to ~$0.025/q for variable workloads.
- **Rate limits:** Per-plan. Developer tier easily handles our envelope (we'd run ~30 trend lookups/day = ~900/mo, well under 5k).
- **Reliability:** 99.8% uptime claimed. SerpAPI is the de-facto standard for Trends scraping in production.
- **Sandbox/dev key:** Free trial credits work for development; no separate sandbox.
- **TypeScript-first:** Plain HTTPS GET — no Python sidecar needed. Fits PharmaDash's TS-only worker.

```typescript
interface SerpApiTrendsRequest {
  engine: 'google_trends';
  q: string;                          // 1-5 terms, comma-separated, max 100 chars each
  api_key: string;
  data_type?: 'TIMESERIES' | 'GEO_MAP' | 'GEO_MAP_0' | 'RELATED_TOPICS' | 'RELATED_QUERIES';
  date?: string;                      // 'now 1-d', 'today 1-m', 'today 12-m', 'today 5-y', or 'YYYY-MM-DD YYYY-MM-DD'
  geo?: string;                       // 'US', 'US-UT', etc. Default: worldwide
  hl?: string;                        // 'en'
  cat?: number;                       // category id
  gprop?: 'web' | 'images' | 'news' | 'shopping' | 'youtube';
  tz?: number;                        // timezone offset minutes
  include_low_search_volume?: boolean;
  csv?: boolean;
  no_cache?: boolean;
  async?: boolean;
}

interface SerpApiTimeseriesResponse {
  search_metadata: { id: string; status: string; created_at: string; ... };
  search_parameters: SerpApiTrendsRequest;
  interest_over_time: {
    timeline_data: Array<{
      date: string;                   // 'Apr 27, 2026'
      timestamp: string;              // unix
      values: Array<{ query: string; value: string; extracted_value: number }>;
    }>;
    averages: Array<{ query: string; value: number }>;
  };
}
```

### Option D: DataForSEO Google Trends (cheapest paid)

- **Docs:** https://docs.dataforseo.com/v3/keywords_data-google_trends-overview/
- **Auth:** Basic auth (login + password) over HTTPS.
- **Pricing:**
  - **Standard queue:** $0.00225/task — async, ~45 min turnaround. ~$2.25 per 1,000 keywords.
  - **Live mode:** $0.009/task — synchronous. ~$9 per 1,000 keywords.
  - No monthly minimum; pay-as-you-go.
- **Daily cap:** 500k requests/day shared across all DataForSEO Trends users (not per-account; effectively never hits us).
- **Per request:** Up to 5 keywords.
- **Coverage:** Google Search, News, Images, Shopping, YouTube — same as official Trends.
- **Reliability:** Stable provider; SerpAPI competitor, more SEO-tools-focused.
- **Verdict:** Cheaper than SerpAPI per-query. SerpAPI wins on docs polish and ecosystem; DataForSEO wins on price. For PharmaDash's volume (~30/day = 900/mo) DataForSEO Live = ~$8/mo vs SerpAPI's $75/mo flat. Worth considering as the actual choice if we go paid.

### Option E: Brave Search API — NOT a Trends substitute

- **Pricing:** $5/1k requests, $5/mo free credit, 50 req/sec.
- **Endpoints:** Web Search, News Search, LLM Context, Video, Image, Place, Spellcheck, Autocomplete.
- **No "trending searches" or interest-over-time endpoint.** Brave's News endpoint can give "what's being searched now" *qualitatively* via headline volume, but it's not the same signal as Trends interest-over-time.
- **Verdict:** Skip for the Research Analyst's Trends slot. Could be useful elsewhere (news monitoring for FDA/recall/regulatory) but that's a different use case.

### Cred-missing fallback for Google Trends
Same fixture pattern as openFDA: `tmp/fixtures/google-trends.sample.json` with the SerpAPI/DataForSEO timeseries shape. When `GOOGLE_TRENDS_PROVIDER` env is unset OR the live call fails, return fixture data with a `source: 'fixture'` flag so downstream agents can flag the briefing accordingly.

---

## 5. Recommended Implementation for Wave 3

### Wave 3 scope (FDA only)
1. **Schema:** add tables `data.fda_shortages` (snapshot, refreshed daily) and `data.fda_recalls` (append-only, last 365 days kept). Both keyed off `product_ndc` and `generic_name` for joins.
2. **Cron:** new Render cron `pharm1-fda-sync`, schedule `0 12 * * *` (12:00 UTC, after Amazon's overnight pricing settles), small node script that:
   - Pulls all `status:"Currently in Shortage"+AND+openfda.product_type:"HUMAN OTC DRUG"` records.
   - Pulls last-7-days enforcement records with `product_type:"Drugs"`.
   - Upserts both into Supabase.
   - On 5xx, no-ops (yesterday's snapshot still valid).
3. **Research Analyst skill prompt:** add tool `query_fda_signals(generic_name | ndc)` returning `{ active_shortage: bool, recent_recalls: RecallRecord[] }`. Two-phase scoring:
   - Veto: any Class I active recall on this NDC → don't propose.
   - Boost: active shortage on this generic → +N to opportunity score.
4. **Fixture path:** `OPENFDA_USE_FIXTURE=true` env triggers fixture-only mode for dev / outage drills.
5. **No API key in Phase 2 Wave 3.** 1 cron tick/day + ~30 query_fda_signals calls/day = ~31 req/day, well under the 1k/day keyless ceiling. Add key in Phase 3 if traffic grows.

### Phase 2.5 / Wave 4 (Google Trends)
Defer. When picked up:
- Default to **DataForSEO Live mode** ($0.009/q) for budget reasons. ~$8/mo at our volume.
- Single TS client in `lib/datasources/google-trends-client.ts` with provider abstraction so we can swap to SerpAPI without skill-prompt changes.
- Cache responses 24h in `data.trends_snapshots` table — Trends is slow-moving for our use case.
- Trends signal feeds the Research Analyst as a secondary score (multiplicative boost on shortage-signal candidates that are *also* trending up). If isolated (Trends up but no shortage), softer score — Trends without supply scarcity is just demand without arbitrage edge.

---

## 6. Sources

- openFDA Drug Shortage docs: https://open.fda.gov/apis/drug/shortages/
- openFDA Drug Enforcement (Recall) docs: https://open.fda.gov/apis/drug/enforcement/
- openFDA Drug Enforcement searchable fields: https://open.fda.gov/apis/drug/enforcement/searchable-fields/
- openFDA Drug Application (drugsfda) docs: https://open.fda.gov/apis/drug/drugsfda/
- openFDA Authentication / rate limits: https://open.fda.gov/apis/authentication/
- openFDA Query syntax: https://open.fda.gov/apis/query-syntax/
- pytrends repo (archived): https://github.com/GeneralMills/pytrends
- pytrends-async fork: https://pypi.org/project/pytrends-async/
- pytrends 429 issue threads: https://github.com/GeneralMills/pytrends/issues/243, #535, #561, #602, #625, #631, #492
- SerpAPI Google Trends docs: https://serpapi.com/google-trends-api
- SerpAPI pricing: https://serpapi.com/pricing
- DataForSEO Google Trends overview: https://docs.dataforseo.com/v3/keywords_data-google_trends-overview/
- DataForSEO Trends API page: https://dataforseo.com/apis/google-trends-api
- DataForSEO pricing: https://dataforseo.com/pricing/keywords-data/google-trends
- ScrapingBee Best Trends APIs 2026 comparison: https://www.scrapingbee.com/blog/best-google-trends-api/
- Brave Search API pricing: https://api-dashboard.search.brave.com/documentation/pricing
- Brave Search API overview: https://brave.com/search/api/

