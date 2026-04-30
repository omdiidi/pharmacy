<!-- docs/open-questions.md — running list of unresolved decisions and pending asks (Kaleem-side and dev-side). -->

# Open Questions

Running list of things still to decide. Each item has a current default so nothing blocks the build, but the user may want to override before a default ships.

## Plan-level [NEEDS CLARIFICATION] markers

These come from `tmp/ready-plans/2026-04-19-phase-1-mvp.md`. Defaults exist for all four — Phase 1 ships without resolution but cleaner answers may exist.

### 1. Backup target — B2 vs R2 vs S3?

**Default:** Backblaze B2.

**Why:** Object Lock has been GA on B2 since 2020 (more limited on Cloudflare R2). B2 is cheaper at our scale ($0.006/GB/mo storage, $0.01/GB egress vs R2 at $0.015/GB free egress; AWS S3 priciest). S3-compatible API means standard `aws-cli` works.

**Override path:** change `B2_*` env vars + the `--endpoint-url` in `scripts/backup-supabase.sh` + the bucket recipe in [render-setup.md](./render-setup.md). The backup script doesn't care which S3-compatible target it points at.

### 2. Backup account separation level — separate Backblaze account or shared?

**Default:** Separate. New email alias (`<owner>+backup@...`), new 2FA, no cross-account invitation, true air-gap.

**Why:** A compromise of the Supabase-tier account credentials shouldn't grant access to the off-cloud backup. Keeping the accounts unrelated is the simplest way to ensure that.

**Override path:** if Kaleem strongly prefers a single Backblaze account, document the trade-off in `audit_log` and use IAM-style key scoping instead. Less robust but simpler ops.

### 3. Static egress IP — provision now or wait for wholesaler-rep confirmation?

**Default:** Wait. Added to Kaleem's todo list ([kaleem-todos.md](./kaleem-todos.md)). T43b in the plan calls for verifying with each rep (ABC, McKesson, Cardinal, Parmed, IPC) before paying for Render Pro static IP ($25/mo team minimum) or provisioning a small dedicated proxy ($2/mo on fly.io with reserved IPv4).

**Override path:** if at any point a rep confirms a fixed source IP requirement and we want to start integration, choose between (a) Render Pro static IP, (b) fly.io proxy with reserved IPv4. Annotate the choice in [integrations.md](./integrations.md) under wholesalers.

### 4. Render Cron Job runtime image for `pg_dump` + `aws-cli`

**Default:** Custom Dockerfile (`Dockerfile.backup` at repo root) using `dockerfilePath: ./Dockerfile.backup` in `render.yaml`. Alpine + postgresql-client + aws-cli + gnupg + bash.

**Why:** Cleanest separation — backup tooling lives in its own image, doesn't bloat the web image, doesn't depend on whatever runtime Next.js ships with.

**Alternative options:**
- (b) **Bundle pg_dump + aws-cli into the app image** and shell out from a Node entrypoint. Simpler one-image deploy but couples backup tooling to app image lifecycle.
- (c) **Move backup cron to GitHub Actions** calling a Render webhook. Removes backup from Render but introduces GHA-secret management and webhook auth surface.

**Decision needed before T34 ships.** Default is (a).

## Pending from Kaleem

These need information from Kaleem before the system can fully calibrate.

### TIC supplement brand list

**What we need:** which supplement brands Kaleem currently lists or wants to list, so we can populate `tic_certifications` and surface gaps via Account Health.

**Why it matters:** Amazon's December 2025 supplement requirement means listings without current TIC certification get suspended. We can pre-emptively block listings without certs and email brands proactively for renewal.

**Status:** outstanding ask in [kaleem-todos.md](./kaleem-todos.md).

### Top 20-30 Amazon brands for risk classification

**What we need:** Kaleem's working list of brands he currently sells or has historically sold, so we can populate `brand_authorization` with `safe` / `needs_loa` / `hunts_resellers` / `transparency_enrolled` / `unknown` per brand.

**Why it matters:** the brand-hunt list is Tier 1 — Research Analyst flags candidates from those brands as needing LOA before listing. Without seed data, every brand is `unknown` and the flag system is noisy.

**Status:** outstanding.

### Expiration-tracking workflow

**What we need:** how does Kaleem currently track expiration dates on inventory? Manual log? Wholesaler-portal lookup at sourcing time? Nothing yet?

**Why it matters:** Fulfillment Ops's shelf-life policy (Amazon ≥ 9-12 months at receipt) needs `expiration_date` on `wholesaler_stock_snapshots`. The schema supports it; the data needs a populating workflow.

**Status:** outstanding.

### EzriRx membership status

**What we need:** confirmation that Kaleem's EzriRx pharmacist account has the EDI/SFTP feed enabled, plus credentials.

**Why it matters:** Phase 2 wholesaler integration cannot start without this. EzriRx is the primary aggregator; ABC direct is a parallel track but more limited in coverage.

