# Amazon SP-API Setup Guide

How Kaleem gets Amazon API access so our system can read his orders, listings, competitor prices, and account health — and publish listing + price changes.

No fluff. This is the exact procedure.

---

## TL;DR

```
  What:  Amazon Selling Partner API (SP-API) credentials
  Cost:  Free
  Kaleem's time:  ~30-60 minutes
  Amazon approval time:  1-4 weeks (submit ASAP; runs in parallel with our build)
  Path:  Private (Self-Authorization) — he registers the app for his own account

  Credentials we receive at the end:
  • LWA Client ID
  • LWA Client Secret
  • Refresh Token
  • (Optional) Seller Central user invite with scoped permissions
```

---

## Prerequisites (verify before starting)

- [ ] **Professional Seller Central account** (not Individual) — he has this
- [ ] **Business phone + email** matching Seller Central registration
- [ ] **Bank account on file** for seller payouts (he has this)
- [ ] **Valid tax information** (W-9) on file (he has this)
- [ ] **Amazon account in good standing** (no recent suspensions) — verify in Account Health

If any of the above are missing, fix before starting.

---

## The 5-step procedure

### Step 1 — Register as a developer on Kaleem's seller account

1. Log into Seller Central
2. Navigate to: **Apps & Services → Develop Apps**
3. Click **"Register as a developer"** if prompted
4. Fill in the Developer Profile form:
   - **Developer name:** [Pharmacy legal name, e.g., "St. Mark's Pharmacy"]
   - **Business address:** [exact address on Seller Central]
   - **Website:** [pharmacy website URL — needs to be live]
   - **Email:** [business email]
   - **Phone:** [business phone]
   - **Are you developing apps for your own use, for sale, or both?** → **"For your own use"**
   - **Data use categories:** Check all that apply for our build:
     - ☑ **Product Information** (listings, catalog)
     - ☑ **Pricing Information** (competitor pricing, repricing)
     - ☑ **Orders** (new orders, fulfillment data)
     - ☑ **Inventory Information** (FBA + FBM stock)
     - ☑ **Reports** (sales/traffic, settlement)
     - ☑ **Notifications** (order events, pricing events)
     - ☑ **Personal Information** (customer names/addresses for shipping) — ⚠ this triggers the "restricted" data role, requires additional questionnaire
5. Submit

Amazon review: **5-10 business days** for Developer Profile approval.

### Step 2 — Register a Private (Self-Authorized) app

After Developer Profile is approved:

1. Seller Central → **Apps & Services → Develop Apps**
2. Click **"Add new app client"**
3. Fill in:
   - **App name:** `pharm1-automation` (or whatever — internal only)
   - **API Type:** **SP-API**
   - **App type:** **Private (Self-authorization)** ← critical
   - **Roles (select all we need):**
     - ☑ Product Listing
     - ☑ Pricing
     - ☑ Inventory and Order Tracking
     - ☑ Amazon Fulfillment
     - ☑ Buyer Communication
     - ☑ Brand Analytics (if Kaleem has Brand Registry)
     - ☑ Finance and Accounting
     - ☑ Direct to Consumer Shipping
     - ☑ Manage Orders
4. Review + submit

Amazon generates the app instantly. Save:
- **LWA Client ID**
- **LWA Client Secret** (shown once — download + save in password manager)

### Step 3 — Authorize the app for Kaleem's seller account

1. Seller Central → **Apps & Services → Develop Apps**
2. Find your app → click **"Authorize"**
3. Confirm the authorization dialog
4. Amazon generates the **Refresh Token** (shown once — save immediately)

This three-part credential bundle (Client ID + Client Secret + Refresh Token) is what our system uses to authenticate with SP-API for Kaleem's account.

### Step 4 — Handle "Restricted" role if prompted

If we selected data-use categories involving customer PII (addresses, names), Amazon requires an additional security questionnaire:

- Describe how we store customer PII (encrypted at rest, access-controlled)
- Describe data retention policy (minimum necessary, deletion on request)
- Confirm we don't share customer PII with third parties
- Confirm we have breach notification procedures

We draft answers; Kaleem submits.

Amazon review: **additional 3-7 days** for restricted role approval.

### Step 5 — Share credentials with us securely

**After NDA is signed:**

1. Kaleem puts the 3 credentials into **1Password** (or similar shared vault):
   - `AMAZON_LWA_CLIENT_ID=...`
   - `AMAZON_LWA_CLIENT_SECRET=...`
   - `AMAZON_REFRESH_TOKEN=...`
2. Shares the vault item with our email
3. We pull into our Render environment variables — never in the repo, never in email

**Never share credentials via:**
- Email (plain text)
- Slack / Teams (unless E2E encrypted channel)
- Screenshots

---

## Parallel: category ungating (likely needed)

Separate from the developer/app setup. Kaleem needs to be ungated in:

- ✅ **Health & Personal Care** (if not already)
- ✅ **Vitamins & Dietary Supplements** (since Dec 2025 expansion — all supplements gated)
- ✅ **Any specific sub-category** he plans to list in (sexual wellness, weight management, sports nutrition — these have extra requirements)

### What he needs for ungating submission

