# How This Works — Overview for Kaleem

What the pharmacy automation platform is, what each piece does, where the data comes from, and what we need from your Amazon account to wire it up.

---

## In one sentence

A team of AI specialists reads your wholesalers, Amazon's market data, the FDA feeds, and your own sales history every day — then hands you a prioritized list of what to list, at what price, and tracks every sale — all with you making the final click on every decision.

---

## The setup at a glance

```
                    KALEEM (you)
                         │
             opens the app on any device
                         │
                         ▼
          ┌──────────────────────────────┐
          │   CHIEF OF STAFF              │
          │   (the AI you talk to)        │
          │                               │
          │   via Chat + Inbox            │
          └───────────────┬──────────────┘
                          │
          coordinates ↓   │   ↓ reports to you
                          │
        ┌─────────────────┴─────────────────┐
        │                                    │
        │  9 AI SPECIALISTS                  │
        │  — each does one job well —        │
        │                                    │
        │  Research Analyst                  │
        │  Repricer                          │
        │  Fulfillment Ops                   │
        │  Account Health                    │
        │  Customer Success                  │
        │  Bookkeeper                        │
        │  Portfolio Manager                 │
        │  Reflector                         │
        │  Chief of Staff (meta)             │
        │                                    │
        └────────────────┬───────────────────┘
                         │
                         │ all share one memory
                         ▼
          ┌──────────────────────────────┐
          │   SHARED DATABASE + MEMORY    │
          │   (every decision logged,     │
          │    every outcome remembered)  │
          └──────────────────────────────┘
```

---

## What each specialist does (one specific sentence each)

**1. Chief of Staff** — The AI you directly chat with; its job is to curate every report from the 8 other specialists into a single prioritized inbox, answer your questions in natural language using data from the entire system, and mediate when different specialists disagree (e.g., Repricer wants to drop a price but Portfolio Manager wants to hold).

**2. Research Analyst** — Runs every morning at 6 AM, pulls overnight changes from your wholesalers + Keepa + the FDA shortage feed + Google Trends + your own sales history, applies the policy filter to auto-exclude blocked products, scores the remaining opportunities, and hands you a ranked list of 5–10 products worth listing today with a full "why now" reasoning per pick.

**3. Repricer** — Twice a day (morning + afternoon) plus instantly when a market event fires, reviews every one of your live listings and decides whether to match the current Buy Box, hold position, raise, drop, or pause — all within the margin floor you set and the Amazon Fair Pricing ceiling (~25% above 30-day median).

**4. Fulfillment Ops** — The moment a new Amazon or eBay order hits, queries every wholesaler in real time to find which one has that SKU cheapest and actually in stock, builds a side-by-side comparison table (price, stock, bulk discount, ship ETA), and shows it to you to pick — then deep-links you into the winner's pre-filled cart so you click Buy.

**5. Account Health** — Polls Amazon's seller health metrics every hour (Order Defect Rate, Late Ship Rate, Cancellation Rate, Valid Tracking Rate, Buy Box win %) — if any metric is drifting bad, it auto-pauses new listings to protect your account and drafts a diagnostic + recovery plan for your approval; if a metric goes red, emergency mode triggers and texts you.

**6. Customer Success** — When a customer message or return request hits your Seller account, it first triages whether the message is actually actionable (vs "thanks" / bot noise), then drafts a contextually appropriate reply using your past handling style as a template — you always approve before it sends, and any medical question is automatically flagged to you personally since that's pharmacist-level.

**7. Bookkeeper** — Runs nightly and on every Amazon payout event — reconciles all sales, fees, refunds, chargebacks, and wholesaler costs into a daily one-page P&L, flags anomalies (refund rate spike, fee change, payout delay), tracks your sales tax obligations per state and 1099-K thresholds, and never touches money itself — only reports.

**8. Portfolio Manager** — Every Sunday morning, pulls a year's worth of data to produce a strategic review: what categories are growing, which are dying, year-over-year comparisons, seasonal positioning, cash flow, competitor landscape shifts — and proposes 3 strategic moves for the coming week that bind the other specialists' behavior until the next review.

**9. Reflector** — Every Sunday night, reads everything that happened that week (every decision made, every outcome that followed) and distills the patterns into updated playbooks and facts in the shared memory — so next time a similar situation arises (e.g., ABC out of acetaminophen + Amazon offers dropping), the Research Analyst already knows what worked last time.

---

## Where the data comes from

Four main feeds + your own history. The Research Analyst combines all of them.

