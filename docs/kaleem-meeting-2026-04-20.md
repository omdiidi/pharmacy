# Meeting Prep — Kaleem · 2026-04-20

> **2026-04-30 update:** This was meeting prep for the 2026-04-20 meeting (now historical). Architecture has since shifted to **cloud-only** (Mac mini removed). Sections referring to Mac mini setup are kept as historical record but flagged inline. For current architecture see `tmp/research/2026-04-30-agent-runtime-recommendation.md` v3 and `CLAUDE.md`.

Short sheet for the in-person meeting. No fluff. Heavy on visuals so you can show, not just tell.

---

## TL;DR

```
┌─────────────────────────────────────────────────────────────┐
│ WHAT'S DONE                      WHAT'S NEEDED FROM KALEEM   │
│                                                              │
│ ✓ Plan complete (v4, 3 reviews) │ 1. Send ABC data email    │
│ ✓ Repo live: omdiidi/pharmacy   │ 2. NDA signed             │
│ ✓ Architecture finalized        │ 3. Submit SP-API dev app  │
│ ✓ Cost estimate: $300-600/mo    │ 4. Brand list (top 20-30) │
│ ✓ Ready to build tomorrow       │ 5. TIC supplement check   │
│                                  │                           │
└─────────────────────────────────────────────────────────────┘
```

Plan is done. Live in the repo at **https://github.com/omdiidi/pharmacy**. Three reviewer passes, 9/10 implementation confidence. I need 5 commitments from him in this meeting to unblock the 4-6 week path to a first real agent briefing. **Biggest ask: submit the Amazon SP-API developer application today or tomorrow so the 5-14 day Amazon review runs in parallel with my Phase 1 build.**

---

## How the system fundamentally works (plain English)

Think of it as **hiring a team of AI specialists** who work around Kaleem:

```
                  ┌──────────────────────────┐
                  │     KALEEM                │
                  │  (the decision-maker)    │
                  └────────────┬─────────────┘
                               │ talks to / approves
                               ▼
                  ┌──────────────────────────┐
                  │    CHIEF OF STAFF        │
                  │  (the one he chats with)  │
                  └────────────┬─────────────┘
                               │ coordinates
         ┌──────┬──────┬──────┼──────┬──────┬──────┐
         ▼      ▼      ▼      ▼      ▼      ▼      ▼
    ┌────────┬──────┬──────┬──────┬──────┬──────┬──────┐
    │Research│Repri-│Fulfil│Acc't │Custo-│Bookk-│Portfo│
    │Analyst │cer   │-ment │Health│mer   │eeper │lio + │
    │        │      │Ops   │      │Succ. │      │Reflec│
    └────┬───┴──┬───┴──┬───┴──┬───┴──┬───┴──┬───┴──┬───┘
         │      │      │      │      │      │      │
         └──────┴──────┴──────┴──────┴──────┴──────┘
                               │
                               ▼
                  ┌──────────────────────────┐
                  │    SHARED MEMORY         │
                  │ (remembers everything)   │
                  └──────────────────────────┘
```

**Who does what:**
| Agent | Job | Runs when |
|---|---|---|
| **Chief of Staff** | The one Kaleem actually talks to via chat | Always on |
| **Research Analyst** | Reads overnight data, hands him 5 listing ideas with reasoning | Daily 6am |
| **Repricer** | Adjusts prices when market shifts | 7am + 2pm + on big events |
| **Fulfillment Ops** | When Amazon order hits, shows him all suppliers side-by-side, he picks | Real-time on order |
| **Account Health** | Watches his Amazon metrics; pauses listings if health tanking | Daily + events |
| **Customer Success** | Drafts replies to customer messages; escalates medical Qs to him | On message |
| **Bookkeeper** | Nightly payout reconciliation, P&L, anomaly flags | Daily 11pm |
| **Portfolio Manager** | Weekly strategic review with year-over-year context | Sunday 7am |
| **Reflector** | Reads the week and updates the team's shared playbook | Sunday 11pm |

**Shared memory** = Supabase cloud DB (Postgres with vector search). Every decision logged. "Why did we list X?" → replay the full reasoning trail. Over time, the system learns patterns: *"last time ABC backordered acetaminophen and Amazon offer count dropped below 5, listing Tylenol at Buy Box × 1.15 won 4 of 5 times."*