```
  ☐ Professional seller plan active (he has)
  ☐ Commercial invoices:
     - From authorized supplier (ABC / McKesson invoices are acceptable,
       though not on Amazon's pre-recognized list — expect extra scrutiny)
     - Dated within the last 180 days
     - Showing 10+ units of the product purchased
     - Business name/address EXACTLY matching Seller Central registration
     - Includes supplier business name, phone, email, address
  ☐ For supplements (Dec 2025 requirement):
     - Certificate of Analysis from NSF / Eurofins / UL Solutions
       per BRAND being listed
     - Cert must be within 12 months of issuance
  ☐ For some sub-categories: additional TIC-verified COA showing
    no undeclared APIs (for sexual / weight-loss / sports supplements)
```

### Ungating submission

1. Seller Central → **Inventory → Add a Product**
2. Search for the product he wants to list
3. When "Show limitations" appears, click **"Request Approval"**
4. Upload invoices + COA where prompted
5. Submit

Amazon review: **1-3 weeks per sub-category**. Rejections common on first pass (invoice format, supplier not recognized) — resubmit with clarification.

### Expect 1-3 rejections before approval

Common reasons + fixes:

| Rejection reason | Fix |
|---|---|
| Invoice format not accepted | Make sure it has supplier letterhead, phone, email, address, dates, SKU/UPC, quantities |
| Supplier not recognized | Cite "licensed pharmaceutical wholesaler, DEA-registered" in resubmission notes |
| Invoice too old | Get a newer one (ABC can regenerate) |
| Business name mismatch | Confirm Seller Central shows EXACT legal name on invoices |
| Missing 10-unit minimum | Bundle invoices or wait for next order |
| Missing COA for supplement | Request from supplier or manufacturer directly |

---

## How we use the credentials

Once we have the 3 credentials, our Render web service uses them to:

```
  On every order (webhook):       GET /orders/v0/orders/{orderId}
  Price check (every 5 min):      POST /products/pricing/v2026/competitive-summary
  Publish listing changes:        PUT /listings/2021-08-01/items/{sku}
  Publish price changes:          PUT /products/pricing/v0/prices
  Pull account health:            GET /account-health/v1/accountHealthMetrics
  Subscribe to order events:      POST /notifications/v1/subscriptions
  Pull sales reports:             POST /reports/2021-06-30/reports
```

All calls authenticate via the Refresh Token (exchanged for short-lived Access Tokens automatically by the Anthropic SDK's LWA helper).

---

## What Kaleem can revoke / monitor

- **Revoke app authorization:** Seller Central → Apps & Services → Manage Your Apps → click app → "Revoke authorization." Takes effect immediately.
- **View API call logs:** Seller Central → Reports → Selling Partner API Performance — shows every call our system makes
- **Usage / rate limits:** Amazon auto-throttles per endpoint; if we're hitting limits we ask Amazon for increased throughput

---

## Timeline (realistic)

```
 Day 1 (today):      Kaleem submits Developer Profile
 Day 7-10:           Developer Profile approved
 Day 10:             Kaleem creates app + authorizes → gets credentials
 Day 10-17:          (If restricted role) Restricted questionnaire submitted + approved
 Day 17:             Credentials shared with us via 1Password (after NDA)

 Parallel path (ungating):
 Day 1:              Submit H&PC + Supplements ungating with invoices
 Day 7-21:           Approvals roll in (expect some rejections + resubmits)

 Net: 2-3 weeks to full API access.
```

Start both processes today — they run in parallel with Phase 1 build.

---

## FAQ

**Q: Is there a monthly fee?**
SP-API itself is free. Professional seller plan is $39.99/mo (Kaleem already pays this).

**Q: Can we use it without Brand Registry?**
Yes. Brand Registry unlocks some extra features (Brand Analytics, A+ content) but isn't required for our Phase 2 scope.

**Q: What if Amazon asks what our "end product" is?**
"Internal automation for a single pharmacy's Amazon seller operations. Not a public product."

**Q: Do we need AWS credentials?**
No — SP-API dropped the AWS IAM signature requirement. Just LWA credentials.

**Q: What's the difference between Private and Public apps?**
Private = for one specific seller account (Kaleem's). Simpler. Public = Amazon app marketplace listing for external users. We don't need that.

**Q: Can we speed up the Amazon review?**
Not officially. Submitting a clean application the first time is the best bet. Kaleem's licensed-pharmacist status + legitimate business doesn't directly speed it up but makes rejection less likely.

**Q: What happens if Amazon denies the Developer Profile?**
Rare for a legitimate seller with good standing. If it happens: they email a reason, we address it, resubmit. Can also escalate via Seller Central contact form.

**Q: Should we start building without this?**
Phase 1 build (web app + chatbot + schema) doesn't need SP-API. Kicks off immediately. SP-API application runs in parallel so credentials arrive around the time Phase 2 needs them.

---

## The one-sentence version for Kaleem

> *"Go to Seller Central → Apps & Services → Develop Apps → register as a developer → create a private SP-API app → authorize it → send me the three credentials in 1Password after we sign the NDA. ~30 minutes of your time, 2-3 weeks for Amazon to approve. Start today so it runs in parallel."*

---

## What to do right now

1. Kaleem logs into Seller Central
2. Navigates to Apps & Services → Develop Apps
3. Clicks "Register as a developer"
4. Fills in the profile per Step 1 above
5. Texts me when submitted — I'll check back in 7-10 days for next steps
