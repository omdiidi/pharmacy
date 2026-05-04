# Research Dossier: EzriRx Integration + SMS Provider Selection

> **Date:** 2026-05-04
> **Author:** Researcher agent (web + doc synthesis)
> **For:** Phase 2 Wave 2 (Account Health SMS) and Wave 3 (Fulfillment Ops / EzriRx)
> **Status:** Pre-implementation research. No code written.

## TL;DR

- **EzriRx is a real EDI partner**, not a non-starter. They publish a thin EDI portal at `edi.ezrirx.com` documenting 5 transactions (810/832/850/855/856) over **SFTP and AS2**. **No public REST API.** No 846 (inventory inquiry) — stock checks happen via 832 catalog refreshes, not real-time queries. Onboarding requires emailing `edi@ezrirx.com`; technical specs (qualifier IDs, ISA/GS sender/receiver, AS2 cert exchange, sample message shapes) are gated behind that intake.
- **Realistic Phase 2 path:** Kaleem's existing EzriRx pharmacy account + EDI onboarding email. Treat EzriRx as the primary integration; ABC direct EDI is the parallel-track fallback (Kaleem's existing ABC account, ABC publishes their own 856 spec as PDF). McKesson Connect and Cardinal Health both gate API access behind business-development conversations — same friction as EzriRx, no upside.
- **EDI parsing in TypeScript: use `node-x12`.** Actively maintained, X12-specific, supports parsing + generation + path-based query. `edi-parser` is abandoned (last published 9 years ago). `@bizzhive/edi-parser` does not exist on npm. Custom parser is overkill for our 5 transaction types.
- **SMS provider: Twilio.** Resend has **no SMS support** as of May 2026 — confirmed by competitor comparison and absence from Resend docs. AWS SNS is cheaper per-message ($0.00645 vs $0.0083) but requires AWS account setup + still needs 10DLC registration. For one Kaleem phone number receiving ~1–10 alerts/day, Twilio's friction is lower (single signup, mature TS SDK, console for debugging), and the cost difference is meaningless (~$0.02/mo at our volume). **10DLC registration is mandatory** for application-to-person US SMS as of late 2023; budget the $4.50–$46 brand fee + $15 campaign vetting + ~$2/mo campaign recurring.
- **Recommendation:** Start with `npm i twilio` + sole-proprietor 10DLC registration. Resend stays the email provider. SMS is a separate vendor.

---

## Part 1: EzriRx

### 1.1 What's public

EzriRx maintains an EDI documentation site at **`edi.ezrirx.com`**. It is intentionally minimal — a marketing-style summary of supported transactions, not a developer reference. Transport methods are documented at the high level (SFTP, AS2). All technical specifications (sender/receiver qualifier IDs, ISA segment values, AS2 station IDs, sample EDI envelopes, error-handling conventions, file-naming conventions on the SFTP drop, retry semantics) are not on the public site. They route everything through `edi@ezrirx.com`.

