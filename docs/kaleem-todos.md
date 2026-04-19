# Things to Do With Kaleem

Running list of questions to ask Kaleem, things for him to do, and items to bring up at our next meeting.

**Last updated:** 2026-04-18
**Next meeting:** ~1 day from now (in-person)
**Sunday meeting:** confirmed for process / payment / workflows

---

## Critical — for tomorrow's meeting

### 0. Tell Kaleem about the Dec 2025 supplement TIC requirement (he probably hasn't heard)

**What changed:** As of December 2025, Amazon expanded its testing/inspection/certification requirement to **ALL dietary supplements** (it was previously limited to 3 sub-categories since April 2024). Every supplement listed on Amazon now requires a Certificate of Analysis from an ISO 17025-accredited lab, verified by **NSF, Eurofins, or UL Solutions**, renewed annually.

**Why it matters:** Some of his current and planned listings may be at risk of suppression if the brands don't have current TIC verification. Bigger national brands (Nature Made/Pharmavite, NOW Foods, Pure Encapsulations) likely already comply; smaller / private-label brands often don't.

**Ask:** "Of the supplements you currently sell on Amazon (and the ones in your top sellers), which brands do you stock most? We'll spot-check TIC coverage and only recommend SKUs that pass."

**Also:** for the future halal/kosher private-label vitamin line — TIC certification is now table-stakes for Amazon listing. Need to budget for NSF or Eurofins testing as part of the supplier-selection criteria.

