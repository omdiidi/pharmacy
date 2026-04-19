# Email Draft — ABC Order Data Exchange Request

**To:** Kaleem's ABC Order sales rep (he has the contact)
**From:** Kaleem
**Status:** Draft — fill in `[bracketed]` fields and review before sending

> Background for Kaleem: ABC's data exchange runs on EDI X12 over SFTP/AS2 (Axway B2Bi is their platform). The $50/month interface fee you already pay covers a daily price catalog + inventory file drop into Pioneer. We're asking them to route the same feeds to a second SFTP endpoint we control — same data, additional destination. We're also asking them to confirm in writing that they blind-ship (no ABC branding on customer packages) for your account.

---

**Subject:** Data Exchange Request — Route 832 / 846 Catalog & Inventory Feeds + Expanded Integration Questions

Hi [Rep Name],

Hope you're well.

I'd like to get connected with your data exchange / EDI team to set up an expanded integration on my end. We currently receive the daily price catalog and inventory file drop into Pioneer (which the monthly interface fee covers). I'd like the same feeds routed to an additional destination, plus a few other data needs for automated reporting I'm building.

### Core request

Route these EDI feeds to an **additional** SFTP endpoint I'll provide (in addition to the existing Pioneer feed, not a replacement — same data, additional destination):

- **832** — Price/Sales Catalog
- **846** — Inventory Inquiry / Advice
- **856** — Advance Ship Notice (for shipment tracking)
- **810** — Invoice (for billing reconciliation)

### Questions for the data team

1. **Feed cadence** — What's the refresh frequency of the 846 inventory feed today? Daily, hourly, sub-hourly? Are higher-frequency tiers available for my account?

2. **Anticipated availability dates** — When a SKU is on backorder in ABC Order, the portal shows an anticipated restock date. Is that field included in the 846 feed, or available through a supplemental file / data product?

3. **Product master data** — Can I receive a complete catalog of the SKUs I'm eligible to order, including NDC, UPC, descriptions, pack sizes, images, and any substitution/equivalent SKU mappings? Either as a one-time export or an ongoing 832 extension.

4. **Contract pricing** — I have negotiated rates on my account. Can you confirm the 832 feed reflects my contracted prices (not list prices)?

5. **Historical data export** — Can you provide the last 12–24 months of my price + inventory + order history as a one-time dump? Useful baseline rather than waiting to accumulate from today forward.

6. **Programmatic ordering (850 / 855)** — Can I place purchase orders via EDI 850 from my system, with 855 acknowledgments coming back? If so, what's the typical 855 response latency? And what's the backorder-substitution logic if a SKU is out at fulfillment time?

7. **Real-time stock API or webhook** — Beyond the daily 846 feed, does ABC offer any real-time stock-check endpoint (REST API, webhook, or otherwise) for high-volume accounts? Especially useful for time-sensitive Amazon dropship orders.

8. **Blind shipping confirmation in writing** — Please confirm in writing (email is fine) that ABC continues to blind-ship to my customers — no ABC / AmerisourceBergen / Cencora branding on the packing slip, invoice, or carton — for orders I place via ABC Order. This is required documentation for my Amazon Seller Central account. If this is scope-limited (e.g., only specific account types), please note the scope.

9. **Parmed** — Since Parmed is also Cencora, can the same data integration cover my Parmed account, or do I need a separate request to the Parmed team?

10. **Onboarding / paperwork** — Any trading-partner agreement or onboarding docs needed to add the second SFTP destination?

### Pharmacy account info

- **Account name:** [Pharmacy legal name]
- **DEA / account #:** [account number on file]
- **Primary location:** [Address]
- **Contact:** [Phone] · [Email]

Happy to take a 15–30 minute call with the data team if that's easier. I have more detailed technical questions but wanted to start with the above. Thanks for the help —

Kaleem
[Pharmacy name]
[Phone]
[Email]

---

## Same-pattern emails to draft after ABC

Once ABC confirms the path, send equivalents to:

- **McKesson** — McKesson E-Commerce Services / Third Party Interfaces team. Same ask: 832 + 846 to our SFTP, anticipated availability data, blind-ship confirmation.
- **Cardinal Health** — Order Express / Supply Chain Center team. Same ask.
- **Parmed** — likely same EDI infrastructure as ABC (Cencora-owned). Probably handled by the same ABC rep.
- **IPC** — `member.services@ipcrx.com` or `1-800-755-1531`. They have an EDI integration (TrueCommerce-compatible).

## Parallel track: EzriRx

Sign up at https://www.ezrirx.com if not already a member, then request EDI onboarding via https://edi.ezrirx.com. EzriRx aggregates 30+ wholesalers in one integration — fastest path to multi-source pricing and stock. Direct ABC EDI is the slower / better-margin upgrade we run in parallel.