**The invariant that matters:** Kaleem stays 100% in control. The system does research and presents options. **He clicks every Buy button, approves every reply, confirms every price change.** 30-minute undo on everything.

---

## A day in the life (show him this flow)

```
   06:00                08:30                 11:42                 16:00                23:00
     │                    │                     │                     │                    │
     ▼                    ▼                     ▼                     ▼                    ▼
┌─────────┐       ┌──────────────┐      ┌──────────────┐      ┌──────────────┐    ┌──────────────┐
│Research │       │ Kaleem opens │      │ Amazon order │      │ Market moved │    │ Bookkeeper   │
│Analyst  │──────▶│ app at the   │      │ comes in     │      │ on Tinactin  │    │ reconciles   │
│scans    │       │ pharmacy,    │      │              │      │ (BB dropped) │    │ today's      │
│overnight│       │ sees 5 picks │      │ Fulfillment  │      │              │    │ payouts      │
│data     │       │ in Inbox     │      │ Ops shows    │      │ Repricer     │    │              │
│         │       │              │      │ him all 4    │      │ alerts:      │    │ Shows daily  │
│         │       │ Approves 3,  │      │ supplier     │      │ "match at    │    │ P&L:         │
│         │       │ skips 2 with │      │ options in a │      │ $38.99 or    │    │ $280 gross,  │
│         │       │ reasons      │      │ comparison   │      │ pause?"      │    │ $75 net      │
│         │       │              │      │ table        │      │              │    │              │
│         │       │ System lists │      │              │      │ Kaleem says  │    │              │
│         │       │ on Amazon    │      │ Kaleem picks │      │ "match"      │    │              │
│         │       │              │      │ ABC, clicks  │      │              │    │              │
│         │       │              │      │ "Open Cart"  │      │              │    │              │
│         │       │              │      │ in ABC Order │      │              │    │              │
│         │       │              │      │ (pre-filled) │      │              │    │              │
└─────────┘       └──────────────┘      └──────────────┘      └──────────────┘    └──────────────┘

Cost per day of Kaleem's time: ~15 minutes total of clicking.
Cost per day of the system: ~$10-20 in AI API calls.
```

---

## Architecture in one diagram (for him)

*Updated 2026-04-30. Original diagram showed Mac mini as primary worker; that role moved to Render.*

```
                   ┌─────────────────────────────────────┐
                   │   SUPABASE (cloud — always-on)       │
                   │   Queue + data + memory + audit log  │
                   │   $25/mo. One source of truth.       │
                   └───────────────┬──────────────────────┘
                                   │ reads/writes
                                   ▼
                   ┌─────────────────────────────────────┐
                   │  RENDER (single cloud deploy unit)   │
                   │                                      │
                   │  Web service:                        │
                   │  • Kaleem's web app                  │
                   │  • Sign-in + Inbox + Chat            │
                   │  • Business Chatbot                  │
                   │  • Works on phone + laptop anywhere  │
                   │                                      │
                   │  Worker service:                     │
                   │  • Runs the 9 AI agents              │
                   │  • Pulls daily wholesaler data       │
                   │    via SFTP                          │
                   │                                      │
                   │  Render Cron:                        │
                   │  • Weekly encrypted backup → B2      │
                   │                                      │
                   │  $30-65/mo                           │
                   └─────────────────┬───────────────────┘
                                     │ encrypted backup
                                     ▼
                   ┌─────────────────────────────────────┐
                   │  BACKBLAZE B2 (separate cloud acct)  │
                   │  • Off-cloud encrypted backups       │
                   │  • Object Lock + write-only token    │
                   │  • $1-3/mo                           │
                   └─────────────────────────────────────┘
```

**No on-prem hardware required.** Earlier plan used Kaleem's Mac mini; that's been replaced with the cloud worker so system uptime doesn't depend on pharmacy WiFi or power.

