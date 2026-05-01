# Kaleem Onboarding Playbook (Dev-facing)

> **Audience:** Dev (Omid). Or any fresh Claude agent Dev hands this to.
> **Purpose:** Run the credential / account / data-feed waterfall with Kaleem so Phase 2 has live data to plug into. Self-contained — drop this into a new agent and it should know exactly what to ask, in what order, and where each artifact lands.
> **Last updated:** 2026-05-01

---

## What Kaleem already has (verified)

| Account / asset | Status | Notes |
|---|---|---|
| Amazon Seller Central — Professional | ✅ has it | ~30 OTC SKUs already listed by his technician |
| eBay seller account | ✅ has it | Status (Top Rated?) unverified |
| AmerisourceBergen (ABC / Cencora) | ✅ active customer | Primary wholesaler. Already paying for EDI 832 (price) + 846 (inventory) feeds. |
| EzriRx | ✅ has account | "Esri RX" in conversation. Foundation of multi-wholesaler integration. |
| Pharmacy locations | ✅ 2 | St. Mark's Pharmacy + Redwood Road |
| Utah pharmacist license | ✅ active | Widens supplement/OTC catalog vs unlicensed sellers |
| Pioneer / Heartland (Rx side) | ✅ separate | **DO NOT TOUCH.** Two-POS isolation — OTC-only here. |

## What Kaleem does NOT have yet (we need to drive these)

- ❌ SP-API credentials (LWA Client ID, Client Secret, Refresh Token) — start ASAP, 1–4 wk Amazon approval
- ❌ Signed NDA with us — gates everything below
- ❌ Written blind-ship confirmations from each wholesaler
- ❌ EzriRx EDI onboarding (he has the account; we need the SFTP / API endpoint live)
- ❌ Static-IP requirement answer from each wholesaler rep
- ❌ Brand audit (top 20-30 brands he sells → safe / needs-LOA / brand-actively-hunts)
- ❌ TIC certification spot-check on supplement brands
- ❌ Notification preference (SMS / email / push / digest)

---

## The waterfall — sequence matters

