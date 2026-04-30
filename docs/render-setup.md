# Render Setup — Click-by-Click

This guide walks a fresh operator through deploying PharmaDash to Render from
the `render.yaml` Blueprint at the repo root. Plan ~45 minutes for a first run.

> **Push policy reminder:** never push to `omdiidi/pharmacy` without explicit
> user approval. This guide assumes the desired commit is already on
> `origin/main`.

---

## Prerequisites

Have these accounts and values ready before starting:

- **Render account** with billing enabled (Starter plans are paid; cron jobs
  are billed per minute of execution).
- **Backblaze B2 account** — *separate* from your Supabase login email. Use a
  `+backup` alias (e.g. `you+backup@gmail.com`) so a compromised primary
  account cannot reach the backup account. Enable 2FA.
- **Supabase Pro project** for production data.
- **Second Supabase project** (free tier is fine) used as the throwaway
  restore-test target. Must be a *different* project from production —
  the restore script wipes and reloads it.
- **Anthropic API key** with billing configured.
- **Sentry DSN** (optional but recommended).
- **GPG passphrase** generated locally — store in 1Password. Losing it makes
  every backup unrecoverable.

---

## Step 1 — Create the Backblaze B2 bucket

1. Sign up at [backblaze.com](https://www.backblaze.com/cloud-storage/object-storage)
   using the `+backup` alias email. Enable 2FA.
2. Buckets → **Create a Bucket**.
   - Name: `pharm1-backups` (must be globally unique — try
     `pharm1-backups-<your-handle>`).
   - Files in Bucket are: **Private**.
   - **Object Lock: Enable.** Critical: this cannot be turned on after
     creation. Choose **Governance** mode, default retention 84 days
     (12 weekly backups).
   - Default Encryption: enable server-side encryption.
3. Bucket Settings → **Lifecycle Settings** → keep last 84 days of file
   versions, then hide; permanently delete after 91 days.
4. Bucket Settings → note the **S3-Compatible Endpoint URL**, e.g.
   `https://s3.us-west-004.backblazeb2.com`. You'll paste this as
   `B2_ENDPOINT_URL`.
5. App Keys → **Add a New Application Key**.
   - Name: `pharm1-render-write`.
   - Allow access to Bucket(s): `pharm1-backups` only.
   - Type of Access: **Write Only** — uncheck `deleteFiles`, `listFiles`,
     `readFiles`. Render only ever writes.
   - File name prefix: leave blank.
   - Save the `keyID` (→ `B2_KEY_ID`) and `applicationKey`
     (→ `B2_APPLICATION_KEY`) into 1Password immediately. Backblaze shows
     the secret only once.
6. **Create a separate break-glass admin key** with full read + delete on the
   bucket. Store it offline (printed and locked, or a separate password
   manager). Never put it in Render. Used only for manual restores after
   account compromise.
7. **Restore-test note:** the restore-test cron needs `listFiles` and
   `readFiles` to fetch the latest backup. Either:
   - Create a second key (`pharm1-restore-read`) scoped to the same bucket
     with `listFiles` + `readFiles` and override `B2_KEY_ID` /
     `B2_APPLICATION_KEY` on the `pharm1-backup-restore-test` cron service
     (recommended), or
   - Temporarily widen the write-only key. Do not leave it widened.

---

## Step 2 — Render Blueprint deploy

1. Render dashboard → **New** → **Blueprint**.
2. Connect to GitHub. Authorize the `omdiidi/pharmacy` repository.
3. Pick branch `main`. Render reads `render.yaml`.
4. Review the four services Render will create:
   - `pharm1-web` (Next.js)
   - `pharm1-backup-weekly` (cron, Dockerfile-based)
   - `pharm1-backup-restore-test` (cron, Dockerfile-based)
   - The worker stanza is commented out — Render will skip it.
5. Render will prompt for the env group `pharm1-shared`. Skip filling values
   for now; Apply the blueprint first so the services exist.
6. Click **Apply**. Render starts building. The web service will fail its
   first build because env vars aren't set — that's expected.

---

## Step 3 — Fill the `pharm1-shared` env group

Render dashboard → Env Groups → `pharm1-shared` → fill each value:

| Key | Source / format |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic console → API keys. Format: `sk-ant-…` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API → service_role. **Server-only, never `NEXT_PUBLIC_`.** |
| `SUPABASE_DB_URL` | Supabase project → Settings → Database → Connection string (URI). Use the **session pooler** URI for the cron jobs. |
| `ALLOWED_USER_EMAILS` | Comma-separated list, e.g. `kaleem@example.com,nick@example.com,dev@example.com` |
| `BACKUP_PASSPHRASE` | Long random string. Generate with `openssl rand -base64 48`. Store in 1Password — losing this destroys every backup. |
| `B2_KEY_ID` | From Step 1.5 |
| `B2_APPLICATION_KEY` | From Step 1.5 |
| `B2_BUCKET` | The bucket name you chose (e.g. `pharm1-backups`) |
| `B2_ENDPOINT_URL` | From Step 1.4 (e.g. `https://s3.us-west-004.backblazeb2.com`) |
| `NEXT_PUBLIC_SITE_URL` | Render's auto-generated URL, e.g. `https://pharm1-web.onrender.com`. Used as the magic-link redirect base. |
| `SENTRY_DSN` | Sentry project → Settings → Client Keys (DSN). Optional in dev — leave blank to disable. |
| `MAX_DAILY_CLAUDE_SPEND_USD` | Already defaulted to `50` in `render.yaml`. Override if you want a tighter cap. |

Save the env group. Render will prompt to redeploy any service that depends
on it — accept.

---

## Step 4 — Wire the throwaway restore-test database

The `pharm1-backup-restore-test` cron writes to a *separate* Supabase
project so it cannot corrupt production.

1. Supabase dashboard → **New project**. Name it `pharm1-restore-test`. Free
   tier is fine.
2. Once provisioned: Settings → Database → Connection string (URI). Copy.
3. Render dashboard → `pharm1-backup-restore-test` service → Environment.
4. Add env var `RESTORE_TEST_DB_URL` with the URI from step 4.2. **Add it on
   this service only — not in the `pharm1-shared` group.**
5. (If using a separate restore-read B2 key per Step 1.7) override
   `B2_KEY_ID` and `B2_APPLICATION_KEY` on this service too.

---

## Step 5 — First deploy and smoke test

1. Render dashboard → `pharm1-web` → **Manual Deploy** → **Deploy latest
   commit**.
2. Watch the Build Logs. Expected stages:
   - `npm ci` resolves dependencies.
   - `npm run build` compiles Next.js.
   - **Pre-deploy:** `npm run verify-models` — calls the Anthropic API to
     confirm the configured model IDs exist. Fails loudly if
     `ANTHROPIC_API_KEY` is wrong.
   - `npm start` boots the server.
3. When the deploy is live, hit `https://pharm1-web.onrender.com/api/health`.
   Expected JSON: `{ "ok": true, ... }`.

---

## Step 6 — Magic-link sign-in

1. Open `https://pharm1-web.onrender.com/sign-in`.
2. Enter an email present in `ALLOWED_USER_EMAILS`. Anything else is
   rejected before Supabase is even called.
3. Check your inbox for the Supabase magic link. Click.
4. You should land on the Inbox page with the seeded briefings (if
   `npm run seed:dev` was run against this Supabase project locally).

> **First-login bootstrap:** the auth callback inserts a row into
> `user_pharmacy_access` linking the new `auth.users` id to the default
> pharmacy. If you run into "no pharmacy access" errors, insert the row
> manually via Supabase SQL editor.

---

## Step 7 — Verify the backup cron runs

Two ways to confirm:

**Option A — wait until Sunday 09:00 UTC.**
The cron fires automatically. Logs appear in Render → `pharm1-backup-weekly`.

**Option B — run now.**
Render dashboard → `pharm1-backup-weekly` → **Trigger Run**. Watch the logs:

```
[backup] starting pg_dump → gzip → gpg → /tmp/pharm1-...
[backup] encrypted size: N bytes
[backup] sha256: ...
[backup] uploading to s3://pharm1-backups/pharm1-...sql.gz.gpg
[backup] OK ts=... size=... sha=...
```

Check three places to confirm success:

1. Backblaze dashboard → bucket → file appears.
2. Supabase SQL editor:
   `select * from backup_log order by created_at desc limit 5;`
   The latest row matches the filename and sha logged.
3. Render cron run history shows green.

---

## Troubleshooting

### `verify-models` fails during pre-deploy
- Re-check `ANTHROPIC_API_KEY` in `pharm1-shared`. The key must have access
  to the model IDs declared in `scripts/verify-models.ts`.
- Anthropic billing must be enabled (free trial keys cannot list models).

### `/api/health` returns 503
- Check `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are
  set on `pharm1-web`. They must come from the *production* Supabase
  project, not the restore-test one.
- Inspect Render logs for the exact failed query.

### Magic link never arrives
- Supabase project → Auth → Email Templates → confirm the SMTP sender is
  configured. Free-tier Supabase has a low rate limit; use a custom SMTP
  provider in production.
- Confirm the email matches `ALLOWED_USER_EMAILS` exactly (case-sensitive,
  no whitespace).
- Check Supabase Auth → Logs for the magic-link send.

### Backup cron fails with `Access Denied`
- B2 application key may be missing the bucket scope or `writeFiles`
  permission. Re-issue from Step 1.5.
- Confirm `B2_ENDPOINT_URL` matches the *bucket region*, not the account
  default region.

### Restore-test cron fails with `permission denied for table pharmacies`
- The restore-read B2 key needs `listFiles` + `readFiles`. See Step 1.7.
- The throwaway Supabase project must be on the same Postgres major version
  as production; if Supabase has rolled forward, re-create the throwaway
  project.

### `psql` connect timeout from cron
- Use Supabase's session pooler URI for `SUPABASE_DB_URL` and
  `RESTORE_TEST_DB_URL`. The direct connection string can refuse
  long-running cron connections from Render's egress IP set.

---

## Worker activation later (Phase 2)

When the minicrew Linux port lands:

1. In `render.yaml`, uncomment the `pharm1-worker` service block.
2. In `package.json`, add a `worker` script that boots the minicrew job
   loop.
3. Commit + push to `main`. Render auto-detects the Blueprint change and
   provisions the worker.
4. The worker reads `pharm1-shared` automatically; no new env vars needed.

---

## Custom domain (deferred)

Phase 1 ships on Render's auto-generated subdomain
(`pharm1-web.onrender.com`). When ready for a custom domain:

1. Render dashboard → `pharm1-web` → Settings → Custom Domains → add domain.
2. Update DNS per Render's instructions.
3. Update `NEXT_PUBLIC_SITE_URL` in `pharm1-shared` to the new URL — magic
   links will start coming from that origin.
4. Update Supabase → Auth → URL Configuration → Site URL + Redirect URLs
   to include the new domain.
