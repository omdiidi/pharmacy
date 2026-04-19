# Meeting Prep — Kaleem · 2026-04-20

Short sheet for the in-person meeting. No fluff. Heavy on visuals so you can show, not just tell.

---

## TL;DR

```
┌─────────────────────────────────────────────────────────────┐
│ WHAT'S DONE                      WHAT'S NEEDED FROM KALEEM   │
│                                                              │
│ ✓ Plan complete (v4, 3 reviews) │ 1. Send ABC data email    │
│ ✓ Repo live: omdiidi/pharmacy   │ 2. NDA signed             │
│ ✓ Architecture finalized        │ 3. Brand list (top 20-30) │
│ ✓ Cost estimate: $300-600/mo    │ 4. TIC supplement check   │
│ ✓ Ready to build tomorrow       │ 5. Amazon creds on mini   │
│                                  │ 6. Give me remote access  │
└─────────────────────────────────────────────────────────────┘
```

Plan is done. Live in the repo at **https://github.com/omdiidi/pharmacy**. Three reviewer passes, 9/10 implementation confidence. I need 6 commitments from him in this meeting to unblock the 4-6 week path to a first real agent briefing. **Big ask this meeting: set up remote access to his Mac mini + log Amazon in there. That unlocks an immediate demo path parallel to the SP-API paperwork.**

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

```
                   ┌─────────────────────────────────────┐
                   │   SUPABASE (cloud — always-on)       │
                   │                                      │
                   │   Queue + data + memory + backup     │
                   │   $25/mo. One source of truth.       │
                   └───┬──────────────────────────┬──────┘
                       │                          │
         ┌─────────────┘                          └──────────────┐
         │ reads/writes                          reads/writes    │
         ▼                                                       ▼
┌──────────────────────────┐                  ┌──────────────────────────┐
│  RENDER (cloud web host) │                  │  KALEEM'S MAC MINI       │
│                          │                  │  (Linux Mint, at pharmacy)│
│  • Kaleem's web app      │                  │                           │
│  • Sign-in + Inbox + Chat│                  │  • Runs the 9 AI agents  │
│  • Business Chatbot      │                  │    as background jobs    │
│  • Works on phone + lap- │                  │  • Pulls daily wholesaler │
│    top anywhere          │                  │    data via secure SFTP   │
│                          │                  │  • Weekly encrypted       │
│  $20-40/mo               │                  │    backup to local disk  │
└──────────────────────────┘                  │                           │
                                              │  $0 (he already owns it)  │
                                              └──────────────────────────┘
```

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

## The Mac mini — what runs on it, why his is perfect

### What goes on the mini

```
┌─────────────────────────────────────────────────────────────┐
│                  KALEEM'S MAC MINI (Linux Mint, Intel 8GB)  │
│                                                              │
│  ┌─────────────────────┐  ┌─────────────────────────────┐   │
│  │ minicrew worker     │  │ SFTP pollers                │   │
│  │ (Python)            │  │ (daily pulls)               │   │
│  │                     │  │                             │   │
│  │ polls Supabase ─────┼──┼─> EzriRx EDI feed          │   │
│  │ for jobs every 5s   │  │ ─> ABC direct EDI (later)  │   │
│  │                     │  │                             │   │
│  │ spawns Claude Code  │  └─────────────────────────────┘   │
│  │ session per job     │                                     │
│  │                     │  ┌─────────────────────────────┐   │
│  │ [tmux window 1]     │  │ Weekly encrypted backup     │   │
│  │ [tmux window 2]     │  │ (pg_dump → local disk)      │   │
│  │ [tmux window 3]     │  │                             │   │
│  │                     │  │ sha256 log + size check     │   │
│  └─────────────────────┘  └─────────────────────────────┘   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Chrome profile (logged into Amazon Seller, eBay,    │    │
│  │ ABC Order, etc.) ← session we can drive remotely    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Why his existing mini is ideal

| Advantage | Why it matters |
|---|---|
| **Already owns it** | $0 hardware cost |
| **Linux Mint** | Python + cron + tmux + systemd out of the box |
| **Sits at the pharmacy** | Close to his actual business, low-latency |
| **Off-hours idle** | Runs heavy agent work during quiet pharmacy hours |
| **Not public-facing** | Behind his pharmacy internet, no port forwarding, no firewall gymnastics |
| **Isolated from Pioneer Rx** | Prescriptions can never touch this system |

### What we install (~1 hour setup)

```
  Step 1. Install Python 3.11+ + Claude Code CLI                  (10 min)
  Step 2. Clone minicrew-config repo                              ( 2 min)
  Step 3. Set up .env (Supabase + Claude API keys)                (10 min)
  Step 4. Install systemd service (auto-start on boot)            ( 5 min)
  Step 5. Install remote access (Tailscale + VNC / Rustdesk)      (15 min)
  Step 6. Set up Chrome profile, log into Amazon Seller + eBay    (10 min)
  Step 7. Run first test job end-to-end                           (10 min)
  ────────────────────────────────────────────────────────────────────────
                                                                  ~60 min
