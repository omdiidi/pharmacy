# Wholesaler Data-Team Questions — Full Catalog

Every question we'd want a wholesaler's data integration team to answer. The expanded emails (ABC / Parmed) front-load the highest-priority 8–10; this doc is the complete list for follow-up calls or for Kaleem to hand the rep as a cheat sheet.

Organized by topic. Apply to ABC, Parmed, McKesson, Cardinal, IPC, or any direct wholesaler connection.

---

## 1. EDI feed basics

- Which EDI transaction sets do you support on customer data integrations? (832 / 846 / 850 / 855 / 856 / 810 / 997)
- What's the transport? (SFTP / AS2 / VAN)
- What's the file format encoding? (X12 version, character set, delimiters)
- What's the daily cutoff / cadence for each feed?
- Can we get higher-frequency 846 inventory pulls for a high-volume account?
- Are there any per-customer extensions to standard X12 we should know about?
- What's the typical file size we should expect per feed per day?

## 2. Routing + multi-destination

- Can 832 / 846 feeds be routed to an additional SFTP endpoint (not a replacement for existing routing)?
- Is there a limit on destinations per account?
- What changes if we add a second destination — any account fees?
- Can we get staging environment access for testing before swapping production routing?

## 3. Inventory semantics

- In the 846, what does "quantity on hand" actually mean? Per-warehouse, aggregated across all warehouses, allocated vs available?
- How are committed / reserved quantities represented?
- Are backorder statuses included in 846, or a separate signal?
- Does 846 include anticipated restock dates for backordered items?
- How reliable are anticipated dates historically? (Our guess: more reliable for planned buys, less reliable for supplier-side disruptions)
- Does "zero stock" in 846 mean discontinued or temporarily out?
- How do we distinguish discontinuation from temporary out-of-stock?
- How do you handle unit of measure variations? (Each / bottle / case)
- Are there SKU-level "ship restrictions" (e.g., hazmat, temperature-controlled, ground-only)?

## 4. Pricing semantics

- In the 832, are prices contract-specific to my account or list/MSRP?
- How are volume breaks / bulk pricing tiers represented?
- Are there promotional / time-limited prices in the feed?
- Are MAP (Minimum Advertised Price) constraints included per SKU?
- How often do prices change in the feed — once daily at a fixed time, or whenever they change?
- Are historical prices available, or only current?
- How are rebates and after-the-fact discounts represented?

## 5. Product master data

- Can we get a full SKU catalog including NDC, UPC, description, pack size, images, manufacturer, category?
- Are equivalent-SKU / substitution mappings available?
- Is product imagery included? If not, licensable?
- What product attributes beyond basics do you expose? (Ingredients, dosage forms, strength, etc.)
- Are "therapeutic equivalence" mappings available?

## 6. Historical data

- Can we get a one-time export of my last 12-24 months of price + inventory data?
- Can we get all my past purchase orders + invoices as a historical dump?
- How far back does your retention go?
- Format options for the export? (EDI, CSV, other)

## 7. Programmatic ordering

- Can I place POs via EDI 850 from my system?
- What's the typical latency for 855 (PO acknowledgment) responses?
- What's the substitution logic if a SKU is out at fulfillment time? (Auto-sub, cancel-line, partial-ship)
- Can I specify "do not substitute" per line?
- Is there a PO status API / query endpoint to check order state between 855 and 856?
- What's the maximum order size per 850 submission?

## 8. Real-time / low-latency options

- Do you offer any REST API or webhook-based stock-check endpoint beyond the batched 846?
- For high-priority accounts, are there lower-latency order placement channels than EDI 850?
- Any streaming / event-based integration options?
- What's the fastest we can know a SKU went out of stock? (For stock-out arbitrage detection)

## 9. Shipping + fulfillment

- **Blind-shipping confirmation in writing** — packing slip, invoice, carton all free of wholesaler branding?
- Blind-shipping scope — all accounts, or only specific account types?
- Can we specify per-order "brand as [pharmacy name]" so outbound shipments look like they came from us?
- Ship-to address restrictions — any states we can't ship into? PO Boxes allowed?
- Hazmat handling — which SKUs require ground-only? Any that can't ship at all to certain regions?
- Carrier options — can we choose carrier per order (UPS vs USPS vs FedEx)?
- Expected ship time — how long after a successful PO before the package leaves the warehouse?
- Tracking — delivered via 856, or a separate feed / portal?

## 10. Returns

- Return request process — EDI transaction supported?
- Typical return approval timeframe?
- Restocking fees?
- Damaged / defective product RMA flow?

## 11. Compliance + documentation

- Which regulated categories are on my account? (Supplements, Rx, OTC specifics)
- For supplements specifically — do you provide documentation supporting Amazon's Dec 2025 TIC requirement (NSF / Eurofins / UL COAs)? Either directly or via the manufacturer?
- FDA recall notifications — how are they sent to customers?
- Do you provide batch / lot / expiration data in feeds?
- Per-SKU minimum shelf life guarantees?
- cGMP compliance documentation on request?

## 12. Account + support

- Sales rep + escalation path when we hit issues?
- Dedicated integration support contact (vs general customer service)?
- Hours of support for integration issues?
- Rate limits / fair-use policies?
- Historical up-time for feeds / ordering systems?

## 13. Contracts + economics

- Interface / integration fee structure — what are we actually paying for with the monthly interface fee?
- Any volume-based discounts on interface fees?
- Are there credits for high-availability issues?
- Are there tiers of integration we don't currently have? (E.g., "Priority data integration," "Enterprise tier")

---

## How to use this doc

1. **Kaleem forwards the email** (ABC / Parmed / etc.) — has ~8–10 priority asks
2. **Data team responds** or schedules a call
3. **Call happens** — pull the relevant sections of this doc as the agenda
4. **Update this doc** with answers + any new questions that surface during the call
5. **Repeat per wholesaler**
