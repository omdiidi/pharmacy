# Render Deploy Runbook (DevTools-driven)

> **Audience:** Dev (Omid), or any agent driving DevTools to deploy PharmaDash to Render + cloud Supabase.
> **Status:** Repo is at `6b65eed` on `main`. Local services down. Ready to deploy.
> **Working assumption:** User watches over my shoulder via DevTools while I drive the Render dashboard.

---

## Phase 0 — User does these steps manually FIRST

These must happen before I touch DevTools. User confirms each one before I proceed.

### 0.1 Create Supabase cloud project
1. Go to https://supabase.com/dashboard
2. Click "New project"
3. **Name:** `pharm1` (or `pharmadash` — anything)
4. **Region:** US West (Oregon) — matches Render region for low latency
5. **Database password:** strong random string — Supabase will show it once. SAVE IT.
6. **Plan:** Free tier (500 MB DB / 50k MAU is fine for demo for months)
7. Wait ~2 min for provisioning

### 0.2 Capture the 4 keys from Supabase
After project provisions, paste these to me in chat (they're not secrets I need to read from anywhere — you give them to me directly):

| Key | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role secret (click "Reveal") |
| `SUPABASE_DB_URL` | Project Settings → Database → Connection string → URI (transaction pooler, port 6543, with `?pgbouncer=true&connection_limit=1`) |

### 0.3 Apply migrations to cloud Supabase
Two options:
- **(a) From your terminal** (recommended — explicit, fast):
  ```bash
  cd /Users/omidzahrai/Desktop/CODEBASES/kaleem/pharm1
  npx supabase link --project-ref <your-project-ref>     # ref is in the URL
  npx supabase db push                                    # applies all 6 migrations
  ```
  You'll be prompted for the database password from step 0.1.

- **(b) Let me do it via the Supabase MCP** — I can call `mcp__supabase__apply_migration` with each migration file. Slightly slower (one call per file) but no terminal context-switch.

After applying:
```bash
# verify in your terminal, OR I can do this via Supabase MCP:
psql "$SUPABASE_DB_URL" -c "select count(*) from pharmacies;"
# expect: 0 (no seed yet)
```

### 0.4 Seed the cloud DB
The seed runs against the connection in `.env`. Two options:
- **(a) From your terminal:** temporarily put the cloud DB connection in `.env`, run `npm run seed:dev`, then revert.
- **(b) Via Supabase MCP `execute_sql`:** I can pipe the seed SQL through. Cleanest.

I'll do (b) when we get there.

### 0.5 You connect Render Blueprint to GitHub repo
1. Go to https://dashboard.render.com
2. Click **"New" → "Blueprint"**
3. Connect to GitHub if not already (you'll authorize Render to read `omdiidi/pharmacy`)
4. Select `omdiidi/pharmacy` repo
5. Render reads `render.yaml` from the repo and shows it'll create:
   - 1 web service: `pharm1-web`
   - 3 cron services: `pharm1-listing-agent`, `pharm1-backup-weekly`, `pharm1-backup-restore-test`
   - 1 envVarGroup: `pharm1-shared`
6. **STOP HERE** — don't click "Apply" yet. Tell me you're at this screen and say "go DevTools." I take over.

---

## Phase 1 — DevTools driven (I take over here)

### 1.1 Pre-flight before any clicks
I will:
1. Confirm `command -v` for the macmini/chrome-devtools MCP I need
2. Confirm you're on the Blueprint preview screen in Render
3. Have all 4 Supabase keys + your OpenRouter key ready in my context

### 1.2 Populate `pharm1-shared` env var group

Render shows the Blueprint preview with empty values for every `sync: false` key. I fill these in order:

| # | Key | Value source | Notes |
|---|---|---|---|
| 1 | `OPENROUTER_API_KEY` | Already in your local `.env` — paste from there | `sk-or-v1-fe8b46af...` (the working one) |
| 2 | `OPENROUTER_APP_NAME` | Pre-filled `"PharmaDash"` | No action — already set in render.yaml |
| 3 | `OPENROUTER_APP_URL` | `https://pharm1-web.onrender.com` | Render's default URL for first instance with this name |
| 4 | `NEXT_PUBLIC_SUPABASE_URL` | From step 0.2 | e.g. `https://xxx.supabase.co` |
| 5 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From step 0.2 | Long JWT |
| 6 | `SUPABASE_SERVICE_ROLE_KEY` | From step 0.2 | Long JWT — **secret** |
| 7 | `SUPABASE_DB_URL` | From step 0.2 | Used by backup cron (won't run yet but Render won't apply if missing) |
| 8 | `ALLOWED_USER_EMAILS` | `zomid777@gmail.com` | Magic-link allowlist |
| 9 | `BACKUP_PASSPHRASE` | Generate random 32-char or skip (cron will fail at runtime, harmless) | Optional for demo |
| 10 | `B2_KEY_ID` | Skip — empty string | Backup cron will fail at runtime, that's fine |
| 11 | `B2_APPLICATION_KEY` | Skip — empty string | Same |
| 12 | `B2_BUCKET` | `pharm1-backups` (matches existing default in .env.example) | Doesn't matter if B2 not set up |
| 13 | `B2_ENDPOINT_URL` | `https://s3.us-west-004.backblazeb2.com` | Default value |
| 14 | `NEXT_PUBLIC_SITE_URL` | `https://pharm1-web.onrender.com` | Same as #3 |
| 15 | `SENTRY_DSN` | Skip — empty string | logger.ts is no-op when empty |
| 16 | `MAX_DAILY_CLAUDE_SPEND_USD` | Pre-filled `"50"` | No action |

`RESTORE_TEST_DB_URL` on the restore-test cron — skip; that cron is non-essential for demo.

### 1.3 Click "Apply Blueprint"
Render starts provisioning all services. Watch the build logs.

### 1.4 First-deploy expectations

| Service | Expected outcome | What to check |
|---|---|---|
| **pharm1-web** | Builds (npm ci + next build), preDeploy runs `verify-models` against OpenRouter | Should pass — we exercised this locally |
| **pharm1-listing-agent** | Builds (`npm ci` only) — does NOT run yet (cron schedule = daily 13 UTC) | Just sits idle. Manual trigger available from Render UI for first test. |
| **pharm1-backup-weekly** | Builds via Dockerfile.backup. Runs Sundays. | Will fail at runtime since B2 vars empty. Acceptable for now. |
| **pharm1-backup-restore-test** | Same | Same |

**First web build expected duration:** 3–5 min.

### 1.5 Validation in browser (you drive — confirms over my shoulder)
1. Open `https://pharm1-web.onrender.com`
2. Should redirect to `/sign-in`
3. Enter `zomid777@gmail.com`, click "Send magic link"
4. Check your email — Supabase cloud sends real email now (vs local inbucket)
5. Click the link → lands you on the inbox at `/`
6. Verify inbox shows the 4 seeded briefings (will only show after 0.4 seed step)
7. Click Approve on a `list_on_amazon` briefing
8. Confirm UndoBanner with 30-min countdown
9. In a new tab: Supabase Dashboard → Table Editor → `pending_listings` → confirm row created
10. Click Undo → confirm "Reverted at HH:MM" + `pending_listings.status='cancelled'`
11. Click Reject on another briefing → confirms it disappears

### 1.6 Optional: manually trigger the listing agent cron
1. Render dashboard → `pharm1-listing-agent` → "Trigger Run"
2. Watch logs — should see "[listing-agent] done — proposed=N skipped=M capped=false"
3. Inbox refresh → new briefings appear (probably duplicates of seeded products since fresh cloud DB has nothing competing)

---

## Phase 2 — Things I'll surface but won't fix during the deploy

These are intentionally out of scope for the initial deploy. Note them, defer to follow-up:

1. **Backup cron jobs are non-functional** — needs B2 bucket + key created. ~$0.50/mo. Defer to a follow-up session when user wants disaster recovery active.
2. **`scripts/verify-models.ts` runs as preDeploy on every web deploy** — costs one OpenRouter API call per deploy (free, just lists models). If this becomes annoying we can move it to a one-shot postBuild.
3. **`runtime: node` Render cron is the unknown** — confidence based on Render docs. First trigger of `pharm1-listing-agent` is the validation moment.
4. **No SP-API integration yet** — listing agent's executor is stubbed. `pending_listings.status='pending'` rows accumulate. Real SP-API publish lands when Kaleem's app gets approved (1–4 wk Amazon timer; see `docs/kaleem-onboarding.md`).
5. **Dev-login disabled in production** — `NODE_ENV !== 'production'` gate trips. User uses magic-link auth on Render. Cloud Supabase sends real email.
6. **No Sentry yet** — DSN empty; logger is no-op. If errors happen on Render, surface via Render's own log viewer.

---

## Phase 3 — Post-deploy follow-ups (separate session(s))

In likely priority order:

1. **Connect Sentry** — free tier. Real error visibility.
2. **B2 + backup activation** — once user has 30 min + a CC.
3. **Real SP-API integration** — replaces `list_on_amazon` executor stub. Gated on Kaleem's app approval.
4. **EzriRx integration** — Phase 2 Layer 4 (Fulfillment Ops). Gated on Kaleem's account credentials.
5. **Phase 2 Layer 3** — Repricer (propose-only).
6. **Phase 2 Layer 4** — Fulfillment Ops + Research Analyst (lite).

---

## What I need from you to start Phase 1

A clear, unambiguous "go DevTools" message. Until then I'm idle.

When you're ready, paste this into chat (filling in the blanks):
```
go DevTools. Supabase project created.
NEXT_PUBLIC_SUPABASE_URL: https://___.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY: ___
SUPABASE_SERVICE_ROLE_KEY: ___
SUPABASE_DB_URL: postgresql://...
[Migrations: I will run / you do via MCP]
[Seed: I will run / you do via MCP]
Render Blueprint preview is on screen.
```

I take it from there.