```

### Resource impact

```
  Idle:           ~5% CPU, ~500MB RAM
  Per-job:        ~25% CPU, ~1.5GB RAM (Claude Code session)
  Concurrent:     3-4 jobs comfortably on 8GB
  Backup night:   spikes briefly during pg_dump
  Disk usage:     ~50GB/year for backups
```

---

## 🔑 The big meeting ask: remote access + Amazon logged in

This is the smart move that unlocks an immediate demo path **parallel to SP-API paperwork**.

### Why

```
 SP-API path (official, what we pay to use long-term)
 ─────────────────────────────────────────────────────
 Submit ungating docs ──▶ Amazon review (1-4 weeks) ──▶ API access ──▶ wire
                         └─────────┬──────────┘
                               waiting...
                               
 Remote-browser path (bridge, works in days)
 ─────────────────────────────────────────────────
 Remote access to mini ──▶ Log Amazon into Chrome ──▶ AI drives browser
                                                       via Chrome MCP,
                                                       shows demo THIS WEEK
```

While Amazon reviews the gating paperwork, **we set up remote access + log Amazon into a Chrome profile on his Mac mini**, and the AI drives the browser to do research / listing / repricing. It's fragile long-term (Amazon changes the UI, Captchas hit, sessions expire) — but it gets Kaleem a real demo in days, and **smooths the transition to SP-API once gating approves**.

### What to set up during the meeting (or right after) — Chrome Remote Desktop

Chrome Remote Desktop (CRD) is the pick: free, Google-hosted, runs in Chrome, no firewall config, works on Linux Mint. One tool solves it.

```
  1. On Kaleem's Mac mini:
     → Install Chrome if not already there (Linux Mint standard)
     → Go to remotedesktop.google.com/host
     → Click "Set up remote access" → downloads .deb, installs
     → Sign in with a dedicated Google account
        (create kaleempharmacy.automation@gmail.com — clean revoke later)
     → Name the host "pharm1-mini"
     → Set a 6-digit PIN (we save this in our 1Password or equivalent)

  2. Create a dedicated Chrome profile called "pharm1-automation"
     → log into Amazon Seller Central + eBay + ABC Order + Parmed + others
     → this profile is what our agents will drive
     → kept completely separate from Kaleem's personal Chrome

  3. On our side (Dev + Nick):
     → go to remotedesktop.google.com/access
     → sign into the same Google account
     → "pharm1-mini" appears in the list
     → click, enter PIN, we're in — see his full desktop

  4. Test end to end:
     → open Chrome on the mini from our side
     → load Amazon Seller Central (already logged in via the automation profile)
     → confirm the session is stable for 10+ minutes

  5. Install minicrew worker later (when Linux port lands):
     → we drive the install via the CRD session
     → Kaleem can watch live if he wants
```

### Security guarantees to tell him (Chrome Remote Desktop)

```
  ✓ Uses his Google account — auth is Google-level (2FA required)
  ✓ PIN required for every connection from our side
  ✓ He sees a persistent banner on the mini while we're connected
     → he knows when we're driving, end session with one click
  ✓ All traffic encrypted end-to-end through Google's infrastructure
  ✓ No VPN, no port forwarding, no public IP exposed
  ✓ No credentials leave his Mac mini — browser logins stay LOCAL
  ✓ Browser automation happens on HIS machine, not ours
     (we just see the screen, can click, but nothing runs on our side)
  ✓ To revoke access forever: sign out of the Google account on the mini,
     or delete the host from remotedesktop.google.com/host (one click)
  ✓ Nothing Rx-related touches this setup — Pioneer runs on a separate PC