```
                              Kaleem at the counter
                                      ↓
                         ┌──────────────────────────┐
                         │   opens app on phone     │
                         │   https://pharm1.render  │
                         └────────────┬─────────────┘
                                      │
                     ┌────────────────┼────────────────┐
                     │                │                │
                     ▼                ▼                ▼
                ┌────────┐      ┌──────────┐    ┌──────────┐
                │ INBOX  │      │   CHAT   │    │ PREVIEW  │
                │(home)  │      │(chatbot) │    │(phase 2) │
                └────────┘      └──────────┘    └──────────┘
                 │                   │
                 │                   │ natural language
                 │                   │ ↓ *"Should I list Tinactin?"*
                 │                   │ ↑ *"Yes — 4 sellers left, BB $48,*
                 │                   │   *ABC has 347 at $7. List at $44.99?"*
                 │                   │
                 ▼                   ▼
          [5 picks with "Why?"]  [threaded chat]
          [1-click List / Skip]  [streaming answers]
```

---

## ~~The Mac mini~~ → Cloud-only (updated 2026-04-30)

Earlier meeting prep proposed using Kaleem's existing Mac mini as the primary agent worker. After follow-up research and user discussion, the architecture moved to **fully cloud-deployed** on Render. Reasons:
- Keeps system uptime independent of pharmacy WiFi/power.
- Backup target moved to Backblaze B2 in a separate cloud account for stronger air-gap than on-prem (Object Lock + write-only API token = compromised credentials can't delete the backup).
- No SSH-into-pharmacy maintenance burden.
- Cost difference ($10–30/mo Render worker + $1–3/mo B2) is negligible vs business-uptime risk.

**For the meeting (which has now passed):** there was no Mac mini setup ask of Kaleem. If/when Kaleem asks "what about my mini?" the answer: he keeps it for personal use; our system has zero on-prem dependency.

**Pioneer/Rx isolation is preserved.** The cloud architecture never touches Pioneer's network, never gets prescription data, runs in a completely separate Supabase project. Two-POS architecture is unchanged.

---

## 🔑 The big meeting ask: submit the Amazon SP-API developer application

The single most important unlock from this meeting. Amazon's review takes 5-14 business days; starting it today means credentials arrive around the time Phase 1 ships, so there's no idle waiting later. Full procedure in `docs/amazon-sp-api-setup.md`.

### What he does in the meeting (~10 minutes)

```
  1. Log into Seller Central (he can do this on his phone or laptop)
  2. Apps & Services → Develop Apps
  3. Click "Register as a developer"
  4. Fill in Developer Profile form:
     - Developer name: [pharmacy legal name]
     - Business address: [exact address on Seller Central]
     - Website, email, phone
  5. Select "For your own use" — private app
  6. Check data-use categories we need:
     ☑ Product Information
     ☑ Pricing Information
     ☑ Orders (we'll skip Personal Information for now to avoid
       the restricted-role questionnaire — can add later)
     ☑ Inventory Information
     ☑ Reports
     ☑ Notifications
  7. Submit
```

Amazon emails back in 1-3 business days typically.

### After approval (~15 more minutes, can be done over a quick call)

```
  1. Create the SP-API app (Private / Self-authorized)
  2. Select roles: Product Listing, Pricing, Inventory & Order Tracking,
     Amazon Fulfillment, Finance & Accounting, Reports
  3. Authorize the app for his own account
  4. Save the 3 credentials:
     - LWA Client ID
     - LWA Client Secret
     - Refresh Token
  5. Share with us via 1Password after NDA is signed
```

### Why this is the one right path

No shortcuts exist. Amazon doesn't offer a single-click API key like Stripe. Browser scraping / manual CSV exports are fragile and don't scale. **SP-API is the real long-term answer and the review timeline runs in parallel with Phase 1 build — no idle waiting if we start today.**

---

## Critical — resolve in the meeting

### 1. Blind-ship confirmation in writing

**What:** Amazon's dropship policy requires ABC's packing slip + box to show Kaleem's pharmacy branding, not ABC's. He said ABC doesn't brand his boxes today — need that in writing for audit trail.

**Ask:** *"Can you email your ABC rep this week asking for a one-paragraph written confirmation they blind-ship? Same for McKesson, Cardinal, Parmed, IPC — whichever you use for Amazon orders."*

### 2. Forward the ABC data-exchange email

**What:** Email I drafted (lives at `docs/emails/abc-order-data-exchange.md`). Asks his ABC rep to route the daily price+inventory EDI feed to an SFTP we control. Also asks for anticipated-availability dates and blind-ship in writing.

**Ask:** *"Review the email, fill in your account number, forward to your ABC rep today."*

### 3. NDA execution

**What:** Before credentials, logins, real data.

**Ask:** *"Sign today or at Sunday's meeting. Without it, I can't touch your real accounts."*

### 4. TIC supplement brand check

**What:** Dec 2025 Amazon policy expanded — ALL supplements need NSF / Eurofins / UL Solutions COA, renewed annually. Big brands likely comply. Small/private-label probably don't.

**Ask:** *"List of your top 10 supplement brands. I'll spot-check TIC coverage per brand. Some may need to pause until supplier certifies."*

### 5. Brand-authorization priority list

**What:** Pfizer, J&J, Pharmavite, Pure Encapsulations, Garden of Life hunt unauthorized resellers with IP complaints. Licensed-pharmacy helps but doesn't fully shield.

**Ask:** *"Top 20-30 brands you touch. I'll classify safe / needs-LOA / actively-hunts. We may need to ask some manufacturers for Letters of Authorization."*

### 6. Submit the SP-API developer application

**What:** See big section above. The Amazon API paperwork — 5-14 business days review. Starting today means credentials land around when Phase 1 ships.

**Ask:** *"Can we spend 10 minutes in the meeting (or on your phone tonight) submitting the SP-API developer profile? Starts Amazon's review clock immediately. Full procedure is in the repo at `docs/amazon-sp-api-setup.md`."*

---

## Deep questions worth asking (meeting has time)

These are the "pull specific stuff out of him" questions — the answers shape the build.

### Workflow / habits
- **Walk me through your morning**: when do you usually check Amazon? What's the first thing you do?
- **Last 10 orders**: how much time did each fulfillment take? (build a baseline we can compare against)
- **The Perplexity queries that worked**: exact phrasings? (we replicate these in the Research Analyst)
- **What's your current price-setting heuristic** when you list something new? (cost × 3? match buy box? intuition?)

### Historical performance
- **Which 3 SKUs are you most proud of selling well?** Why did those work?
- **Which SKUs flopped?** Why — bad timing, wrong price, wrong brand?
- **Best-margin brand you carry?** (might indicate LOA pursuit priority)
- **Worst-margin brand you carry?** (candidates to de-list)
- **Biggest single arbitrage win ever?** What was the signal you caught?

### Account health
- **Have you ever been close to an Amazon suspension?** What triggered it?
- **Any IP complaints received?** From which brands?
- **Any expired-product complaints?** How did you resolve?

### Seasonality intuition
- **What products are you getting ready to stock up for?** (reveals his seasonal intuition)
- **Any product you KNOW is about to spike in demand in the next 60 days?** (we can test the forecaster against his gut)

### Tech inventory
- **Are you using Helium 10 / Jungle Scout / Keepa today?**
- **Any spreadsheets you maintain?** (we can import them)
- **Who has access to your Amazon Seller Central right now?** (baseline for who else touches it)

<!-- 2026-04-30: removed; Mac mini no longer in architecture. -->

### About Kaleem's preferences
- **Volume or margin**: if you had to pick, more sales at lower margin or fewer at higher? (tunes the scoring)
- **Risk tolerance**: if the system says "list at $60, 60% chance it sells at this price in 48h" — are you in?
- **Notification style**: do you want to be interrupted (push, SMS) or do you prefer batch digests?
- **Autonomy appetite**: once you trust the system, do you want it acting on its own within rules, or always approve?

---

## Timeline to set expectation

```
Week 0: Today (meeting)
 ┌──────────────────────────────────────────────────────────────┐
 │  TODAY IN THE MEETING:                                        │
 │  • NDA signed (or scheduled)                                  │
 │  • ABC email ready to forward                                 │
 │  • Brand list + TIC shortlist committed                       │
 │  • SP-API developer application submitted to Amazon           │
 └──────────────────────────────────────────────────────────────┘

Week 1-2: Build Phase 1 (Dev's focused work)
 ┌──────────────────────────────────────────────────────────────┐
 │  • Supabase schema + migrations                              │
 │  • Next.js app (Inbox, Chat, Preview)                        │
 │  • Business Chatbot functional                               │
 │  • Deploy to Render                                          │
 │  • Kaleem can sign in and chat                               │
 │                                                               │
 │  In parallel (Amazon's side):                                │
 │  • SP-API developer profile reviewed (5-14 business days)    │
 │                                                               │
 │  In parallel (Kaleem's side):                                │
 │  • ABC email sent, awaiting reply                            │
 │  • EzriRx signup started if not already a member             │
 └──────────────────────────────────────────────────────────────┘

Week 2-3: SP-API credentials + app wiring
 ┌──────────────────────────────────────────────────────────────┐
 │  • Developer Profile approved                                │
 │  • Create Private SP-API app, authorize, save 3 credentials  │
 │  • Share via 1Password (after NDA)                           │
 │  • Wire credentials into Render environment                  │
 │  • Chatbot gains live Amazon data tools (orders, pricing)    │
 └──────────────────────────────────────────────────────────────┘

Week 4-6: Real agents + all data sources
 ┌──────────────────────────────────────────────────────────────┐
 │  • Minicrew Linux port lands (external team)                 │
 │  • Deploy minicrew worker as Render worker service           │
 │  • Keepa subscription active                                 │
 │  • EzriRx EDI onboarded                                      │
 │  • First daily morning briefing in his real Inbox            │
 │  • Repricer running against live listings via SP-API         │
 └──────────────────────────────────────────────────────────────┘

Week 8: Full operation
 ┌──────────────────────────────────────────────────────────────┐
 │  • All 9 agents live                                         │
 │  • Orders flowing through Fulfillment Ops                    │
 │  • Account Health monitoring + protecting                    │
 │  • Memory accumulating real episodic data                    │
 │  • Weekly Reflector distilling playbooks                     │
 └──────────────────────────────────────────────────────────────┘

Month 2-3: $10k-on-Amazon demo
 ┌──────────────────────────────────────────────────────────────┐
 │  • One month of real operation                               │
 │  • Show his MSF friend: attributable revenue report          │
 │  • This is the "buy me software" moment                      │
 └──────────────────────────────────────────────────────────────┘
```

---

## Cost reality (if he asks)

```
  Steady-state monthly cost
  ──────────────────────────
  Claude API (Opus + Haiku mix)        $200 - $400   ████████████
  Supabase (DB + queue + memory)       $25           █
  Render (web service)                 $20 - $40     ██
  Render (worker service)              $10 - $25     █
  Render Cron Jobs (~$1/mo each)       $2            █
  Backblaze B2 (encrypted backups)     $1 - $3       █
  Keepa (Amazon historical data)       $55           ██
  EzriRx (wholesaler aggregator)       $50 - $150    █████
  SMS via Twilio                       $10 - $20     █
  ──────────────────────────────────────────────────────────────
  TOTAL                                $373 - $720/mo

  One-time: $0 (Render subdomain, no domain purchase, no on-prem hardware needed)
```

**The break-even math:** one Tinactin-style arbitrage sale ($51 - $7 cost = $44 margin) covers a full day of running costs. A single good arbitrage week covers the monthly run rate.

---

## His action items coming out of this meeting

```
  Critical (this week):
  ─────────────────────
  ☐ Forward ABC data-exchange email to his rep
  ☐ Send similar emails to McKesson + Cardinal reps (I'll draft)
  ☐ Sign the NDA
  ☐ Submit SP-API developer profile (10 min)

  Important (this week if possible):
  ──────────────────────────────────
  ☐ Sign up for EzriRx if not a member
  ☐ Provide TIC supplement brand list
  ☐ Provide top 20-30 brand overall list
  ☐ Pull blind-ship confirmations in writing

  Sunday meeting agenda to lock:
  ──────────────────────────────
  ☐ Payment structure (first month)
  ☐ Share Amazon + eBay credentials (after NDA)
  ☐ Discuss halal vitamin supplier sourcing
  ☐ TikTok store Thursday meeting prep
```

---

## Parallel tracks (name them, don't solve today)

- **Halal/kosher private-label vitamins** — Thursday meeting. Utah/Nevada/Colorado supplier. Apollo CRM outreach.
- **TikTok store + AI video gen** — also Thursday. UGC reference-video approach.
- **Drug design / compound isolation research** — separate funding (grants), May/June structure work.

---

## The meeting's one-sentence goal

**Walk out with: NDA in motion, ABC email sent, SP-API developer application submitted, brand list captured.**

Everything else (architecture explanation, agents, timeline) is context to make those four commitments feel safe and obvious.
