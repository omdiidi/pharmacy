---
date: 2026-04-18
topic: Product Manager / Market Analyzer for OTC Pharmacy Arbitrage Dashboard
tags: [amazon, arbitrage, otc, pharmacy, dropship, market-intel, product-manager, h&pc, supplements]
status: complete
sources_count: 60+
---

# Product Manager Research — Synthesis

Synthesis of 4 parallel research dimensions for the "Product Manager" feature of Kaleem's pharmacy app: opportunity scoring, stock-out detection, demand forecasting, H&PC category constraints, UI/UX patterns.

## Research Question

How should we design and build the **Product Manager** — the market intelligence layer that drives Kaleem's daily decisions on what to list on Amazon (existing ASINs only), at what price, and when, given that he dropships OTC products from his pharmacy wholesalers (ABC, McKesson, Cardinal, Parmed, IPC) using EzriRx as a multi-source aggregator?

## Executive Summary

The Product Manager is built on three signal categories, one policy filter, and one repricer:

- **Signals**: supply (EDI 846 + on-demand portal scrape + FDA Drug Shortage API) × demand (Keepa + SP-API + Google Trends + seasonal index) × margin (multi-source cost comparison via EzriRx).
- **Policy filter**: hard auto-exclude rules applied **before** scoring (DEA / kratom / CBD / disease claims / brand IP risk / missing TIC certification / expiration < 9 months / Amazon-as-dominant-seller).
- **Repricer**: Seller Snap-style game-theory with a hard floor (COGS + Amazon fees + prep + 15% + expiration-date discount) and a Fair Pricing ceiling (~25% above trailing 30-day Buy Box median).

**The defensible edge for an independent pharmacy on Amazon is stock-out arbitrage** — the moments when FBA inventory is exhausted and FBM-only sellers (like Kaleem) can win the Buy Box at a scarcity premium. In all other moments, FBA's trust premium caps FBM sellers below the Buy Box price even when cheapest. Our targeting must privilege FBA-empty or FBM-dominant ASINs above all others.

---

## Critical Constraints (READ FIRST)

These are the constraints that change major assumptions or kill recommendations regardless of margin. They become the **policy filter** in the build.

### 1. Amazon's Dec 2025 supplement TIC requirement (BRAND NEW)

Effective April 2024 for 3 sub-categories, **expanded December 2025 to ALL dietary supplements**. Every supplement on Amazon must now have:

- Certificate of Analysis (COA) from an **ISO 17025-accredited lab**
- Verified by one of: **NSF, Eurofins, or UL Solutions** (the "TIC" labs)
- Tested for label-claim tolerance, heavy metals, pesticides, microbial contamination per NSF/ANSI or USP
- **Renewed every 12 months**

Implication: Before listing **any supplement**, we must verify the brand has current TIC verification. Filters out a huge swath of the supplement universe. Bigger brands (Nature Made / Pharmavite, NOW Foods, Pure Encapsulations) likely covered; smaller / private-label brands often not.