```

### Why Chrome Remote Desktop vs alternatives

| Option | Setup time | Cost | Kaleem friction | Our use |
|---|---|---|---|---|
| **Chrome Remote Desktop** | 10 min | Free | Low — already has Chrome | Full desktop, browser driving, terminal |
| Tailscale + VNC | 30 min | Free | Med — two tools to install | Network tunnel + VNC |
| TeamViewer | 15 min | Paid after trial | Low | Similar to CRD |
| AnyDesk | 15 min | Free personal | Low | Similar to CRD |
| SSH only | 5 min | Free | Low | Terminal only — no GUI |

**CRD wins** on: simplicity (one tool), already-familiar ecosystem (Google), no paid tier, no network config, full desktop.

### What it unlocks (demo-able within a week)

```
  BEFORE SP-API:                          AFTER SP-API (4-6 weeks later):
  ────────────────────────────            ──────────────────────────────
  • AI researches via Perplexity          • Same + direct Amazon API access
  • AI drives Chrome to read his          • No browser automation needed
    Amazon Seller data
  • AI can compose listings but           • Listings post via API
    he clicks Submit himself
  • Kaleem watches it happen live         • Fully autonomous (with approvals)
```

### If he's hesitant about remote access

Alternatives to offer:
- **Pair programming over Zoom**: he shares screen, I tell him what to click. Slower but zero tool install.
- **He does it himself**: I send him setup instructions, he clicks through. Removes our involvement but adds latency for every iteration.
- **Delay to post-NDA**: wait until NDA signed, then set up. 100% legitimate — NDA first is his call.

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

### 6. Remote access + Amazon logged in

**What:** See big section above. Unlocks demo within a week, parallel to SP-API paperwork.

**Ask:** *"After the NDA, can we spend 30 minutes setting up Tailscale + getting Amazon Seller logged in on your mini? That lets us show you something running against your real account within days, not weeks."*

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

### Infrastructure questions for the Mac mini
- **What's the mini's IP / hostname on your network?**
- **Is the pharmacy internet reliable?** Ever drops for hours? (affects whether we need cloud failover)
- **Is there a second monitor / keyboard for the mini during setup?**
- **Who physically has access to the mini at the pharmacy?** (security consideration)

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
 │  • Remote access set up on the mini                           │
 │  • Amazon logged into Chrome profile on the mini              │
 └──────────────────────────────────────────────────────────────┘

Week 1-2: Build Phase 1 (Dev's focused work)
 ┌──────────────────────────────────────────────────────────────┐
 │  • Supabase schema + migrations                              │
 │  • Next.js app (Inbox, Chat, Preview)                        │
 │  • Business Chatbot functional                               │
 │  • Deploy to Render                                          │
 │  • Kaleem can sign in and chat                               │
 │                                                               │
 │  In parallel (Kaleem's side):                                │
 │  • ABC email sent, awaiting reply                            │
 │  • SP-API gating paperwork submitted to Amazon               │
 │  • EzriRx signup started if not already a member             │
 └──────────────────────────────────────────────────────────────┘

Week 3-4: Browser-driven demo (before SP-API approves)
 ┌──────────────────────────────────────────────────────────────┐
 │  • AI drives Chrome remotely on his mini                     │
 │  • Research Analyst produces first real briefing using       │
 │    Perplexity + browser automation                           │
 │  • Kaleem sees: "here are 3 things to list today, here's why"│
 │  • He clicks List → AI drives browser to post                │
 │  • First real demo he can show to his MSF friend             │
 └──────────────────────────────────────────────────────────────┘

Week 4-6: Real agents + APIs
 ┌──────────────────────────────────────────────────────────────┐
 │  • Minicrew Linux port lands (external team)                 │
 │  • SP-API approved → swap browser automation for API calls   │
 │  • Keepa subscription active                                 │
 │  • EzriRx EDI onboarded                                      │
 │  • First daily morning briefing in his real Inbox            │
 │  • Repricer running against live listings                    │
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
  Render (web hosting)                 $20 - $40     ██
  Keepa (Amazon historical data)       $55           ██
  EzriRx (wholesaler aggregator)       $50 - $150    █████
  SMS via Twilio                       $10 - $20     █
  ──────────────────────────────────────────────────────────────
  TOTAL                                $360 - $690/mo

  One-time: $0 (his mini, Render subdomain, no domain purchase)
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
  ☐ Allow remote access setup on the mini

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

**Walk out with: NDA in motion, ABC email sent, remote access to the mini set up, brand list captured.**

Everything else (architecture explanation, agents, timeline) is context to make those four commitments feel safe and obvious.
