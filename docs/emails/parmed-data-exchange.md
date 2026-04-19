# Email Draft — Parmed Data Exchange Request

**To:** Kaleem's Parmed sales rep
**From:** Kaleem
**Status:** Draft — fill in `[bracketed]` fields and review before sending

> Background: Parmed is owned by Cencora (AmerisourceBergen's parent), so there's a decent chance this is handled by the **same rep or team** that handles his ABC account. Before sending this separately, he should ask his ABC rep: "can the same data integration also cover Parmed, or is it a separate request?" If separate, send this. If covered, skip.

---

**Subject:** Parmed EDI Feed Routing Request — 832 / 846 to Additional SFTP + Integration Questions

Hi [Rep Name],

I'd like to connect with your data integration team at Parmed to set up expanded reporting on my end. Specifically:

### Core request

Route these EDI feeds to an **additional** SFTP endpoint I'll provide (in addition to whatever destination Parmed currently feeds):

- **832** — Price/Sales Catalog
- **846** — Inventory Inquiry / Advice
- **856** — Advance Ship Notice
- **810** — Invoice

### Questions for the data team

1. **Feed cadence** on the 846 — daily? more frequent? Higher tiers available?

2. **Anticipated availability dates** — included in the 846 feed, or available as a supplemental file?

3. **Product master** — Can I receive the complete catalog of SKUs eligible on my account (NDC, UPC, descriptions, pack sizes, images, substitution mappings)?

4. **Contract pricing** — Does the 832 feed reflect my contracted rates, not list prices?

5. **Historical data export** — Last 12–24 months of my price / inventory / order history as a one-time dump?

6. **Programmatic ordering** — Can I place POs via EDI 850? Typical 855 acknowledgment latency? Backorder-substitution logic?

7. **Real-time stock API or webhook** — Anything beyond the daily 846 for time-sensitive stock checks?

8. **Blind shipping confirmation in writing** — Please confirm that Parmed blind-ships to my customers (no Parmed branding on carton, packing slip, or invoice) for orders I place. Required for my Amazon Seller Central documentation.

9. **Cencora consolidation** — Since Parmed is Cencora-owned, is my Parmed data integration handled by the same team as my ABC account, or are they separate? If separate, what's the escalation path when I have cross-wholesaler questions?

### Account info
- **Account name:** [Pharmacy legal name]
- **Account #:** [Parmed account number]
- **Primary location:** [Address]
- **Contact:** [Phone] · [Email]

Thanks,

Kaleem
[Pharmacy name]
[Phone]
[Email]
