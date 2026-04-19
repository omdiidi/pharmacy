# Email Draft — Cardinal Health Data Exchange Request

**To:** Kaleem's Cardinal Health sales rep (if he has an account)
**From:** Kaleem
**Status:** Draft — fill in `[bracketed]` fields and review before sending

> Background: Cardinal Health's ordering platform is called **Order Express**. Integration happens via EDI X12 (standard 832/846/850/855/856/810). They have an "Automated Purchase Order Import" program that's free to customers and pushes PMS orders into Order Express. For our read-only data needs (prices + inventory), we want the 832 + 846 feeds routed to our SFTP.

---

**Subject:** Supply Chain Data Integration — 832 / 846 EDI Routing to Additional SFTP

Hi [Rep Name],

Hope you're well.

I'd like to connect with your Supply Chain Center / Data Integration team at Cardinal. I'm setting up automated inventory and pricing reporting for my pharmacy and need to route the standard EDI feeds — specifically:

- **832** — Price/Sales Catalog
- **846** — Inventory Inquiry / Advice

…to an **additional** SFTP endpoint we'll provide. This is *in addition to* any existing feeds going to my pharmacy management software today.

A few questions for the team:

1. **Feed cadence** — typical update frequency for the 846? Higher-frequency options?

2. **Anticipated availability** — when an item is on backorder in Order Express, is the anticipated restock date included in the 846 feed?

3. **Blind shipping confirmation in writing** — please confirm that Cardinal blind-ships to my customers for orders placed through Order Express (no Cardinal branding on packing slip, invoice, or carton). This is required for my Amazon Seller Central documentation.

4. **Onboarding** — any trading-partner agreement or paperwork required to add a second SFTP destination?

Account info:
- **Account name:** [Pharmacy legal name]
- **Account #:** [Cardinal account number]
- **Primary location:** [Address]
- **Contact:** [Phone] · [Email]

Happy to jump on a short call. Thanks,

Kaleem
[Pharmacy name]
[Phone]
[Email]