[NutraIngredients — Dec 2025 expansion](https://www.nutraingredients.com/Article/2025/12/22/amazon-expands-tic-cgmp-requirement-to-all-supplement-products/) · [NSF policy explainer](https://www.nsf.org/knowledge-library/amazon-new-dietary-supplements-policy-enhancing-safety-compliance)

### 2. The FBM trust premium reality (and the arbitrage thesis it confirms)

H&PC is **FBA-trust-dominated**. Prime buyers pay a trust premium of ~10-15%. **FBM sellers like Kaleem are effectively capped below the Buy Box price even when cheapest.** [Alpha Repricer](https://alpharepricer.com/blogs/the-trust-premium-in-supplements-why-fba-sellers-can-price-higher-than-fbm-competitors/)

**But this confirms the arbitrage thesis.** When FBA stock is exhausted (the stock-out windows), the trust penalty disappears because there's no FBA competition. **The whole edge of an FBM dropshipper specifically lives in moments when FBA is empty.** Kaleem's Tinactin moment ($7 cost → $51 sold) was textbook: all FBA out, only FBM sellers competing, scarcity premium.

This sharpens our targeting — the recommender should compute a per-ASIN "FBM-competitive score" and de-prioritize anything where FBA is dominant + stocked.

### 3. Wholesaler invoice scrutiny

McKesson, ABC (Cencora), Cardinal, Parmed are **NOT on Amazon's pre-recognized wholesaler list** (KeHE, UNFI, Vistar, Royal Wholesale, Nassau Candy are). Kaleem's ungating invoices will face extra scrutiny — expect rejections. We need a templated escalation response. [Big Brand Wholesale](https://bigbrandwholesale.com/wholesale-101/help-amazon-keeps-rejecting-my-invoices-ungating-help-for-beginners/)

### 4. Brand authorization wedge

Pfizer, J&J's OTC portfolio, Pharmavite (Nature Made), Pure Encapsulations, Garden of Life, Nestlé brands **actively pursue unauthorized resellers** even with valid wholesaler invoices. Being a McKesson customer ≠ being an Amazon authorized reseller. We need a per-brand classification: **safe to resell** / **needs LOA** / **actively hunts**. [SmartScout](https://www.smartscout.com/blog/amazon-brand-approvals-getting-denied)

### 5. Expired product = #1 supplement suspension driver

A single photo of an expired bottle from a customer can trigger ASIN deactivation. Pattern complaints suspend the account. **Minimum 9–12 months remaining shelf life required at dispatch.** ABC's invoices show lot/expiration — we can parse this. [ASA Compliance Group](https://amazonsellersappeal.com/expired-products-complaints/)

### 6. Amazon Fair Pricing Policy ceiling on scarcity premium

Amazon **auto-suppresses listings** at "unexplained price spikes" — practical ceiling **~25% above trailing 30-day Buy Box median**. The Tinactin $7→$51 example would normally trip this; it slipped through because the 30-day median was already elevated by the same scarcity. Our recommender must model a **price corridor**, not "as high as it'll go." [Riverbend Consulting](https://riverbendconsulting.com/blog/amazon-fair-pricing-policy/) · [AMZ Sellers Attorney](https://www.amazonsellers.attorney/blog/amazons-fair-pricing-policy-navigating-price-gouging-suspensions)

### 7. Hard auto-exclude ingredient list

Block these in the recommender regardless of margin:

- Pseudoephedrine, ephedrine, phenylpropanolamine (DEA List I)
- Kratom (any form / extract)
- CBD / hemp-derived cannabidiol
- Lidocaine > 4% patch / > 5% cream
- DEA-scheduled compounds (Schedule I–V)
- Listings making disease claims (cure / treat / heal / prevent disease)

**Tier 2 (extra docs needed):** sexual enhancement, weight management, sports nutrition / bodybuilding (require TIC-verified COA showing no undeclared APIs).

**Tier 3 (raise the floor in H&PC):** ROI ≥ 40% AND net ≥ $5/unit (vs general arbitrage 30% / $3).

[Amazon Seller Central restricted products](https://sellercentral.amazon.com/seller-forums/discussions/t/c4402bf4297b12d20808be693d6a22b9) · [FDA pseudoephedrine rules](https://www.fda.gov/drugs/information-drug-class/legal-requirements-sale-and-purchase-drug-products-containing-pseudoephedrine-ephedrine-and)

---

## Detailed Findings

### 1. Opportunity Scoring + Repricing Tools

All major arbitrage tools keep their exact formulas proprietary, but reverse-engineering reviews + help docs reveal a **consistent signal stack**:

| Signal | Adopt | Notes |
|---|---|---|
| Eligibility / gating flag | ✅ | Binary block (BuyBotPro pattern) |
| IP risk score | ✅ | Crowd-sourced or our own brand DB (IP Alert pattern) |
| ROI after Amazon fees + prep + inbound | ✅ | BuyBotPro-style breakeven |
| BSR + 30/90-day trend | ✅ | Keepa core data |
| Sales velocity blend | ✅ | `0.6 × Keepa drops + 0.4 × JS estimator` (drops alone unreliable above ~50 units/mo, exactly where popular OTC lives) |
| Buy Box ownership % over 90 days | ✅ | Beats spot check |
| Offer count + FBA/FBM split | ✅ | Critical — drives FBM-competitiveness score |
| Predicted future BSR | ✅ | Exponential smoothing on rank history |
| Stock-out / restock estimates | ✅ | Scarcity window detection |
| Review velocity | ✅ | Demand proxy independent of BSR |
| **Hazmat flag** | ✅ | Important for OTC (alcohol-based, aerosols, topicals) |
| **Expiration-date discount** | ✅ | **Unique to pharmacy — no off-the-shelf tool does this. Real differentiator.** |

**Sub-scores by category, do not use:**
- Helium 10 "Success Score" and Jungle Scout "Opportunity Score" — built for **private label launches**, not arbitrage. Their review-count-heavy formulas are wrong for our use case.
- Pure race-to-bottom repricers — destroy OTC margins. Prioritize Buy Box %, not lowest-price win.

**Repricer design for OTC (Seller Snap-style game-theory + hard floors):**
- Cadence: 60-300 seconds is sufficient (OTC is less volatile than electronics)
- Hard floor = `COGS + Amazon fees + prep + shipping + 15% margin + expiration_discount`
- Hard ceiling = `min(target_price, BB_30d_median × 1.25)` (Fair Pricing guardrail)
- Buy Box velocity rule: held > 24h, ratchet up X%
- Game-theory: don't chase obvious unsustainable competitors (Keepa price-history check)

**BSR-to-sales math:** No tool publishes exact category multipliers. Best practice for H&PC is the blended estimator. Top 50 BSR in H&PC ≈ 300-1,000+ units/mo; top 100 in H&H ≈ hundreds/day. [SellerAmp BSR tables](https://sas.selleramp.com/sas/bsr-tables) · [Keepa drop-counting limits — Full-Time FBA](https://www.fulltimefba.com/read-understand-keepa-graphs/)

### 2. Stock-Out Detection + Demand Forecasting

**The three-rule scarcity detector** (build this as the core signal):

1. **Offer count drop ≥ 30% in 7 days** (or ≥ 50% in 14 days) — imminent stock-out window
2. **FBA-to-FBM Buy Box flip** — *the highest-signal leading indicator*. When the Buy Box winner's fulfillment channel switches to FBM, FBA inventory on that ASIN is exhausted. Amazon's algorithm starts deprioritizing within hours. [SentryKit](https://sentrykit.com/blog/amazon-fba-stock-out-alert-detection-prevention/) · [Trellis](https://gotrellis.com/resources/blog/out-of-stock-on-amazon/)
3. **Amazon-as-seller exit** — Keepa's orange bar going white means Amazon itself is out. Third-party pricing power spikes.

**Confirmation signal:**
- BSR worsening *while* prices spike = scarcity is real (units/day crashing because nobody can fulfill at sustainable price). Treat as confirmation, not negative.

**Skip these (overkill for one pharmacist):**
- RestockPro, ManageByStats, SellerLegend (built for multi-million $ FBA brands)
- Custom scraping of Amazon (ToS violation, Keepa already has the data)
- Real-time streaming (hourly polling covers 99% of scarcity windows, which last 1-7 days)

**Demand forecasting — keep it simple:**

Use **monthly seasonal indices** (12 multipliers per ~30-60 product archetypes), not Prophet/ARIMA/LSTM. Comparative studies show seasonal-naive baselines beat ML models on <2 years of per-SKU data.

Archetypes to build seasonal indices for:

| Archetype | Peak | Examples |
|---|---|---|
| Allergy | Mar-May, Sep-Oct | Loratadine, cetirizine, fluticasone |
| Cold/flu immune | Oct-Mar | Vitamin C, elderberry, zinc, NAC, quercetin |
| Vitamin D | Oct-Mar | All vitamin D forms |
| Sunscreen / electrolytes | May-Aug | SPF, oral rehydration |
| Magnesium / melatonin | Year-round, mild winter tilt | All forms |
| Resolution / weight loss | Jan spike | Multivitamin, berberine, fiber |
| Kids immunity | Sep-Mar | Pediatric vitamins, elderberry kids |
| Prenatal | Year-round | Prenatal vitamins |

**Free signals to layer in:**
- **FDA Drug Shortage API** (`open.fda.gov/apis/drug/drugshortages/`) — JSON, no key. When acetaminophen / amoxicillin hit shortage, OTC adjacents (Tylenol, Excedrin) spike within days. **Daily poll + cross-reference with our SKU list = automatic Rx-shortage→OTC-arbitrage signal.** Massive edge.
- **Google Trends** — `≥ 50% week-over-week rise` for tracked ingredients = demand flag. Validated by Springer BMC Global Public Health Granger-causality study on semaglutide → "natural Ozempic" (berberine) supplement pull-through. [Source](https://link.springer.com/article/10.1186/s44263-024-00095-w)
- **Amazon Brand Analytics SQP API** — once brand-registered, free first-party search query data. Best demand signal available. [SP-API Analytics docs](https://developer-docs.amazon.com/sp-api/docs/report-type-values-analytics)

**Historical viral spike magnitudes** (calibration anchors):
- Elderberry: +170% YoY, +415% single week (March 2020)
- Zinc: +255% single week (March 2020)
- Berberine ("natural Ozempic"): 100M+ TikTok views drove Jan-Feb 2024 spike

### 3. H&PC Category Specifics

(Most material moved to "Critical Constraints" above. Additional notes below.)

**Pricing benchmarks for OTC arbitrage:**
- General arbitrage threshold: ≥ 30% ROI, ≥ $3 net profit/unit
- **H&PC specifically: ≥ 40% ROI, ≥ $5 net** (higher floor due to return rate, FBA fees, expiration risk)
- FBM sellers should discount Buy Box odds by ~40% vs FBA in this category

**Counterfeit / commingled inventory risk:**
- Never commingle in H&PC (FBA stickered / FNSKU-labeled only)
- NOW Foods, Fungi Perfecti, Pfizer have publicly flagged Amazon counterfeits
- Some fake supplements tested positive for sildenafil
- Customer "received counterfeit" complaints have higher Account Health weight than non-health categories

**Amazon Transparency Program:**
- Per-unit 2D codes for some brand-enrolled SKUs
- Can't ship without valid codes — auto-block in our recommender if brand is enrolled and we don't have codes

[Nutritional Outlook — supplement counterfeits](https://www.nutritionaloutlook.com/view/amazon-and-counterfeiting-how-widespread-problem-dietary-supplements) · [Amazon Transparency](https://sell.amazon.com/brand-registry/transparency)

### 4. UI/UX + Explainability Patterns

Industry has converged on consistent patterns. Adopt all of these:

**Opportunity feed (the home page) — dense table:**

User-togglable columns. Standard left-to-right order:

```
[checkbox] [thumb + NDC/ASIN + short title] [source price] [Amazon sell price]
[net profit $] [ROI % w/ ↑↓ delta vs 30d] [BSR + 30d sparkline]
[offer count] [est units/mo] [risk pill] [score 0-100] [action button]
```

- **Color coding: green/red against user-set thresholds, NOT hardcoded.** SellerAmp uses just green/red, no yellow. BuyBotPro is the outlier with full red/amber/green — only because their score is composite.
- **Sparklines INSIDE cells** — 40px × 20px, no axes. BSR + price both get sparklines.
- **Rows expand inline** to mini Keepa-style chart (no modal transition for first-pass review).
- **Primary CTA per row:** "Add to Buy List" (watchlist); secondary: "Open briefing".
- **Risk pill:** red triangle + tooltip if any of {IP, hazmat, gated, MAP-restricted, TIC-missing, brand-hunt} fires (IP-Alert pattern).
- **Mobile:** collapse to card view (huge differentiation — most competitors are desktop-only).

**Briefing modal (the SAS-pattern) — three core panels + one unique to us:**

1. **Can we sell it?** — FDA class, NDC status, expiration risk, MAP policy, brand IP flags, DEA schedule. *Any red here = AVOID regardless of profit.*
2. **Does it sell?** — Current + 30/90/180-day BSR, est monthly units, active offers, Buy Box % over 90d, **Buy Box % held by Amazon itself** (kills margin if high), Keepa-style chart with price + BSR + offer count.
3. **Is it profitable?** — Cost breakdown table (COGS, FBA, referral, prep, shipping, returns reserve), net profit $, ROI %, margin %, break-even, **sensitivity row** showing profit at -10%/-5%/current/+5% sell price.
4. **Why this score?** ⭐ *(unique to us)* — Enumerate the 3-5 signals that moved the score most (e.g. "+18 BSR trending down 3mo", "-22 Amazon owns Buy Box 68%"). Counters the universal black-box complaint reviewers hammer on. Tooltip on every metric citing source (Keepa, SP-API, our DB).

**The universal truth from reviews:** *Sophisticated arbitrage sellers open Keepa regardless of what your tool's score says.* They want raw data drill-downs, not abstracted grades. **Build for transparency, not for abstraction.** The "Why this score?" panel + raw chart access is what wins their trust.

**Watchlist convention:** Star icon per row writes to a "Buy List" with price/BSR alerts (Keepa convention) — price drop > X% or BSR improves > Y ranks triggers notification.

[Tactical Arbitrage column-manager](https://tacticalarbitrage.threecolts.support/en/articles/10241078-roi-profit-filters-explained) · [BuyBotPro 7-second analysis](https://www.buybotpro.com/) · [SellerAmp 3-question structure](https://selleramp.com/features/) · [Keepa graphs guide](https://www.fulltimefba.com/read-understand-keepa-graphs/)

---

## Architecture Implications

### Signal stack to build (essentials)

1. **Keepa API poller** for tracked ASINs every 6-12 hours: offer count, BB price, fulfillment channel, Amazon-in-stock flag, BSR, BSR trend, price history
2. **Three-rule scarcity detector**: (a) offer count drop ≥ 30% / 7d, (b) FBA→FBM BB flip, (c) Amazon-out-of-stock flag
3. **Price recommender** capped at 25% above 30d BB median (Fair Pricing guardrail), floor at COGS + fees + 15% + expiration discount
4. **12-month seasonal index** per ~30-60 product archetypes
5. **FDA Drug Shortage API** daily sync, cross-reference with SKU list
6. **EDI 846 parser** (via EzriRx + direct ABC) for back-order + anticipated-date fields
7. **Google Trends weekly pull** for top 30 tracked ingredients (≥ 50% WoW rise = flag)
8. **SP-API `getCompetitiveSummary`** poll for Buy Box / offer changes (free, our seller account)
9. **SP-API Notifications webhook** for order events
10. **Sales velocity blend**: `0.6 × Keepa drops + 0.4 × JS-style estimator`
11. **FDA recall feed** sync, auto-block matched ASINs within 24 hours
12. **Brand authorization DB** (manually curated initially; classify Pfizer / J&J / Pharmavite / etc.)
13. **TIC certification DB** per brand / SKU (manually curated initially)
14. **Lot/expiration parser** from wholesaler invoices

### Policy filter (Tier 1: hard auto-exclude before scoring)

```python
def auto_exclude(sku):
    # Tier 1: regardless of margin
    if sku.contains_ingredient(BLOCKED_INGREDIENTS): return "BLOCKED: ingredient"
    if sku.is_dea_scheduled(): return "BLOCKED: DEA scheduled"
    if sku.has_disease_claim_in_listing(): return "BLOCKED: disease claim"
    if sku.brand in TRANSPARENCY_BRANDS_NO_CODES: return "BLOCKED: Transparency"
    if sku.brand in HUNTS_RESELLERS_BRANDS and not has_loa(sku): return "BLOCKED: brand IP risk"
    if sku.is_supplement and not has_current_tic_cert(sku): return "BLOCKED: TIC missing"
    if sku.shelf_life_days < 270: return "BLOCKED: expiration <9mo"
    if sku.asin in fda_recall_list: return "BLOCKED: FDA recall"
    if sku.amazon_owns_buybox_pct_90d > 0.7: return "SKIP: Amazon dominant"
    return None  # passed Tier 1, proceed to scoring
```

### Recommendation types (the 6 buckets in the feed)

| Type | Trigger | Action |
|---|---|---|
| 🔥 Hot arbitrage | scarcity detector fires + we have stock + FBA empty | List immediately at scarcity premium (capped) |
| 🆕 New / Restock | new SKU in 832 catalog OR repeat winner restocked | List at last-known-good or competitive price |
| 🌷 Seasonal | seasonal index says spike in N weeks | Pre-list 2-4 weeks ahead |
| 📈 Reprice up | BB price moved up OR our stock tightening + market hot | Match BB - $0.01 within ceiling |
| 📉 Reprice down | lost BB to lower competitor (sustainable) | Match within margin floor or suspend |
| ⏸️ Pause | OUR stock-out OR account health risk OR race-to-bottom unsustainable | De-list / suspend |
| 🌀 Watchlist | interesting but not actionable | Daily monitor for changes |

Plus the **special signal types**:
- 🚨 FDA-recall trigger (auto-block)
- 🚨 TIC certification gap (suppress until verified)
- 🚨 Brand-authorization risk (de-prioritize)
- 📊 Rx-shortage adjacency (FDA Drug Shortage cross-ref)

### UI shape

**Home (replaces current Dashboard):**
- Top: tiny KPI strip (today $X, week $Y, open orders Z, alerts N)
- Main: opportunity feed (dense table, filterable by recommendation type)
- Sidebar: pinned watchlist + quick filters

**Briefing modal:** 4-panel SAS pattern + "Why this score?"

**Other tabs:** Products / Orders / Inventory (= wholesaler stock view) / Listings (= per-platform health) / Analytics / CRM. All secondary to the home feed.

### Data sources + monthly cost

| Source | Purpose | Cost (est) | Freshness | Status |
|---|---|---|---|---|
| EzriRx EDI | Multi-wholesaler price + stock + order | TBD (likely $50-200/mo) | Daily | Sign up |
| ABC Direct EDI | Better-margin direct catalog | $0 (already paying GMP fee) | Daily | Email rep |
| Amazon SP-API `getCompetitiveSummary` | BB / offer changes | Free | Real-time poll | Gating in progress |
| Amazon SP-API Notifications | Order events | Free | Push | Gating in progress |
| Keepa API | BSR + price + offer history, sales estimates | $54-500/mo by tier | 6-12h | Subscribe |
| FDA Drug Shortage API | Rx shortages → OTC arbitrage | Free, no key | Daily | Use immediately |
| FDA Recall feed | Auto-block recalled ASINs | Free | Daily | Use immediately |
| Google Trends API | Demand acceleration signal | Free | Weekly | Use immediately |
| eBay Sell APIs | Cross-platform | Free | Real-time | Sign up |
| LLM API (Claude) | Listing copy gen + analysis | ~$200/mo to start | On-demand | Already have |

**Total recurring cost to start: ~$300-500/mo** (Keepa + EzriRx fees + LLM tokens). Bills back to Kaleem once value proven.

---

## Confidence Assessment

| Topic | Confidence | Notes |
|---|---|---|
| Stock-out detection signals (3-rule) | High | Multiple independent sources confirm thresholds |
| Fair Pricing ceiling ~25% above 30d median | High | Multiple legal + seller advocacy sources |
| FBA→FBM BB flip = leading indicator | High | Industry consensus (SentryKit, Trellis) |
| BSR-to-velocity blend math | Medium | Proprietary in tools; blend recommendation is pragmatic |
| Repricer cadence 60-300s for OTC | Medium | Industry common; OTC less volatile than electronics |
| H&PC TIC requirement Dec 2025 | High | NutraIngredients confirmed, NSF policy doc |
| FBM trust premium ~10-15% | High | Multiple sources, well-documented industry pattern |
| Brand authorization risk | High | Industry knowledge; per-brand classification needs build |
| Specific BUY-NOW threshold values (offer count drops, ROI floors) | Low-Medium | Industry rules of thumb; needs real-data calibration with Kaleem's history |
| EzriRx data freshness for stock | Medium | Public docs claim "real-time"; need confirmation in onboarding |
| ABC direct EDI 846 cadence | Low | Need to ask in the rep email |

## Open Questions

1. **EzriRx pricing tier + actual stock data freshness** — confirm in onboarding
2. **ABC EDI 846 cadence** — daily? hourly? Asked in the rep email draft
3. **Per-brand authorization DB** — need to build manually starting from top 50 OTC brands Kaleem touches
4. **Per-supplement TIC certification status** — need to spot-check his top 20 SKUs
5. **Kaleem's blind-ship status across all wholesalers** — confirmed for ABC; need McKesson / Cardinal / Parmed
6. **Account health metrics for his current Amazon Seller account** — must establish baseline before any new listing push
7. **Hazmat handling for OTC topicals / aerosols / alcohol-based products** — does he need hazmat-certified shipping?
8. **TIC certification path for the planned halal/kosher private label** — NSF or Eurofins? Cost? Timeline?

## Sources

### Stock-out + demand forecasting
- [How to Read a Keepa Graph — Seller Assistant](https://www.sellerassistant.app/blog/keepa-amazon/)
- [Keepa Python API on PyPI](https://pypi.org/project/keepa/)
- [Amazon FBA Stock-Out Alert — SentryKit](https://sentrykit.com/blog/amazon-fba-stock-out-alert-detection-prevention/)
- [Out-of-Stock on Amazon — Trellis](https://gotrellis.com/resources/blog/out-of-stock-on-amazon/)
- [Amazon Fair Pricing Policy — Riverbend](https://riverbendconsulting.com/blog/amazon-fair-pricing-policy/)
- [Cold & Flu Supplements Market — Grand View](https://www.grandviewresearch.com/industry-analysis/cold-flu-supplements-market)
- [Seasonality returns to immune support — Nutraingredients](https://www.nutraingredients.com/Article/2023/10/19/Seasonality-returns-to-the-immune-support-category/)
- [Semaglutide Google Trends Granger causality — Springer](https://link.springer.com/article/10.1186/s44263-024-00095-w)
- [openFDA Drug Shortages API](https://open.fda.gov/apis/drug/drugshortages/)
- [EDI 846 — SPS Commerce](https://www.spscommerce.com/edi-document/edi-846-inventory-feed/)
- [Comparative Study Retail Sales Forecasting — ArXiv](https://arxiv.org/pdf/2203.06848)

### Scoring + repricing tools
- [Tactical Arbitrage ROI filters](https://tacticalarbitrage.threecolts.support/en/articles/10241078-roi-profit-filters-explained)
- [BuyBotPro main](https://www.buybotpro.com/)
- [SellerAmp features](https://selleramp.com/features/)
- [SellerAmp BSR tables](https://sas.selleramp.com/sas/bsr-tables)
- [Helium 10 Success Score KB](https://kb.helium10.com/hc/en-us/articles/360050197534-What-is-the-Success-Score-in-Xray)
- [Jungle Scout Sales Estimator](https://www.junglescout.com/estimator/)
- [Keepa pricing](https://revenuegeeks.com/keepa-pricing/)
- [IP-Alert](https://www.ip-alert.com/)
- [Repricer.com velocity rules](https://www.repricer.com/blog/velocity-repricing-rules/)
- [BQool AI rules](https://support.bqool.com/hc/en-us/articles/900005860863-AI-Powered-Win-Buy-Box-Rules)
- [Seller Snap AI](https://sellersnap.io/amazon-ai-algorithmic-repricer/)
- [StreetPricer](https://streetpricer.com/features/)

### H&PC category constraints
- [Amazon H&PC approval — Tinuiti](https://tinuiti.com/blog/amazon/amazon-health-and-personal-care/)
- [Amazon expands TIC to all supplements Dec 2025 — NutraIngredients](https://www.nutraingredients.com/Article/2025/12/22/amazon-expands-tic-cgmp-requirement-to-all-supplement-products/)
- [NSF approved-TIC explainer](https://www.nsf.org/knowledge-library/amazon-new-dietary-supplements-policy-enhancing-safety-compliance)
- [FDA pseudoephedrine rules](https://www.fda.gov/drugs/information-drug-class/legal-requirements-sale-and-purchase-drug-products-containing-pseudoephedrine-ephedrine-and)
- [Amazon kratom prohibition — Super Speciosa](https://superspeciosa.com/blogs/blog/can-you-buy-kratom-from-amazon)
- [Amazon drug-claims policy — Sitruna](https://www.sitruna.com/post/amazons-prohibited-product-claims-for-diseases-and-medical-conditions-what-sellers-need-to-know)
- [Expired-product suspensions — ASA](https://amazonsellersappeal.com/expired-products-complaints/)
- [FBA trust premium in supplements — Alpha Repricer](https://alpharepricer.com/blogs/the-trust-premium-in-supplements-why-fba-sellers-can-price-higher-than-fbm-competitors/)
- [Amazon Transparency Program](https://sell.amazon.com/brand-registry/transparency)
- [Big Brand Wholesale invoice rejection patterns](https://bigbrandwholesale.com/wholesale-101/help-amazon-keeps-rejecting-my-invoices-ungating-help-for-beginners/)
- [Counterfeits in Amazon supplements — Nutritional Outlook](https://www.nutritionaloutlook.com/view/amazon-and-counterfeiting-how-widespread-problem-dietary-supplements)
- [FDA drug recalls feed](https://www.fda.gov/drugs/drug-safety-and-availability/drug-recalls)

### UI/UX + explainability
- [Tactical Arbitrage Always Be Scanning](https://tacticalarbitrage.threecolts.support/en/articles/10240945-always-be-scanning)
- [BuyBotPro Review — WebRetailer](https://www.webretailer.com/reviews/buybotpro/)
- [RevSeller overlay walkthrough — goaura](https://goaura.com/blog/revseller-extension)
- [Keepa Chart 2026 Update — cleartheshelf](https://cleartheshelf.com/how-to-read-a-keepa-chart/amp/)
- [SellerAmp green/red color FAQ](https://selleramp.com/faq-items/i-dont-understand-what-the-red-color-in-the-profit-and-max-cost-means/)
- [Jungle Scout Opportunity Finder Guide — Project FBA](https://projectfba.com/jungle-scout-opportunity-finder/)
- [IP-Alert by Seller Assistant](https://www.sellerassistant.app/products/ip-alert-extension/)
- [FBA Product Validation — Why Tools Fail](https://freebirdsacademy.com/post/amazon-product-validation-why-tools-fail-and-how-to-verify-demand)
