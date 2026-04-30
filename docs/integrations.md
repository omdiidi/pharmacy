<!-- docs/integrations.md — consolidated integration spec for minicrew, Keepa, EzriRx, Amazon SP-API, eBay, FDA, plus wholesaler approach. -->

# Integrations

One file, one section per external dependency. Each section: brief description, config required, current status (stub / active / Phase 2).

## minicrew

**What:** Job queue + worker pattern on Supabase. Repo: [github.com/omdiidi/minicrew](https://github.com/omdiidi/minicrew). Authored by Dev. Workers poll the `jobs` table, claim by `job_type`, run the matching skill via the Claude Agent SDK, write `result` JSON.

**Status:** SCHEMA INSTALLED in Phase 1 (migration `20260419000001_minicrew_schema.sql`). The `config.yaml` and 9 skill prompts are committed under `minicrew-config/`. The runtime worker is **stubbed** — `npm run worker` echoes "not yet implemented." Activates when the minicrew Linux port lands; coordinate to ensure the port targets a generic Linux container (Render-compatible) and uses `query()` from the Agent SDK, not the `claude -p` CLI.

**Jobs table shape** (the contract `enqueue_job` writes against):

```sql
create table jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,                 -- e.g. 'pharm:research-analyst'
  status text not null default 'pending', -- pending | claimed | running | completed | error | failed_permanent
  priority integer default 5,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error_message text,
  worker_id text,                         -- which worker claimed it
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  attempt_count integer default 0,
  max_attempts integer default 3,
  created_at timestamptz default now()
);
-- (plus workers, worker_events tables — see minicrew schema)
```

**Job types** (declared in `minicrew-config/config.yaml`, all prefixed `pharm:`):

| `job_type`                 | Skill                | Model              | Effort |
|----------------------------|----------------------|--------------------|--------|
| `pharm:research-analyst`   | research-analyst     | `claude-opus-4-7`  | high (fan-out across 8 category groups) |
| `pharm:repricer-sweep`     | repricer             | `claude-sonnet-4-6`| medium |
| `pharm:fulfillment-source` | fulfillment-ops      | `claude-haiku-4-5` | low    |
| `pharm:account-health`     | account-health       | `claude-haiku-4-5` | low    |
| `pharm:customer-triage`    | customer-triage      | `claude-haiku-4-5` | none   |
| `pharm:customer-draft`     | customer-draft       | `claude-sonnet-4-6`| medium |
| `pharm:bookkeeper`         | bookkeeper           | `claude-haiku-4-5` | medium |
| `pharm:portfolio-manager`  | portfolio-manager    | `claude-opus-4-7`  | high   |
| `pharm:reflector`          | reflector            | `claude-opus-4-7`  | high   |

**`enqueue_job` tool contract.** The chatbot tool (`lib/tools/enqueue_job.ts`) writes:

```typescript
await supabase.from('jobs').insert({
  job_type: `pharm:${input.job_type}`,
  payload: input.payload,
  status: 'pending',
  priority: input.priority ?? 5,
});
```

**Lifecycle.**
1. Producer (chatbot, scheduled cron, or webhook handler) inserts row with `status='pending'`.
2. Worker picks it up via `claim_next_job(...)` RPC, atomically setting `status='claimed'`, `worker_id`, `claimed_at`.
3. Worker invokes the matching skill via the Agent SDK. Sets `status='running'`, `started_at`.
4. On success, writes `result` JSON, sets `status='completed'`, `completed_at`. Skill writes briefings + inbox_items + memory rows as side effects.
5. On error, sets `status='error'`, increments `attempt_count`. If `attempt_count >= max_attempts`, transitions to `failed_permanent`.
6. Idle watchdog (per `idle_watchdog_minutes` in config.yaml) reclaims stuck jobs whose worker died mid-run.

**Config:** `minicrew-config/config.yaml`. `${SUPABASE_URL}` + `${SUPABASE_SERVICE_ROLE_KEY}` provided at runtime. `logging.redact_env` lists keys to scrub from logs.

## keepa

**What:** Amazon market data API. Buy Box history, offer count over time, BSR, FBA presence, Amazon-as-seller flag. Drives the Repricer's BB-tracking and Research Analyst's scarcity scoring.

**Status:** **Phase 2.** Subscription is $54/mo. Dev pays the card, bills back to Kaleem. Not wired in Phase 1 because no agent is running to consume the data.

**Config (Phase 2):**

```
KEEPA_API_KEY=
```

The worker (Phase 2) writes Keepa pulls into the `signals` table with `source='keepa'` and `signal_type` ∈ `{ 'bsr', 'offer_count', 'buybox_price', 'buybox_winner_channel', 'amazon_seller_flag' }`.

## ezrirx

**What:** Wholesaler aggregator. Aggregates 30+ wholesalers (ABC, Parmed, McKesson, Cardinal, IPC, smaller regionals) into one EDI/SFTP feed. Used by Fulfillment Ops to source orders and by Research Analyst to detect supply-side scarcity.

**Status:** **Phase 2.** Requires Kaleem's pharmacist account to onboard (he has the membership). Phase 1 stub — `wholesaler_stock_snapshots` is empty in dev seed; agents that read it fall back to "no supply data" reasoning.

**Config (Phase 2):**

```
EZRIRX_SFTP_HOST=
EZRIRX_SFTP_USER=
EZRIRX_SFTP_KEY_PATH=    # path inside container; key uploaded as Render secret file
```

Polling logic lives in the worker service; pulls land in `wholesaler_stock_snapshots` keyed by `product_id` (resolved via UPC lookup against `products`).

**Static-IP question:** EzriRx may require a fixed source IP for SFTP. Resolution per task T43b — verify with rep, options are (a) no static IP needed, (b) Render Pro static IP ($25/mo), (c) small dedicated proxy box ($2/mo on fly.io with reserved IPv4).

## amazon-spapi

**What:** Amazon's Selling Partner API. Listings management, orders feed, pricing updates, account health metrics, settlement reports. The system's primary write surface — every listing change and every read of "what is Amazon currently doing" goes through SP-API.

**Status:** **Phase 2.** SP-API gating takes 1-4 weeks of Amazon approval. Onboarding procedure is documented step-by-step in [amazon-sp-api-setup.md](./amazon-sp-api-setup.md).

**Config (Phase 2):**

```
AMAZON_SP_API_REFRESH_TOKEN=
AMAZON_SP_API_LWA_CLIENT_ID=
AMAZON_SP_API_LWA_CLIENT_SECRET=
AMAZON_SELLER_ID=
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER     # US
```

**Phase 2 surfaces:**

- **Webhook listener (web service):** `/api/webhooks/sp-api/orders`, `/api/webhooks/sp-api/health`. Verifies signature, enqueues `pharm:fulfillment-source` (orders) or `pharm:account-health` (health events).
- **Listings sync (worker):** scheduled job pulls active listings, reconciles against our `listings` table.
- **Settlement reports (worker, Bookkeeper):** bi-weekly payout pull for line-level fee reconciliation.
- **Pricing writes (executor, Phase 2):** when Kaleem approves a Repricer briefing, executor calls `pricing/v0/itemOffers` to push the new price.

## ebay-api

**What:** eBay Trading API + Sell APIs. Listings, orders, messaging. Targeted as the second marketplace after Amazon.

**Status:** **Phase 2** (after SP-API stabilizes). Top Rated Seller status applies — eBay is friendlier to FBM-only sellers than Amazon, but lower volume.

**Config (Phase 2):**

```
EBAY_APP_ID=
EBAY_CERT_ID=
EBAY_DEV_ID=
EBAY_USER_TOKEN=
EBAY_RU_NAME=
```

Same listing/order/message webhook + executor pattern as Amazon, mirrored.

## fda-apis

**What:** FDA Drug Shortage list (openFDA) and Recall Enforcement Reports. Both feed Research Analyst (recalls auto-block listings; shortages surface OTC adjacency opportunities) and Account Health (recalls trigger pause on active listings).

**Status:** **Phase 2.** Free, no auth required, but rate-limited. Polled daily by the worker.

**Config:** none (public endpoints).

The worker writes pulls to `signals` with `source ∈ { 'fda_shortage', 'fda_recall' }`. The Research Analyst's Tier 0 policy filter cross-references active recalls before publishing any briefing. The Account Health reactive job fires `briefing_type='fda_recall_triggered'` for any active listing matching a recalled SKU.

## Wholesaler integration approach

EzriRx is the primary path for most wholesalers. ABC also has a direct EDI option (parallel track — see [emails/abc-order-data-exchange.md](./emails/abc-order-data-exchange.md) for the rep email draft).

**Per-wholesaler integration plan** (see also [wholesaler-connections.md](./wholesaler-connections.md) for the email + onboarding plan and [wholesaler-questions.md](./wholesaler-questions.md) for the questions to ask each rep):

| Wholesaler          | Path                  | Static IP needed? | Status      |
|---------------------|-----------------------|-------------------|-------------|
| AmerisourceBergen   | EzriRx + direct EDI   | TBD (T43b)        | Email sent  |
| McKesson            | EzriRx                | TBD (T43b)        | Email drafted |
| Cardinal Health     | EzriRx                | TBD (T43b)        | Email drafted |
| Parmed              | EzriRx                | TBD (T43b)        | Email drafted |
| IPC                 | EzriRx                | TBD (T43b)        | Email drafted |

**Static-IP requirement check (T43b).** Pending verification with each wholesaler rep (ABC, McKesson, Cardinal, Parmed, IPC) on whether SFTP / EDI feeds require a fixed source IP. Three outcomes possible:

- **(a)** All wholesalers reachable via EzriRx aggregator only → no static IP needed, no action.
- **(b)** One or more wholesalers require fixed IP and Render Pro static-IP feature suffices ($25/mo team minimum, but IP changes on regional redeploy — pin region in Render config).
- **(c)** Wholesaler IT requires IPs in writing 2 weeks ahead and demands stability across deploys → provision a small dedicated proxy box (fly.io with reserved IPv4 ~$2/mo, or any VPS) and route EDI traffic through it.

Outcome to be filled in here once reps confirm.

## See also

- [architecture.md](./architecture.md) — where each integration plugs into the overall system.
- [amazon-sp-api-setup.md](./amazon-sp-api-setup.md) — step-by-step SP-API onboarding for Kaleem.
- [wholesaler-connections.md](./wholesaler-connections.md), [wholesaler-questions.md](./wholesaler-questions.md), [emails/](./emails/) — wholesaler outreach materials.
- [agents/](./agents/) — which agent consumes which integration.