The third-party EDI integrator **TrueCommerce** lists EzriRx as a supported trading partner ([truecommerce.com/trading-partner/ezrirx](https://www.truecommerce.com/trading-partner/ezrirx/)) and adds two transactions to the EzriRx-published list: **820 (Payment Order/Remittance Advice)** and **860 (Purchase Order Change Request)**. Whether EzriRx exposes these to all partners or only via TrueCommerce's hub is unclear; the EzriRx-direct portal does not advertise them.

### 1.2 Supported transactions (confirmed)

| EDI | Name | Direction | EzriRx-direct | Via TrueCommerce hub |
|-----|---------------------------------|--------------------|---------------|----------------------|
| 810 | Invoice                         | wholesaler → us    | yes           | yes                  |
| 820 | Payment Order/Remittance Advice | us → wholesaler    | not advertised| yes                  |
| 832 | Price/Sales Catalog             | wholesaler → us    | yes           | yes                  |
| 850 | Purchase Order                  | us → wholesaler    | yes           | yes                  |
| 855 | PO Acknowledgment               | wholesaler → us    | yes           | yes                  |
| 856 | Advance Ship Notice             | wholesaler → us    | yes           | yes                  |
| 860 | PO Change Request               | us → wholesaler    | not advertised| yes                  |
| 846 | Inventory Inquiry/Advice        | **NOT SUPPORTED**  | no            | no                   |

The **846 gap is the load-bearing finding.** Real-time inventory queries are not part of the EzriRx EDI surface. Stock levels are inferred from 832 catalog refreshes (whatever cadence the wholesaler pushes — typically nightly or sub-daily) and from 855 acknowledgments after a 850 is sent. This means the Fulfillment Ops agent's "real-time cross-source comparison" must be reframed: it is "most-recent-832 cross-source comparison" with timestamps. For genuinely real-time stock, the only path is the wholesaler portal scrape (out of scope) or each wholesaler's own API (each one bespoke). EzriRx's web UI itself shows real-time stock by scraping wholesaler portals server-side, but that is not exposed via EDI.

### 1.3 Transport options

- **SFTP** — primary. Both directions push files to a drop directory; partners poll. Standard for pharma wholesalers.
- **AS2** — supported. AS2 needs station IDs + X.509 cert exchange. Heavier setup; useful only if we need real-time push semantics (we don't, for Phase 2).
- **REST** — none publicly. EzriRx has not announced or documented a REST API.

For Phase 2, **plan on SFTP**. Render gives us either Render Pro static egress IP (Pro plan, $19/mo team minimum) or a small dedicated proxy (Fly.io reserved IPv4 ~$2/mo). Decision deferred until we know whether EzriRx requires source-IP allowlisting — ask them in the intake email.

### 1.4 Realistic transaction shapes

X12 EDI is segment-based ASCII with element separators (`*`), segment terminators (`~`), and component separators (`:`). Every interchange wraps in `ISA*...~GS*...~ST*...~...~SE*...~GE*...~IEA*...~`.

**832 Price/Sales Catalog (wholesaler → us):**

```
ISA*00*          *00*          *ZZ*EZRIRX         *ZZ*PHARMxxxxxxx   *260504*0830*U*00401*000000123*0*P*>~
GS*SC*EZRIRX*PHARM*20260504*0830*123*X*004010~
ST*832*0001~
BCT*CC*CAT-2026-05-04*1*  *20260504*Daily Catalog~
LIN**N4*00904679661~
PID*F****Tinactin Cream 1%~
PO4*1*15*GR~
CTP**RTL*7.42*15*EA~
CTP**WHL*4.85*15*EA~
SE*8*0001~
GE*1*123~
IEA*1*000000123~
```

Real-world quirks:
- **NDC11 in `LIN` N4 qualifier** — pharmaceutical-specific. Not UPC. Format: 5-4-2 with leading zeros (`00904-6796-61`).
- Multiple `CTP` (composite price) per item: retail (`RTL`), wholesale (`WHL`), suggested (`SUG`). EzriRx may strip or preserve depending on wholesaler.
- `PO4` (item physical details) carries pack size — critical for unit economics. A 15g tube of Tinactin priced at $4.85 wholesale needs to land at our system as `unit_price_cents = 485, pack_qty = 1, pack_size = "15g"`.
- File volume: a 30-product watching list across 4 wholesalers = 120 LIN segments per refresh; trivial. But wholesaler full catalogs are 10k–50k LIN per file. **Don't ingest full catalogs** — filter to our `products` table NDCs at parse time.

**856 Advance Ship Notice (wholesaler → us):**

```
ST*856*0001~
BSN*00*SHIP-9988*20260504*1100*0001~
HL*1**S~
TD1*CTN25*1****G*15*LB~
TD5**2*UPS*M~
REF*BM*1Z999AA10123456784~
DTM*011*20260504~
HL*2*1*O~
PRF*PO-2026-0501-001*PHARM***20260501~
HL*3*2*I~
LIN*1*N4*00904679661~
SN1*1*12*EA~
PID*F****Tinactin Cream 1%~
SE*15*0001~
```

Real-world quirks:
- `BSN` purpose code `00` (original) vs `07` (replace) — handle replaces idempotently.
- `REF*BM` carries the carrier tracking number (UPS/FedEx). Map to `orders.tracking_number`.
- `HL` (hierarchical level) loops nest: shipment (S) → order (O) → item (I). Don't assume one item per shipment.
- DSCSA (Drug Supply Chain Security Act) requires lot number + expiration + serialized-package transaction info. Pharma 856s may carry these in `LIN` qualifiers `LT` and `XD` plus a `DSCSA` transaction-history reference. If a wholesaler omits these, reject the receipt — Kaleem can't legally dispense without traceability data.

**Other transactions:** 810 (invoice) maps to `payouts` reconciliation. 850 (our outbound PO) is straightforward — `BEG`, multiple `PO1`, `CTT`. 855 (PO ack) carries acceptance/changes per `ACK` line item. 832 cadence + 855 latency are the two operational unknowns to confirm with EzriRx during intake.

### 1.5 Onboarding asks (questions for EzriRx EDI rep)

The questions to put in the email to `edi@ezrirx.com`:

1. What 832 refresh cadence do top wholesalers (ABC, McKesson, Cardinal, Parmed) push to your hub? Daily? Sub-daily? Event-driven?
2. What's the typical 855 latency — minutes, hours, next-day batch?
3. Source IP allowlist required, or open-internet SFTP with key-based auth?
4. SFTP host + port; expected file-naming convention; archive directory behavior after pickup.
5. ISA/GS qualifier values to use for our pharmacy (we are PHARMxxxxx, you are EZRIRX — confirm exact strings).
6. AS2 supported? If yes, what are your AS2 station IDs and cert chain?
7. DSCSA T3 (transaction history, info, statement) data format on incoming 856s?
8. Sample 832/855/856 envelopes from a real wholesaler we can test parse against.
9. Sandbox/test partner ID we can dry-run against without producing real POs?
10. Fee structure (per-message, per-MB, monthly minimum)?

Most of these belong in `docs/wholesaler-questions.md` for the rep call and in a draft email under `docs/emails/ezrirx-edi-onboarding.md` (does not exist yet — write before Wave 3).

### 1.6 Alternatives if EzriRx is a non-starter

| Option | Status | Onboarding cost | What we get |
|---|---|---|---|
| **Direct ABC EDI** | Kaleem already has ABC account; ABC publishes 856 v4010 spec as PDF ([amerisourcebergen.com/-/media/.../ab_i856_4010_specification_20230301.pdf](https://www.amerisourcebergen.com/-/media/assets/amerisourcebergen/ab_i856_4010_specification_20230301.pdf)) | Email ABC EDI team; NDA; provisioning weeks | One source — but ABC is Kaleem's biggest. Falls back to portal scraping for the other 3. |
| **McKesson Connect API** | Gated. `apiaccess.mckesson.com` portal exists but requires McKesson business-development account ([mckesson.com/pharmacy-technology/.../data-integration](https://www.mckesson.com/pharmacy-technology/pharmaceutical-ordering/data-integration/)). Third-party Spark Shipping integrates but resells, doesn't expose the API directly. | Months. Pharma-grade contracts. | One source. |
| **Cardinal Health** | Similar gating. EDI-only via integrators (Zenbridge, Orderful, SPS Commerce) — no public direct EDI spec. | Months. | One source. |
| **Parmed direct portal** | Web-only. No documented EDI or API for small pharmacies. | Scrape-only. | Brittle. |

**Conclusion:** EzriRx is the only option that gives us 30+ wholesalers behind one EDI relationship. Going direct means N integration projects instead of one. Stick with EzriRx as primary. Fallback to ABC direct only if EzriRx has unworkable terms or pricing — not because of technical issues, since the 832/856 we'd parse are the same X12 standard regardless of source.

### 1.7 EDI parsing library recommendation

**Primary: [`node-x12`](https://www.npmjs.com/package/node-x12)** ([github.com/mvogttech/node-x12-edi](https://github.com/mvogttech/node-x12-edi)).

- TypeScript-friendly (typings via DefinitelyTyped or built-in).
- Zero dependencies. Stream-capable for large files.
- Path-based query syntax: `parser.query("ST/LIN[1]/N4")` returns NDC values.
- Supports both parsing and generation (we need 850 outbound).
- Active maintenance; recent commits.

**Rejected:**

- `edi-parser` — abandoned (last published 9 years ago). Won't survive a security audit.
- `@bizzhive/edi-parser` — **does not exist on npm.** Verify origin if cited elsewhere.
- `x12-parser` (tastypackets) — stream-based, alive, but read-only. We need generation for 850.
- Walmart's `gozer` — Java only.
- Custom hand-rolled parser — possible but the X12 envelope grammar (ISA/GS/ST nesting + HL hierarchical loops) is annoying enough that you'll spend a week getting edge cases right. Use `node-x12` and write a thin schema layer above it.

**Schema layer:** Write `lib/edi/parsers/{832,850,855,856,810}.ts` modules that take a parsed `node-x12` interchange and return validated TypeScript shapes (`ZodCatalogItem`, `ZodAdvanceShipNotice`, etc.). All wholesaler-specific quirks (carrier-name strings, DSCSA segment optionality, NDC format) live in those files — not scattered in agent code.

**Fixture sources:**
- ABC publishes a sample 856 v4010 in their public spec PDF (above). Adapt for tests.
- TrueCommerce sometimes posts sample envelopes per partner. Worth checking when EDI rep call is scheduled.
- Generate our own minimal-viable fixtures for 832/850/855 by reading the X12 standard and modeling after ABC's 856 segment style. Commit as `tests/fixtures/edi/{832,855,856}-sample.edi`.

### 1.8 Realistic Phase 2 Wave 3 implementation arc

```
Day 1-3: Email edi@ezrirx.com (template lives in docs/emails/ezrirx-edi-onboarding.md — write it).
         Draft same questions for ABC EDI as fallback (docs/emails/abc-order-data-exchange.md exists; reuse).

Week 1-3: EzriRx response. NDA. Sandbox creds. SSH key exchange.

Week 2 (parallel): Implement node-x12 + parsers + Zod schemas + fixtures.
                   Build EDI poller worker (Render cron polls SFTP every N minutes).
                   Persist parsed 832 lines into wholesaler_stock_snapshots.
                   Persist 856 events into orders state machine.

Week 3-4: Wire Fulfillment Ops agent skill prompt + executor (kernel pattern, propose-only).
          Agent reads wholesaler_stock_snapshots, proposes "place 850 with ABC for $4.85 vs $4.92 elsewhere."
          Kaleem clicks Approve → executor sends 850 → 855 ack flows back → agent updates order state.

Week 5: Smoke test on real 30-product watching list. Verify cost economics.
```

The **kernel-first pattern from Phase 2 Layers 1+2 maps cleanly:** Fulfillment Ops proposes (writes briefing + `pending_purchase_orders` row), Kaleem clicks Approve, executor sends 850 EDI envelope to SFTP drop, audit_log row written, 30-min undo cancels via 860 PO change.

---

## Part 2: SMS Provider Selection

### 2.1 Resend SMS — verified absent

Resend has **no native SMS support** as of May 2026. Confirmed by:

- Sequenzy's 2026 Resend-alternatives comparison ([sequenzy.com/alternatives/resend-alternatives](https://www.sequenzy.com/alternatives/resend-alternatives)) explicitly lists "no SMS" as a Resend gap and recommends MailerSend for unified email+SMS.
- Mobile Message integration page ([mobilemessage.com.au/integrations/app/resend](https://mobilemessage.com.au/integrations/app/resend)) sells itself as the SMS-bolt-on for Resend users — would not exist if Resend had native SMS.
- Resend's own docs at `resend.com/docs` cover only email APIs (verified during search).

The "Resend SMS" search hits surface in two contexts: (1) generic phrase "resend an SMS" (re-deliver a failed text), and (2) third-party tools that pair with Resend. **Resend the company does not send SMS.**

For PharmaDash this is fine — Resend stays as the email-only path (Account Health green-status digests, weekly P&L summaries from Bookkeeper). SMS is a separate vendor.

### 2.2 Twilio — recommended

#### Cost model

- **Per-segment cost:** $0.0083 outbound to US numbers.
- **Carrier surcharge:** ~$0.003 per segment (varies by carrier; AT&T ~$0.0035, T-Mobile ~$0.003 as of Jan 2026).
- **Effective per-segment:** ~$0.0118 to AT&T (worst case).
- A 160-character segment is one segment in GSM-7. Concatenated SMS ~153 chars per segment after the 7-byte UDH.
- **Phone number rental:** $1.15/month for a US 10DLC number.
- **10DLC registration (one-time + recurring):**
  - Brand registration: $4.50 one-time (sole proprietor or low-volume) OR $46 one-time (standard, includes secondary vetting).
  - Campaign vetting: $15 one-time per campaign.
  - Campaign monthly: $1.50–$10/mo per campaign depending on use case (low-volume mixed, account notifications, etc.).
- **Total Phase 2 SMS budget:** ~$5/mo (number + 1 campaign) + < $1/mo messaging at our volume + ~$50 one-time registration. Negligible.

Reference: [twilio.com/en-us/sms/pricing/us](https://www.twilio.com/en-us/sms/pricing/us), [help.twilio.com/articles/1260803965530](https://help.twilio.com/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service-).

#### 10DLC registration is mandatory

A2P 10DLC (Application-to-Person, 10-Digit Long Code) registration has been required for all US application-originated SMS since late 2023. Unregistered traffic gets:

- Heavy filtering (carriers may drop messages outright).
- Throttling (messages-per-minute caps far below registered traffic).
- Per-segment unregistered-traffic surcharges.

Kaleem registers as **sole proprietor** ($4.50 brand fee) since he's the business owner. One campaign for "account health alerts" type. **Plan for 5–7 days for registration to clear** — don't gate Wave 2 launch on it; send first via email until 10DLC clears.

#### TypeScript SDK

```bash
npm i twilio
```

```typescript
// lib/sms/twilio.ts
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function sendSms(to: string, body: string): Promise<string> {
  const msg = await client.messages.create({
    from: process.env.TWILIO_FROM_NUMBER,
    to,
    body,
  });
  return msg.sid;
}
```

The `twilio-node` SDK ships with TypeScript typings and is the official SDK. Account SID + Auth Token come from the Twilio console; both are environment-variable refs in our `.env` and `pharm1-shared` envVarGroup.

References:
- [twilio.com/docs/messaging/quickstart](https://www.twilio.com/docs/messaging/quickstart)
- [twilio.com/en-us/blog/send-sms-typescript-twilio](https://www.twilio.com/en-us/blog/send-sms-typescript-twilio)
- [npmjs.com/package/twilio](https://www.npmjs.com/package/twilio)

### 2.3 AWS SNS — rejected (for now)

- **Cheaper per-message** ($0.00645 vs $0.0083). At our volume (~5 SMS/day = 150/mo), the difference is $0.30/mo. Irrelevant.
- **No phone number management** — uses sender-ID pooled numbers. But still requires 10DLC registration for US. Same paperwork.
- **AWS account setup overhead.** PharmaDash has zero other AWS dependencies. Adding SNS means IAM, secrets management, billing alerts, region selection — first-AWS-service-tax. Not worth $0.30/mo savings.
- Reconsider if PharmaDash later adds AWS for any reason (e.g., S3-backed file storage if Backblaze B2 ever falls short).

References: [aws.amazon.com/sns/sms-pricing](https://aws.amazon.com/sns/sms-pricing/), [courier.com/integrations/compare/amazon-sns-sms-vs-twilio](https://www.courier.com/integrations/compare/amazon-sns-sms-vs-twilio).

### 2.4 Recommendation

**Twilio. Sole-proprietor 10DLC. One campaign. One US long-code number. ~$50 one-time + ~$5/mo + ~$1/mo messaging.**

Implementation footprint:

- New env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `KALEEM_SMS_NUMBER` (the recipient).
- New module: `lib/sms/twilio.ts` (~30 LOC).
- Account Health agent calls `sendSms(KALEEM_SMS_NUMBER, "ALERT: ODR red — listings auto-paused. Open inbox.")` from the red-status branch.
- Add to render.yaml `pharm1-shared` envVarGroup as `sync: false` (manual fill post-deploy, like other secrets).
- Add to `.env.example` with placeholder values.

**Pre-launch task:** Kaleem registers Twilio account (5 minutes), submits 10DLC brand + campaign (5 minutes form, 5–7 days approval). Same waterfall pattern as `docs/kaleem-onboarding.md` — add as new step.

---

## Part 3: File-References for Implementation

When Wave 2 / Wave 3 are scoped, these are the files to touch:

- `docs/emails/ezrirx-edi-onboarding.md` — **new file**. Draft using questions in §1.5.
- `docs/wholesaler-questions.md` — already exists; expand with EzriRx-specific Q list.
- `docs/kaleem-onboarding.md` — already exists; add SMS-provider step (Twilio signup + 10DLC).
- `docs/kaleem-todos.md` — already exists; track 10DLC registration approval.
- `tmp/ready-plans/` — when Wave 2 / Wave 3 are planned, link this dossier.
- `lib/edi/` (proposed, not yet created) — `node-x12` wrappers + parsers.
- `lib/sms/twilio.ts` (proposed, not yet created) — Twilio client.
- `render.yaml` — add Twilio + EDI env vars to envVarGroup `pharm1-shared`.

## Sources

### EzriRx
- [EzriRx EDI Documentation portal](https://edi.ezrirx.com/)
- [EzriRx homepage](https://www.ezrirx.com/)
- [TrueCommerce trading-partner page for EzriRx](https://www.truecommerce.com/trading-partner/ezrirx/)
- [RXinsider piece on EzriRx — 30+ wholesalers, NABP-accredited](https://rxinsider.com/market-buzz/19584-ezrirx-connects-30-nabp-accreditedandnbsp-wholesalers-with-thousandsandnbsp-of-pharmacies-in-the-us-ezrirx/)
- [Pharmaceutical Commerce: EzriRx aggregator overview](https://www.pharmaceuticalcommerce.com/view/ezrirx-seeks-consolidate-pharma-purchases-independent-pharmacies)

### EDI standards + parsers
- [X12.org — EDI standards body](https://www.x12.org/)
- [`node-x12` on npm](https://www.npmjs.com/package/node-x12)
- [`node-x12` GitHub (mvogttech)](https://github.com/mvogttech/node-x12-edi)
- [`x12-parser` (tastypackets) — read-only stream alternative](https://github.com/tastypackets/x12-parser)
- [`edi-parser` on npm — abandoned, do not use](https://www.npmjs.com/package/edi-parser)
- [Walmart `gozer` — Java only, reference for HL hierarchy handling](https://github.com/walmartlabs/gozer)

### Wholesaler direct EDI
- [AmerisourceBergen 856 v4010 specification PDF](https://www.amerisourcebergen.com/-/media/assets/amerisourcebergen/ab_i856_4010_specification_20230301.pdf)
- [AmerisourceBergen supplier 856 (older v4010, 2018)](https://www.amerisourcebergen.com/-/media/assets/amerisourcebergen/manufacturer/supplier_856_4010_specification_20181120.pdf)
- [AmerisourceBergen Manufacturer Logistics Guide](https://www.amerisourcebergen.com/-/media/assets/amerisourcebergen/manufacturer/manufacturer-logistics-guideline-final-v14.pdf)
- [Stedi — AmerisourceBergen guides](https://www.stedi.com/edi/network/amerisource-bergen)
- [EzCom — AmerisourceBergen EDI services](https://www.ezcomsoftware.com/amerisourcebergen-edi/)
- [McKesson pharmacy ordering data integration](https://www.mckesson.com/pharmacy-technology/pharmaceutical-ordering/data-integration/)
- [McKesson API access portal](https://apiaccess.mckesson.com/apiportal-service/)
- [Orderful — Cardinal Health trade page](https://www.orderful.com/network/cardinal-health-cardinal)
- [Zenbridge — Cardinal Health EDI](https://zenbridge.io/trading-partners/cardinalhealth-edi-integration/)

### SMS providers
- [Twilio SMS quickstart](https://www.twilio.com/docs/messaging/quickstart)
- [Twilio SMS pricing — US](https://www.twilio.com/en-us/sms/pricing/us)
- [Twilio A2P 10DLC pricing & fees](https://help.twilio.com/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service-)
- [Twilio 10DLC overview](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc)
- [Twilio Programmable Messaging + 10DLC docs](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc)
- [Twilio T-Mobile carrier fee changes Jan 2026](https://help.twilio.com/articles/44609260499995)
- [Twilio TypeScript blog post](https://www.twilio.com/en-us/blog/send-sms-typescript-twilio)
- [Twilio TypeScript examples (philnash)](https://github.com/philnash/twilio-typescript-examples)
- [`twilio` npm package](https://www.npmjs.com/package/twilio)
- [Resend homepage — note absence of SMS](https://resend.com/)
- [Sequenzy — 19 best Resend alternatives 2026 (confirms no Resend SMS)](https://www.sequenzy.com/alternatives/resend-alternatives)
- [Mobile Message — Resend integration (third-party SMS bolt-on)](https://mobilemessage.com.au/integrations/app/resend)
- [AWS SNS SMS pricing](https://aws.amazon.com/sns/sms-pricing/)
- [Courier — AWS SNS vs Twilio comparison 2026](https://www.courier.com/integrations/compare/amazon-sns-sms-vs-twilio)
- [Ably — Amazon SNS vs Twilio 2026](https://ably.com/compare/amazon-sns-vs-twilio)
- [Apidog — Twilio SMS API cost breakdown 2026](https://apidog.com/blog/twilio-sms-api-cost/)
