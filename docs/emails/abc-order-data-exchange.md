# Email Draft — ABC Order Data Exchange Request

**To:** Kaleem's ABC Order sales rep (he has the contact)
**From:** Kaleem
**Status:** Draft — fill in `[bracketed]` fields and review before sending

> Background for Kaleem: ABC's data exchange runs on EDI X12 over SFTP/AS2 (Axway B2Bi is their platform). The $50/month interface fee you already pay covers a daily price catalog + inventory file drop into Pioneer. We're asking them to route the same feeds to a second SFTP endpoint we control — same data, additional destination. We're also asking them to confirm in writing that they blind-ship (no ABC branding on customer packages) for your account.

---

**Subject:** Data Exchange Request — Route 832 / 846 Catalog & Inventory Feeds to Additional SFTP Endpoint

Hi [Rep Name],

Hope you're well.

I'd like to get connected with your data exchange / EDI team. We currently receive the daily price catalog and inventory file drop into Pioneer (which the monthly interface fee covers). I'd like to route the same EDI feeds — specifically:

- **832** — Price/Sales Catalog
- **846** — Inventory Inquiry / Advice

…to an **additional** SFTP endpoint we'll provide. This is *in addition to* the existing Pioneer feed, not a replacement — we want the same data delivered to a second destination.

A few additional questions for the data team while we're at it:

1. **Anticipated availability dates.** When a SKU is on backorder in ABC Order, the portal shows an "anticipated date." Is that field included in the 846 feed, or is it available through any other data product / supplemental file?

2. **Update frequency.** What's the cadence of the 846 inventory feed today — daily, hourly, sub-hourly? Are higher-frequency tiers available?

3. **Blind shipping confirmation.** Could I get a brief written confirmation (email is fine) that ABC continues to blind-ship to my customers — i.e., no ABC / AmerisourceBergen / Cencora branding on the packing slip, invoice, or carton — for orders I place via ABC Order? This is needed for my Amazon Seller Central documentation.

Pharmacy account info:
- **Account name:** [Pharmacy legal name]
- **DEA / account #:** [account number on file]
- **Primary location:** [Address]
- **Contact:** [Phone] · [Email]

If easier, happy to take a 15-minute call. Thanks for the help —

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