[Source — NutraIngredients Dec 2025](https://www.nutraingredients.com/Article/2025/12/22/amazon-expands-tic-cgmp-requirement-to-all-supplement-products/)

### 1. Confirm blind-ship in writing from ABC (and any other wholesaler used for Amazon)
**Why it matters:** Amazon dropship policy requires Kaleem to be the seller of record on every package. Wholesaler shipments must show his pharmacy branding (not ABC / AmerisourceBergen / Cencora / McKesson / Cardinal / Parmed). Violations = account suspension risk during audit.

**What we know:** Kaleem confirmed ABC doesn't put their branding on his shipments today (good). But there's no written policy doc on file.

**Ask:** "Get a one-paragraph confirmation in writing (email is fine) from each wholesaler you use for Amazon orders, stating that they blind-ship for your account. Just for the audit trail. Same email can mention this — see ABC email draft."

### 2. Forward the ABC Order data-exchange email to his rep
Drafted at `docs/emails/abc-order-data-exchange.md`. Kaleem just needs to fill in the rep's name / his account number, then send. The data team will route the EDI 832 (price catalog) + 846 (inventory) feeds he's already paying for to an SFTP endpoint we control.

### 3. Sign NDA before sharing logins
Mentioned earlier ("once we sign the non-disclosure, I'll give you logins and passwords"). Need to draft and execute Sunday at the latest. Without this, no supplier credentials, no Amazon Seller credentials, no Pioneer access.

### 4. Brand authorization wedge — which brands does he sell most?

**Why:** Pfizer, J&J's OTC portfolio, Pharmavite (Nature Made), Pure Encapsulations, Garden of Life, Nestlé brands actively pursue unauthorized resellers on Amazon **even with valid wholesaler invoices**. Being a McKesson customer ≠ being an Amazon authorized reseller. His Amazon account could get hit with IP complaints from these brands.

**Ask:** "What are the top 20-30 brands you currently sell on Amazon, and which ones do you plan to add? We'll classify each as safe-to-resell / needs-LOA / brand-actively-hunts and adjust recommendations accordingly. We may need to ask some manufacturers for Letters of Authorization."

### 5. Expired stock — what's the lot/expiration tracking situation today?

**Why:** Amazon's #1 supplement suspension trigger is expired product complaints — even one photo can deactivate an ASIN. Pattern complaints suspend the whole account. **Min 9-12 months remaining shelf life required at dispatch.**

**Ask:**
- "How do you currently track expiration dates on the OTC inventory you ship via Amazon?"
- "Does ABC's invoice/packing slip include lot numbers and expiration dates?"
- "Have you ever had an expired-product complaint on Amazon?"

We'll parse expiration from the EDI feed and auto-suppress any SKU below 9 months.

### 6. Wholesaler invoice scrutiny prep

**Why:** McKesson, ABC, Cardinal, Parmed are NOT on Amazon's pre-recognized wholesaler list (KeHE, UNFI, Vistar are). Ungating invoices will face extra scrutiny — expect rejections.

**Ask:** "When we go through Amazon ungating, expect 1-3 invoice rejections before approval. We'll have a templated escalation response ready. Make sure invoices have business name, phone, email, address, are dated within 180 days, and show the exact pharmacy legal entity name (matching Seller Central)."

### 7. EzriRx membership status
**EzriRx** (the marketplace Kaleem mentioned as "Esri RX") is the foundation of our integration plan. It already aggregates 30+ wholesalers and exposes a public EDI spec. **One integration = multi-source pricing + stock + ordering.** Massive shortcut.

**Ask:** "Are you already a member of EzriRx? If yes, we want to start EDI onboarding immediately. If no, sign up this week."

---

## Information needed — questions to ask

### Pharmacy footprint
- How many pharmacy locations? (We know St. Mark's + Redwood Rd.)
- Same supplier accounts at both, or separate?
- Should the app treat them as one tenant or two?
- Will Amazon listings be pooled or separated by location?

### Current Amazon Seller account
- Account age?
- Current Order Defect Rate, Late Shipment Rate, Cancellation Rate, Valid Tracking Rate?
- Total active SKUs? (He mentioned "30 or 20" set up by a technician.)
- Any past suspensions, warnings, or A-to-z claims?
- FBM only, or any FBA history?
- Brand registry / approved categories status?

### eBay account
- Top Rated Seller status?
- Active listings count?
- Any policy violations?

### Notification preferences
When a sale comes in or an opportunity surfaces, what channel does Kaleem actually want?
- Text (SMS via Twilio)?
- Email?
- Native browser/desktop push?
- Daily digest only?
- All of the above with different urgency levels?

He's at the counter all day. The dashboard alone won't catch his attention — we need push.

### Pricing rule preferences
- Minimum margin floor (e.g. never list below cost +25%)?
- Maximum scarcity premium (cap at 3x cost, or trust the model)?
- Approve every recommendation manually, or auto-list within rules?

**Default:** "approve every one" until trust is built. Calibrate over weeks.

### Customer service / returns
- For Amazon orders, who handles returns, refunds, and customer questions? Kaleem himself or staff?
- Affects whether app needs a "messages" surface in v1 or v2.

### Existing tools
- Is he using Helium 10, Jungle Scout, Keepa, or any other arbitrage tool today?
- Repricer software?
- Listing software (e.g. SellerCloud, Sellbrite)?

If yes, we can pull historical data from them and not start from scratch.

---

## Things Kaleem will do (after Sunday meeting / NDA)

- [ ] Share login credentials for ABC, Parmed, McKesson, Cardinal, IPC (whichever he uses)
- [ ] Share Amazon Seller Central credentials (or grant team-member access via Manage Your Permissions)
- [ ] Share eBay seller credentials (or grant authorized-user access)
- [ ] Forward the ABC data-exchange email
- [ ] Send similar emails to his McKesson and Cardinal reps (templates to follow once ABC pattern is proven)
- [ ] Sign up for EzriRx if not already a member
- [ ] Provide blind-ship confirmation emails from each wholesaler

---

## Things to discuss at Sunday meeting

### Decisions to confirm
- Product Manager / Opportunity Feed = home Dashboard ✅
- Listing on existing ASINs only (not creating new product pages) ✅
- Inventory tab = wholesaler stock view (multi-source) ✅
- **Phase 1 scope:** Amazon-first, OTC-only, EzriRx-foundation, FBM-only (no FBA)
- **Phase 2 scope:** marketing / TikTok / private-label vitamins
- **Research / drug design:** separate stream, separate funding (grants)

### Process / workflow
- Working cadence — Sunday meetings going forward?
- How to test new features with him in the loop (he's interrupted constantly at the counter)
- "Live" definition — when do we point at his real Amazon account vs sandbox?

### Payment structure
- Confirm "no problem paying right now" ramp
- Per-month retainer? Milestone-based? Equity?
- Pharmacy/Amazon/marketing funded from those revenues; research funded separately (grants)
- Treat Dev + Nick as one billable unit (yin/yang)

### Forward-looking tracks
- **Halal/kosher private-label vitamins** — Vitamin D + multivitamin, MOQ 500-1000, Utah / Nevada / Colorado supplier with 5+ years history. Apollo CRM outreach.
- **TikTok store + AI video gen** — Thursday meeting topic. UGC reference-video method.
- **Drug design / compound isolation** — Laurendide ethanol, Strombolophilin 8, derivative generation. Patent for non-cancer use. May/June structure work.

---

## Open questions for us (not for Kaleem)

These are for us to figure out:

- **Hosting:** Render web service for the dashboard + Mac mini for compute jobs? Or all-in on cloud?
- **Database:** Postgres on Supabase? Self-hosted? Local SQL on his Mac mini for any sensitive data?
- **Auth:** Just Kaleem + a few staff for v1.
- **Multi-pharmacy data model from day 1**, even if single-tenant for now — easier than retrofitting.
- **Amazon SP-API gating timeline** — start the H&PC ungating paperwork *immediately* (1-4 weeks). Runs in parallel with build.
- **Keepa subscription** — pay for it ourselves to start (~$54/mo), bill back to Kaleem once value is proven.
- **EzriRx pricing tier** — confirm during onboarding.