```
┌─────────────────────────┬─────────────────────────────────────────┐
│ 1. YOUR WHOLESALERS     │  Daily stock + prices from 30+ suppliers │
│    via EzriRx           │  (ABC, McKesson, Cardinal, Parmed, IPC)  │
│                         │  — knows when a SKU is running low, when │
│                         │  it's back in stock, and the cheapest    │
│                         │  source right now                        │
├─────────────────────────┼─────────────────────────────────────────┤
│ 2. AMAZON MARKET        │  Historical BSR, offer count, Buy Box    │
│    via Keepa            │  winner, whether Amazon itself is selling│
│                         │  — the signal that tells us when FBA is  │
│                         │  running out and we can swoop in         │
├─────────────────────────┼─────────────────────────────────────────┤
│ 3. AMAZON YOUR ACCOUNT  │  Your orders, listings, competitor      │
│    via Amazon SP-API    │  prices on your ASINs, account health    │
│                         │  metrics (Order Defect Rate, etc.)       │
├─────────────────────────┼─────────────────────────────────────────┤
│ 4. PUBLIC SIGNALS       │  FDA Drug Shortage feed (Rx shortages    │
│    FDA + Google Trends  │  trigger OTC adjacency spikes — e.g.,    │
│                         │  when acetaminophen is short, Tylenol    │
│                         │  sells high), FDA recalls auto-block     │
│                         │  affected SKUs, Google Trends flags      │
│                         │  demand spikes early                     │
├─────────────────────────┼─────────────────────────────────────────┤
│ 5. YOUR SALES HISTORY   │  Your past Amazon + pharmacy sales —     │
│    from your Seller DB  │  the strongest signal we have because    │
│                         │  it's ground truth: what YOU actually    │
│                         │  sell, at what price, to whom            │
└─────────────────────────┴─────────────────────────────────────────┘
```

### Why these five specifically

- **EzriRx** aggregates 30+ wholesalers in a single integration. One connection replaces dealing with each wholesaler's EDI system separately.
- **Keepa** is the only tool that sees Amazon's market *history* — it answers "what was the Buy Box price yesterday vs today" and "is FBA running out." Without it we'd be blind for 30+ days building our own history.
- **Amazon SP-API** gives us your own account data plus the authoritative current state of every listing.
- **FDA feeds** are free public data — underused signal. When a Rx drug goes on the shortage list, the OTC alternative spikes on Amazon within days.
- **Your sales history** is your edge. A random arbitrage seller can use all four of the above — only YOU have a track record of what actually sells from your pharmacy.

---

## What we need from your Amazon account to wire this up

This is the hand-off list. Once we have these, we're 90% of the way to the system running against your real Amazon data.

### 1. Amazon Selling Partner API access (the "API key")

Amazon's official developer API. Free. Required for production. **Starts with ~30 minutes of your time this week, then 1–4 weeks for Amazon to approve.**

What you do:
```
  1. Log into Seller Central
  2. Apps & Services → Develop Apps
  3. Click "Create new app"
  4. Fill in business info (pharmacy name, phone, website)
  5. Submit for developer profile approval
```

What Amazon gives back (after approval):
```
  • App Client ID
  • App Client Secret
  • Refresh Token
  • LWA (Login With Amazon) credentials
```

What we do with it:
- Pull your orders in real time as they happen
- Read competitor prices on your ASINs (Keepa is read-only historical; SP-API is live)
- Publish listing changes + repricing directly (no browser automation)
- Monitor your account health metrics (Order Defect Rate, Late Ship Rate, Valid Tracking Rate, Buy Box win %)

### 2. Category ungating (Health & Personal Care + supplement sub-categories)

If you're not already ungated in H&PC, we need to go through ungating. The good news: **your licensed-pharmacist status makes this easier than for a random reseller.**

What you need for ungating:
```
  • Professional seller plan (you have this)
  • Commercial invoices from authorized supplier
    (ABC / McKesson — past 180 days, 10+ units minimum)
  • Business name + address EXACTLY matching Seller Central
  • For supplements: NSF / Eurofins / UL Solutions Certificate of Analysis
    per brand (new Dec 2025 Amazon requirement)
```