Each step has a **gate** (don't proceed until satisfied), an **ask** (exact ask to Kaleem), and a **capture** (where the artifact lands in this repo or `.env`).

### Step 0 — NDA executed

**Gate:** None. This is the entry point.

**Ask Kaleem:** "We need a one-page mutual NDA before you share any logins. I'll send the draft over today."

**Capture:** PDF saved to a private location (NOT committed to repo). Note in `docs/kaleem-todos.md` that NDA is signed + date.

**Why first:** Kaleem said earlier "once we sign the non-disclosure, I'll give you logins and passwords." Without this, no credentials, no SP-API, no wholesaler logins.

---

### Step 1 — Kick off SP-API gating (the long pole)

**Gate:** NDA signed.

**Ask Kaleem:** "I'm going to send you `docs/amazon-sp-api-setup.md`. It's the exact 5-step procedure to register as a developer on your Seller Central account, create a private app, and generate a refresh token. Should take 30–60 minutes. Amazon's review is 1–4 weeks — start tonight so the timer's running while we build."

**What he sends back at the end:**
- LWA Client ID
- LWA Client Secret
- Refresh Token
- Seller Central Account ID (Merchant ID)
- Marketplace ID (US: `ATVPDKIKX0DER`)

**Capture in `.env`:**
```
AMAZON_SP_API_CLIENT_ID=
AMAZON_SP_API_CLIENT_SECRET=
AMAZON_SP_API_REFRESH_TOKEN=
AMAZON_SELLER_ID=
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER
```

Add these placeholders to `.env.example` if not already there. Reference them by env var name only — never paste resolved values into chat.

**Pre-reqs to verify before he starts (in `docs/amazon-sp-api-setup.md` Step 0):**
- Professional Seller Central (he has it) ✅
- Business phone + email matching registration
- Bank account on file ✅
- W-9 on file ✅
- Account in good standing — have him check Account Health dashboard for any open issues

**Common gotcha:** Amazon may ask for a "Privacy Policy URL" during the developer profile step. If pharmacy website doesn't have one, generate a basic one and host at `<pharmacy-domain>/privacy` before submitting.

---

### Step 2 — Confirm EzriRx account + start EDI onboarding

**Gate:** NDA signed (Step 0).

**Ask Kaleem:** "You said you have an EzriRx account — log in and confirm membership tier. We need to enable EDI feeds (price catalog + inventory + ordering). EzriRx aggregates 30+ wholesalers, so this single integration replaces five separate wholesaler ones. Forward me whatever onboarding contact email EzriRx gives you."

**What we need from EzriRx (via Kaleem's account rep):**
- API base URL or SFTP host
- API key OR SFTP username + SSH public-key registration (we'll generate the keypair, send him the public key)
- List of wholesalers his account is authorized to query through them
- Schema docs for the EDI 832 (price catalog) and 846 (inventory) feeds
- Order-placement API or email-PO format

**Capture in `.env`:**
```
EZRIRX_API_BASE_URL=
EZRIRX_API_KEY=
# OR for SFTP:
EZRIRX_SFTP_HOST=
EZRIRX_SFTP_USER=
EZRIRX_SFTP_PRIVATE_KEY_PATH=
```

**If EzriRx requires a fixed source IP:** see Step 5.

---

### Step 3 — Direct ABC EDI feed (parallel track to EzriRx)

**Gate:** NDA signed. Also independent — can run in parallel with EzriRx.

**Why parallel:** EzriRx is the umbrella, but ABC is Kaleem's primary supplier and he's already paying for the 832 + 846 feeds. Direct connection is faster + richer than aggregator.

**Ask Kaleem:** "Forward `docs/emails/abc-order-data-exchange.md` to your ABC rep. Fill in your account number and rep name. The email asks them to route the EDI 832 / 846 feeds you're already paying for to an SFTP endpoint we control, plus blind-ship confirmation in writing."

**What ABC sends back:**
- SFTP credentials OR confirmation that ABC pulls from an SFTP we host
- Blind-ship confirmation (one-paragraph email) — capture and archive
- File schema (832 / 846 specifications they use)
- File drop cadence (hourly / daily?)

**Capture in `.env`:**
```
ABC_SFTP_HOST=
ABC_SFTP_USER=
ABC_SFTP_PRIVATE_KEY_PATH=
ABC_SFTP_INBOUND_PATH=
```

**Capture archive:** ABC blind-ship confirmation email → save to private location, note in `docs/kaleem-todos.md`.

---

### Step 4 — Other wholesalers (McKesson, Cardinal, Parmed, IPC)

**Gate:** ABC pattern proven (Step 3).

**Why deferred:** ABC is the highest volume; other wholesalers are tail. EzriRx (Step 2) will likely cover most of them. Only direct-connect a wholesaler if EzriRx doesn't carry them OR Kaleem uses them frequently enough to justify the lower-latency direct feed.

**Ask Kaleem (if needed):** "For [McKesson / Cardinal / Parmed / IPC] — do you order from them weekly, monthly, or rarely? If weekly, we'll send the same data-exchange request as ABC. If rarely, EzriRx is enough."

**Email drafts already exist:**
- `docs/emails/mckesson-data-exchange.md`
- `docs/emails/cardinal-data-exchange.md`
- `docs/emails/parmed-data-exchange.md`
- `docs/emails/ipc-data-exchange.md`

**Capture in `.env` (per supplier, only if direct-connecting):**
```
MCKESSON_SFTP_HOST=
MCKESSON_SFTP_USER=
# ...etc
```

---

### Step 5 — Static-IP question to every wholesaler rep

**Gate:** Step 3 in flight (ABC rep is responsive).

**Ask Kaleem to ask each rep:** "Does your SFTP / API require a fixed source IP for our connection? Yes / no answer is fine."

**Why it matters:** Decides our hosting strategy.
- All "no" → Render default egress is fine, no extra cost.
- One or more "yes" → either Render Pro ($25/mo team min) for static IP, OR a small dedicated proxy with reserved IPv4. Per-wholesaler decision.

**Capture:** Add a `static_ip_required` boolean column to a notes file at `docs/wholesaler-static-ip-status.md` (create if missing). Update as answers come in.

---

### Step 6 — Amazon Seller Central credentials OR scoped user invite

**Gate:** NDA signed.

**Why two options:** SP-API alone covers ~80% of what we need. The remaining 20% (some account-health views, brand registry actions, certain reports) requires UI / cookie access. Easier to grant us a user invite than to share his master password.

**Ask Kaleem:** "In Seller Central, go to Settings → User Permissions → Add a user. Invite me with these scoped permissions: Catalog (View+Edit), Inventory (View+Edit), Orders (View+Edit), Reports (View), Account Health (View). Don't grant Tax or Banking. We'll only use it for things SP-API can't do."

**Capture:** Login URL + email used. Note in private credentials file (NOT in repo).

---

### Step 7 — eBay seller credentials (deferred — Phase 2.5)

**Gate:** Phase 2 SP-API integration is working.

**Why deferred:** Amazon is the primary marketplace. eBay is volume #2 but the listing flow there is similar enough that we can copy patterns once Amazon is solid. Don't onboard eBay creds until we're actually building the eBay integration.

---

### Step 8 — Brand audit (the IP-complaint risk filter)

**Gate:** Steps 1–3 in flight.

**Why:** Pfizer, J&J's OTC portfolio, Pharmavite (Nature Made), Pure Encapsulations, Garden of Life, Nestlé brands actively pursue unauthorized resellers on Amazon **even with valid wholesaler invoices**. Being a McKesson customer ≠ being an Amazon authorized reseller. His Amazon account could get hit with IP complaints.

**Ask Kaleem:** "Send me your top 20–30 brands by SKU count or revenue. I'll classify each as: safe-to-resell / needs-Letter-of-Authorization / brand-actively-hunts. Output drives which products our system recommends listing."

**Capture in DB:** Populate `brand_authorization` table (already exists — schema migration applied). Columns: `brand`, `status` (one of `safe`, `needs_loa`, `actively_hunts`), `notes`, `loa_filename` (if obtained).

**Reference research:** Look up "Amazon IP complaint [brand name]" + Helium 10 / SellerLabs forums for each brand. ~10 min per brand.

---

### Step 9 — TIC certification spot-check on supplements

**Gate:** Step 8 in flight (brand list available).

**Why:** As of December 2025, Amazon expanded testing/inspection/certification (TIC) to ALL dietary supplements. Every supplement listing now requires a Certificate of Analysis from an ISO 17025-accredited lab, verified by NSF, Eurofins, or UL Solutions, renewed annually. Listings without it get suppressed.

**Ask Kaleem:** "Which supplement brands do you stock most? I'll spot-check TIC coverage. Big brands (Nature Made/Pharmavite, NOW Foods, Pure Encapsulations) likely already comply. Small / private-label brands often don't and would get suppressed."

**Capture in DB:** `tic_certifications` table (exists). Columns: `brand`, `verifier` (NSF / Eurofins / UL), `valid_through`, `coa_url_or_filename`.

**For Phase 3 halal/kosher private-label vitamin line:** TIC is now table-stakes. Budget for NSF or Eurofins testing as part of supplier-selection criteria.

---

### Step 10 — Blind-ship written confirmations (audit trail)

**Gate:** Each wholesaler reachable.

**Why:** Amazon's dropship policy requires Kaleem to be the seller of record. Wholesaler shipments must show pharmacy branding (not ABC / McKesson / Cardinal / Parmed). Violations = account suspension during audit. Verbal "yeah we don't put our label on it" doesn't survive an audit.

**Ask Kaleem (per wholesaler used for Amazon orders):** "Get a one-paragraph confirmation in writing — email is fine — from each wholesaler stating they blind-ship for your account. The ABC email draft already includes this ask; copy that pattern for the others."

**Capture:** Save each PDF / email export to a private folder. Note collection status in `docs/kaleem-todos.md`.

---

### Step 11 — Notification preferences

**Gate:** Steps 1–10 in flight (we're close to needing to actually notify Kaleem of things).

**Ask Kaleem:** "When a sale comes in, an opportunity surfaces, or an account-health alert fires — what channel actually catches you at the counter? Pick one or layer:
- SMS (Twilio — cheapest, fastest, intrusive)
- Email (slowest, easy to ignore)
- Native push (browser/desktop — needs you on the device)
- Daily digest only (low urgency)

Default I'd suggest: SMS for red alerts, push for yellow, email digest end-of-day for green."

**Capture in DB:** `KaleemPreferences` memory row (kind=`preferences`). Already seeded with default; replace once he answers.

**Capture in `.env` (when SMS is enabled):**
```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
KALEEM_PHONE_NUMBER=
```

---

### Step 12 — Pricing rule preferences

**Gate:** Repricer is about to ship (Phase 2 Layer 3).

**Ask Kaleem:**
- Minimum margin floor — never list below cost +X% (typical: 25%)
- Maximum scarcity premium — cap at 3× cost, or trust the model?
- Approve every recommendation manually, or auto within rules? **Default per discussion brief: propose-only forever, no auto-execute.**

**Capture in DB:** `policy_rules` table. Insert rows with `rule_type='pricing_floor'`, `value=25`; `rule_type='scarcity_cap'`, `value=3.0`; `rule_type='auto_execute'`, `value=false`.

---

## Credential checklist (one-look summary)

Copy this into the `.env.example` if any rows are missing.

```
# Amazon SP-API
AMAZON_SP_API_CLIENT_ID=
AMAZON_SP_API_CLIENT_SECRET=
AMAZON_SP_API_REFRESH_TOKEN=
AMAZON_SELLER_ID=
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER

# EzriRx (umbrella wholesaler aggregator)
EZRIRX_API_BASE_URL=
EZRIRX_API_KEY=
# OR for SFTP path:
EZRIRX_SFTP_HOST=
EZRIRX_SFTP_USER=
EZRIRX_SFTP_PRIVATE_KEY_PATH=

# ABC direct (parallel track)
ABC_SFTP_HOST=
ABC_SFTP_USER=
ABC_SFTP_PRIVATE_KEY_PATH=
ABC_SFTP_INBOUND_PATH=

# Twilio (notifications, Step 11)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
KALEEM_PHONE_NUMBER=

# Keepa (Buy Box history, Dev pays initially)
KEEPA_API_KEY=
```

Per-wholesaler direct connections (Step 4) — only add if the wholesaler is direct-connected, not via EzriRx:
```
MCKESSON_SFTP_HOST=
MCKESSON_SFTP_USER=
CARDINAL_SFTP_HOST=
CARDINAL_SFTP_USER=
PARMED_SFTP_HOST=
PARMED_SFTP_USER=
IPC_SFTP_HOST=
IPC_SFTP_USER=
```

---

## Quick state check (run this anytime)

```bash
# What's in .env right now (no secrets — just env var names that are set)
grep -E '^[A-Z_]+=' .env | grep -v '^#' | sed 's/=.*//' | sort

# What's still missing vs the checklist above
diff <(grep -E '^[A-Z_]+=' .env.example | sed 's/=.*//' | sort) \
     <(grep -E '^[A-Z_]+=' .env | sed 's/=.*//' | sort)
```

---

## What this doc deliberately does NOT cover

- Internal architecture decisions — those are in `CLAUDE.md` and `PLAN.md`
- The Kaleem-facing SP-API procedure itself — that's in `docs/amazon-sp-api-setup.md`
- Meeting prep / discussion topics — those are in `docs/kaleem-todos.md`
- Email drafts to wholesaler reps — those are in `docs/emails/*.md`

If you (fresh agent) need any of those, follow the file links. This doc is the **dispatcher** — it tells you the order to run things and where each artifact lands.

---

## Related artifacts (for the fresh agent)

- `docs/amazon-sp-api-setup.md` — exact procedure to send Kaleem (Step 1)
- `docs/emails/abc-order-data-exchange.md` — ABC EDI request email (Step 3)
- `docs/emails/{mckesson,cardinal,parmed,ipc}-data-exchange.md` — others (Step 4)
- `docs/wholesaler-questions.md` — per-rep question list (Step 5)
- `docs/kaleem-todos.md` — running internal checklist (gets updated as steps complete)
- `tmp/briefs/2026-05-01-phase-2-listing-automation.md` — Phase 2 brief that drives why we need each credential
- `CLAUDE.md` — repo-root handoff (architecture, settled decisions, never-dos)
