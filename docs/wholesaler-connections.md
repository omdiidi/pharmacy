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

## What each email is asking for (same pattern, 4 things)

Every draft email asks the wholesaler's data team for exactly four things:

```
  1. Route EDI 832 (price catalog) + 846 (inventory) feeds
     to an additional SFTP endpoint we control
     — SAME DATA, ADDITIONAL DESTINATION
     — not replacing any existing feed

  2. Feed cadence details — how often is 846 refreshed?

  3. Anticipated restock dates — included in 846 feed?
     (critical for our stock-out prediction)

  4. Blind-shipping confirmation in writing
     (required for Amazon Seller Central documentation —
      no wholesaler branding on customer-facing packages)
```

The 4th one matters even if the first 3 fail. Without blind-ship confirmation in writing, your Amazon account is at audit risk.

---

## What you tell Kaleem (the short version)

> *"There are two tracks. Track one: sign up for EzriRx and request EDI onboarding — that gives us 30+ wholesalers in one integration. Track two: forward the ABC data-exchange email I drafted to your ABC rep today, and we'll do the same for Parmed, McKesson, Cardinal, IPC next week. All four emails are already written; you just fill in your account numbers and forward. The direct connections give us cheaper unit prices on each wholesaler's own catalog; EzriRx is our fast-start safety net."*

---

## One-line status to put in the meeting

**EzriRx + ABC direct = Phase 1 ship. Other wholesalers = nice-to-have, do as Kaleem has time.** If he only does ABC + EzriRx, we're still 90% covered.
