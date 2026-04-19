# Wholesaler Connections — Strategy + Action List

What we need to connect, in what order, and who does what.

---

## The two-track strategy

```
  ┌─────────────────────────────────────────────────────────┐
  │  TRACK 1: EzriRx (PRIMARY)                               │
  │  One integration = 30+ wholesalers aggregated            │
  │  Fast to set up (days), covers 90% of our needs         │
  └─────────────────────────────────────────────────────────┘
                           ║
                           ║ parallel
                           ▼
  ┌─────────────────────────────────────────────────────────┐
  │  TRACK 2: Direct wholesaler EDI (SLOWER, BETTER PRICES)  │
  │  Per-wholesaler EDI feed routed to our SFTP              │
  │  Slower (weeks of paperwork), but better unit economics  │
  │  for THAT wholesaler's catalog                           │
  └─────────────────────────────────────────────────────────┘
```

**Why both:**
- EzriRx is the marketplace layer — fast, multi-source, but marks up on resale
- Direct ABC EDI gives us ABC's own prices (cheaper than EzriRx for ABC catalog)
- Same for McKesson, Cardinal — each direct connection beats EzriRx for that wholesaler's SKUs
- Architecture supports "use direct when available, fall back to EzriRx otherwise"

---

## Priority order

### This week (critical — unblocks everything)

**1. Forward the ABC direct-EDI email to your ABC rep**
- Draft: `docs/emails/abc-order-data-exchange.md`
- Your action: fill in account number, forward to your rep
- Expected response time: 1-3 business days to route you to their data team

**2. Sign up / verify EzriRx membership**
- Go to https://www.ezrirx.com
- If already a member: great — request EDI onboarding at https://edi.ezrirx.com
- If not a member: sign up this week
- Expected onboarding: ~1-2 weeks for EDI setup

### Next week (should-do)

**3. Parmed direct-EDI email**
- Draft: `docs/emails/parmed-data-exchange.md`
- **Before sending separately:** ask your ABC rep if the ABC data integration can also cover Parmed (both Cencora-owned). If yes, skip this. If no, forward this email.

**4. McKesson direct-EDI email** (if you use them)
- Draft: `docs/emails/mckesson-data-exchange.md`
- Only send if you actually order from McKesson at one of your pharmacies

**5. Cardinal Health direct-EDI email** (if you use them)
- Draft: `docs/emails/cardinal-data-exchange.md`
- Only send if you actually order from Cardinal

### As applicable

**6. IPC (Independent Pharmacy Cooperative)**
- Draft: `docs/emails/ipc-data-exchange.md`
- Send to `member.services@ipcrx.com` or your IPC rep

---

## What each connection gives us

| Connection | Gets us... | Speed |
|---|---|---|
| **EzriRx EDI** | Stock + prices from 30+ wholesalers in one feed | Near-real-time (their claim; verify during onboarding) |
| **ABC direct EDI** | Authoritative ABC catalog prices + inventory + anticipated restock dates | Daily file drop |
| **Parmed direct EDI** | Parmed-specific catalog (may be same as ABC if Cencora consolidates) | Daily |
| **McKesson direct EDI** | McKesson catalog (biggest wholesaler in US — more SKU breadth) | Daily |
| **Cardinal direct EDI** | Cardinal catalog | Daily |
| **IPC direct EDI** | IPC OTC Solutions catalog | Daily |

Multi-wholesaler is how our Fulfillment Ops agent can show you the best source for every order — "ABC has it at $4.50, 387 in stock; McKesson at $4.95, 200 in stock; you save $0.45/unit going with ABC."

---

## What each email is asking for

### ABC + Parmed (expanded — 10 asks, since they're the primary suppliers)

Since we're bothering the data team anyway, we front-load everything we might want. The full list of asks in each email:

```
  1. Route EDI 832 / 846 / 856 / 810 feeds to additional SFTP
     — SAME DATA, ADDITIONAL DESTINATION
     — not replacing existing Pioneer feed

  2. Feed cadence — how often is 846 refreshed?

  3. Anticipated restock dates — in 846, or supplemental?

  4. Product master data — full SKU catalog (NDC, UPC, pics,
     pack sizes, substitution mappings)

  5. Contract pricing confirmation — 832 reflects our
     contracted rates, not list prices

  6. Historical data export — 12-24 months of price + inventory
     + order history as one-time dump

  7. Programmatic ordering via EDI 850 — can we place POs from
     our system? 855 acknowledgment latency? Substitution logic?

  8. Real-time stock API — beyond daily 846, any REST endpoint
     or webhook for high-volume / time-sensitive checks?

  9. Blind-shipping confirmation in writing — no wholesaler
     branding on carton, packing slip, or invoice

  10. Parmed / Cencora consolidation (ABC email only) —
      can ABC team also handle Parmed integration, or separate?
```

### McKesson, Cardinal, IPC (lighter — 4 asks)

These are secondary for Kaleem; simpler email with the core 4:

```
  1. Route 832 / 846 feeds to our SFTP
  2. Feed cadence
  3. Anticipated restock dates
  4. Blind-shipping confirmation in writing
```

If those go well, we escalate with the longer list.

### The full question catalog

All questions we'd ever want answered — used on follow-up calls with the data team after the initial email exchange: [`wholesaler-questions.md`](./wholesaler-questions.md). 50+ questions across 13 categories (EDI basics, routing, inventory semantics, pricing, product master, historical data, programmatic ordering, real-time options, shipping, returns, compliance, support, contracts).

### The one that matters most

**Blind-shipping confirmation in writing.** Without this, Kaleem's Amazon Seller account is at audit risk regardless of what else we do.

---

## What you tell Kaleem (the short version)

> *"There are two tracks. Track one: sign up for EzriRx and request EDI onboarding — that gives us 30+ wholesalers in one integration. Track two: forward the ABC data-exchange email I drafted to your ABC rep today, and we'll do the same for Parmed, McKesson, Cardinal, IPC next week. All four emails are already written; you just fill in your account numbers and forward. The direct connections give us cheaper unit prices on each wholesaler's own catalog; EzriRx is our fast-start safety net."*

---

## One-line status to put in the meeting

**EzriRx + ABC direct = Phase 1 ship. Other wholesalers = nice-to-have, do as Kaleem has time.** If he only does ABC + EzriRx, we're still 90% covered.