What to send to me this week:
- Copies of recent ABC invoices (we'll redact anything sensitive before use)
- Your pharmacy's exact legal name + address as registered on Amazon
- The list of top 10–20 supplement brands you sell (we'll check TIC coverage)

### 3. Historical data export (so we don't start blind)

Your past Amazon activity is gold. Once NDA is signed, we pull:

```
  • All Orders report (last 12–24 months)
  • All Listings report (current + historical prices)
  • Sales & Traffic reports (conversion, units, revenue by ASIN)
  • Settlement reports (what you've actually been paid)
  • Customer Feedback + Returns history
```

These are all one-click downloads from Seller Central → Reports. Takes you 5 minutes; gives us real ground truth to start from.

### 4. Seller Central access for setup (optional but faster)

Two options:

| Option | Setup time | What we can do |
|---|---|---|
| **A. You invite us as a User** in Seller Central (User Permissions) | 2 min | Help configure SP-API app, pull reports, diagnose issues. You can set granular permissions — view-only, specific features only. Revoke anytime. |
| **B. You do everything yourself** based on our instructions | Slower iteration | Zero access on our end. More calls/screen-shares between us. |

Default: Option A with view-only access on most features, full access only on "Manage Apps" during SP-API setup. All revocable in one click.

### 5. Blind-ship confirmation from each wholesaler

Amazon's dropship policy: the package that reaches your customer must look like it came from YOUR pharmacy, not from ABC/McKesson/Cardinal/Parmed. You've told me ABC doesn't brand your boxes — we need that in a one-paragraph email from your rep, for your own audit trail if Amazon ever asks.

---

## What we need from your Mac mini

Covered in the meeting prep, but the short version:

```
 On your existing Linux Mint Mac mini:
   When minicrew (our agent runtime) lands — takes ~30 min of setup:
     → install the Python worker service
     → set up .env with Supabase + Claude API + SP-API credentials
     → install systemd service so it auto-starts on boot
     → first agent job running within an hour
```

Zero hardware cost. Uses the mini you already own. Stays at the pharmacy running in the background — we can SSH in for maintenance when needed (optional, not required for operation).

---

## What you still do (the "you always click" invariants)

```
  ✓ You approve every listing before it goes live
  ✓ You click "Buy" on every wholesaler order — the system never spends money for you
  ✓ You approve every customer message reply before send
  ✓ You approve every significant price change (small ones within rules: auto)
  ✓ You set the rules (min margin, max price, approve-every vs auto-within-rules)
  ✓ You own the system: end a session any time, revoke access any time, 30-min undo on anything

  Medical questions from customers → always routed to you personally
  Prescription data → never touches this system (separate from Pioneer)
```

---

## Timeline honest estimate

```
Week 0 (today)                 Meeting: align on everything
Week 1-2                       I build the platform + chatbot
Week 1-2                       You submit SP-API app (1-4 week wait)
Week 2-3                       SP-API credentials land, wired into chatbot tools
Week 4-6                       SP-API approved + real agent briefings
Month 2-3                      Full operation, attributable revenue report
```

---

## Questions answered in one pass

**Q: How much does this cost to run?**
~$360–680/month once wired (AI API + database + data feeds + hosting). A single good arbitrage sale (like the Tinactin moment — $51 sold from $7 cost) covers a full week of running cost.

**Q: Who owns the data?**
You do. Everything lives in a Supabase database in your account. You get weekly encrypted backups to your own Mac mini. Full export anytime.

**Q: What if I want to stop using it?**
Revoke SP-API app, remove our user access from Seller Central, turn off the Mac mini. Everything stops. Data is yours to keep.

**Q: Can this touch my Pioneer / prescription system?**
No. By design, architecturally separated. OTC-only. Two-POS architecture — Pioneer stays untouched on its own PC.

**Q: Is any of this going to get my Amazon account suspended?**
The whole policy filter is built around Amazon's rules: pseudoephedrine/ephedrine blocked, kratom/CBD blocked, disease claims blocked, expired-product risk minimized (9-month shelf-life floor), Fair Pricing Policy ceiling enforced, TIC-verified supplements only. The system is *more* cautious than a human would be by default.

**Q: What happens if the system makes a bad recommendation?**
You can reject it with one click. The Reflector agent reads your rejections weekly and updates the team's playbook so the bad pattern doesn't repeat. Every decision is logged with full reasoning trail for audit.

---

## One-page summary

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  THE PLATFORM                                                         │
│  A team of 9 AI specialists coordinated by a Chief of Staff,          │
│  running on your Mac mini + cloud database, watching 5 data feeds,    │
│  producing a daily list of actions for you to approve.                │
│                                                                       │
│  DATA FEEDS                                                           │
│  1. EzriRx — live wholesaler stock + prices (30+ suppliers)           │
│  2. Keepa — Amazon historical market data                             │
│  3. Amazon SP-API — your orders, listings, account health             │
│  4. FDA + Google Trends — public signals                              │
│  5. Your own sales history — the ground truth                         │
│                                                                       │
│  WHAT WE NEED FROM YOUR AMAZON                                        │
│  1. SP-API app (30 min of your time + 1-4 weeks Amazon approval)      │
│  2. H&PC + supplement ungating (if not already done)                  │
│  3. Historical reports download (5 min)                               │
│  4. User invite to Seller Central (2 min, revocable)                  │
│  5. Blind-ship confirmation emails from wholesalers                   │
│                                                                       │
│  YOUR ROLE                                                            │
│  You approve every listing, every purchase, every customer reply.     │
│  The system does the research + the clicking. You make the calls.    │
│  30-min undo on every action.                                         │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```