**Status:** outstanding.

### Blind-ship confirmations from each wholesaler

**What we need:** written confirmation from each wholesaler rep that they will blind-ship to Amazon customer addresses without including pharmacy branding on packing slips. Some wholesalers do this by default; some require explicit setup.

**Why it matters:** Amazon's policy. Customer-visible wholesaler branding on the package is a policy violation.

**Status:** outstanding; email drafts exist in [emails/](./emails/).

### NDA signing

**What we need:** NDA signed between Kaleem and the dev team. Standard.

**Status:** outstanding.

### Top 30 SKUs for migration

**What we need:** Kaleem's current ~30 active Amazon listings — ASINs, current prices, default suppliers — so we can pre-populate `products` + `listings` ahead of SP-API live sync.

**Why it matters:** without this, day-1 of Phase 2 has empty `products` table and no chatbot context. With it, the chatbot can answer real questions immediately and Research Analyst's "previous_analysis_ids" continuity works from the start.

**Status:** outstanding. Phase 2 SP-API ingest will reconcile but pre-population accelerates onboarding.

## Pending dev-side

### minicrew Linux port timeline

**What we need:** ETA on the minicrew port from macOS to a generic Linux container (Render-compatible). Currently a parallel-stream of work; not in this Phase 1 plan.

**Why it matters:** Phase 2 is blocked on it. Once it lands, the worker stub uncomments in `render.yaml` and we can start Phase 2 day-1 spike (Bookkeeper).

**Coordination:** ensure the port targets a generic Linux container (NOT Mac-specific) and uses the Agent SDK's `query()` (NOT the `claude -p` CLI).

### Phase 2 day-1 spike target

**What we need:** confirm that **Bookkeeper** is the right first agent to validate the Agent SDK + minicrew runtime end-to-end. Recommended because it's the simplest (daily cron, single-pass reasoning, one DB write, no executor branch).

**Why it matters:** the spike should validate skill-file loading, `PreToolUse` hooks firing, OTLP export, `total_cost_usd` landing in `claude_usage`, and minicrew retry logic — without an executor write at risk.

**Status:** Bookkeeper is the working assumption. Confirm at Phase 2 kickoff.

### Custom domain for Render deploy

**What we need:** decide whether to use Render's auto-generated subdomain in Phase 1 or set up a custom domain.

**Default:** auto-generated. Custom domain later (Phase 2 or when there's a public-facing reason).

### Phase 1.5 trigger

**What we need:** define the trigger for moving from Phase 1 → Phase 1.5. Option A: time-based (4 weeks of Kaleem chatbot use). Option B: feature-based (Kaleem asks for "memory of past decisions" or "show me what changed since last week" — both need richer memory than text search). Option C: data-based (memory table > 1k rows, text search starts noisy).

**Default:** B (feature-driven).

### Sentry vs alternative

**What we need:** confirm Sentry as the exception-reporting target. Free tier is plenty for Phase 1 traffic. Alternative would be a self-hosted GlitchTip if Kaleem prefers.

**Default:** Sentry.

### LangSmith vs Langfuse for OTLP target (Phase 2)

**What we need:** decide observability backend for the Agent SDK's OTLP traces when the worker activates. LangSmith free tier (5k traces/mo, hosted) or Langfuse (self-hosted, free, more setup).

**Default:** LangSmith free tier for Phase 2 day-1 spike. Re-evaluate at scale.

## Resolved (kept here for decision history)

- **Inference layer:** Claude Agent SDK (TypeScript). Settled 2026-04-30 after 4-phase research + 3 reviewer passes. See [`tmp/research/2026-04-30-agent-runtime-recommendation.md`](../tmp/research/2026-04-30-agent-runtime-recommendation.md) v3.
- **Deployment:** cloud-only (Render web + worker + cron). Mac mini removed 2026-04-30. v2 hybrid frozen at [`tmp/research/2026-04-30-agent-runtime-recommendation-v2.md`](../tmp/research/2026-04-30-agent-runtime-recommendation-v2.md) for decision history.
- **Backup target:** Backblaze B2 (vs Cloudflare R2 / AWS S3). See item 1 above.
- **Authentication in v1:** Supabase Auth magic-link with `ALLOWED_USER_EMAILS` allowlist (Kaleem only).
- **RLS posture in Phase 1:** disabled. Service role only behind middleware-enforced auth. Enable in Phase 2 with `pharmacy_id = auth.jwt() ->> 'pharmacy_id'` policies.
- **Embeddings:** deferred to Phase 1.5. Schema keeps `vector(1024)` column + `embedding_model` tracking. No Voyage key in Phase 1.
- **Multi-pharmacy in v1:** one pharmacies row (Kaleem's consolidated OTC business). Schema supports multi-tenant.
- **Product branding:** "PharmaDash" from the demo. Trivial to rename in v2.
