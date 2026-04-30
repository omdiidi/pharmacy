<!-- README.md — top-level project overview, status, local-dev runbook, deployment pointer, repo map. -->

# PharmaDash

A multi-agent AI platform that automates the Amazon + eBay over-the-counter (OTC) arbitrage workflow for a licensed Utah pharmacist (Kaleem). A swarm of 9 specialist agents — coordinated by a Chief of Staff persona Kaleem chats with — read wholesaler stock, Amazon market data, FDA shortages, and Kaleem's own sales history; recommend what to list, at what price, and when; and surface a daily action queue Kaleem reviews and approves. The defensible edge is **stock-out arbitrage**: FBA-empty windows where FBM-only licensed pharmacies can win the Buy Box at scarcity premiums.

## Status

**Phase 1 (MVP build) in progress.** Pre-implementation through 2026-04-30; the 44-task Phase 1 plan is now executing. The chatbot is the only live AI surface in Phase 1; the 8 specialist agents have skill prompts authored but don't run until the minicrew Linux port lands and Phase 2 activates.

See [`docs/mvp-scope.md`](./docs/mvp-scope.md) for what ships in Phase 1 and [`docs/open-questions.md`](./docs/open-questions.md) for what's still pending.

## Architecture quick view

```
Kaleem ──► Inbox + Chat (Chief of Staff)
              │
              ▼
      9 specialist agents (Phase 2)
              │
              ▼
   Supabase (queue + data + memory + audit)
              │
              ▼
    Backblaze B2 (encrypted weekly backup)
```

Full diagrams + per-layer breakdown in [`docs/architecture.md`](./docs/architecture.md).

## Local development

Prerequisites: **Node 20+**, **npm**, the **Supabase CLI**, and **Docker** (Supabase local stack runs in Docker).

```bash
# 1. Clone
git clone https://github.com/omdiidi/pharmacy.git pharm1
cd pharm1

# 2. Install deps
npm install

# 3. Env config
cp .env.example .env
# Fill in via the global /load-creds skill (1Password-backed) or by hand.
# At minimum for local dev you need: ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
# NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL,
# ALLOWED_USER_EMAILS (your email), NEXT_PUBLIC_SITE_URL=http://localhost:3000.
# Local Supabase URL + keys are printed by `supabase start` below.

# 4. Start the local Supabase stack (Docker)
supabase start

# 5. Apply migrations + run seed.sql
supabase db reset

# 6. Generate TypeScript types from the local schema
supabase gen types typescript --local > lib/supabase/types.ts

# 7. Load dev fixtures (sample products, orders, briefings, memory rows)
npm run seed:dev

# 8. Run the Next.js dev server
npm run dev

# 9. Open http://localhost:3000
#    Sign in with the email you put in ALLOWED_USER_EMAILS.
#    Magic-link emails are delivered to the local inbucket at:
#    http://localhost:54324
```

After signing in once, the auth callback bootstraps a `user_pharmacy_access` row pointing at the seeded default pharmacy. From then on, the Inbox renders seed briefings and the chatbot at `/chat` can answer questions over the seeded data.

### Manual `user_pharmacy_access` bootstrap

If the auth callback bootstrap doesn't run (e.g., you're testing with a different user, or you're poking at the database with a service-role connection that bypasses the callback path), insert the row by hand:

Via psql:
```bash
psql $SUPABASE_DB_URL <<'SQL'
insert into user_pharmacy_access (user_id, pharmacy_id, role)
select u.id,
       (select id from pharmacies order by created_at limit 1),
       'owner'
from auth.users u
where u.email = 'YOUR_EMAIL@example.com'
on conflict do nothing;
SQL
```

Or via Supabase Studio (`http://localhost:54323` after `supabase start`): open `auth.users`, copy the user UUID, open `pharmacies`, copy the pharmacy UUID, then in the SQL editor:
```sql
insert into user_pharmacy_access (user_id, pharmacy_id, role)
values ('<user-uuid>', '<pharmacy-uuid>', 'owner');
```

After this, sign-in works and `/api/chat` returns 200 instead of 401.

### Useful scripts

```bash
npm run dev            # Next.js dev server
npm run build          # production build
npm run start          # production server
npm run typecheck      # tsc --noEmit
npm run lint           # next lint
npm run test           # vitest run
npm run test:watch     # vitest watch
npm run verify-models  # CI gate: anthropic.models.list() must return our configured IDs
npm run seed:dev       # load dev fixtures
npm run worker         # Phase 1: echoes "minicrew worker not yet implemented"
```

## Deployment

See [`docs/render-setup.md`](./docs/render-setup.md) for the click-by-click Render Blueprint setup. Short version:

1. Push the repo to GitHub (`origin → omdiidi/pharmacy.git`).
2. In Render dashboard: New → Blueprint → connect the repo. Render reads `render.yaml` and provisions web + worker (commented-out Phase 1) + 2 cron jobs.
3. Fill the `pharm1-shared` env var group with the values from `.env.example`.
4. Provision a Backblaze B2 bucket in a Backblaze account separate from Supabase. Object Lock at creation. Write-only API token. Keep a break-glass admin key offline.
5. First deploy. `/api/health` should return 200; `/sign-in` should send a magic link; chat with the bot.

## Repo map

```
pharm1/
├── app/                 Next.js 14 App Router — UI + API routes
├── components/          React components (sidebar, chat UI, inbox, briefing card, shadcn primitives)
├── lib/                 server-side libs — Supabase clients, Anthropic SDK, auth, rate-limit, budget, system prompt, tool handlers
├── supabase/            config.toml, 5 migrations, seed.sql
├── scripts/             backup-supabase.sh, restore-test.sh, seed-dev-data.ts, verify-models.ts
├── minicrew-config/     config.yaml + 9 skill prompts (one per agent, except Chief of Staff)
├── docs/                operational docs (this directory contains the README's siblings)
├── tmp/                 planning artifacts — briefs, research, ready/done plans
├── render.yaml          Render Blueprint
├── Dockerfile.backup    image used by both backup cron jobs
├── middleware.ts        Next.js middleware enforcing auth on all non-public routes
├── package.json
├── CLAUDE.md            full project briefing for AI agents picking up the repo
├── PLAN.md              30,000-foot project view + decision log
└── README.md            this file
```

## Key documents

- [`docs/architecture.md`](./docs/architecture.md) — system architecture (layers, data flow, memory model, multi-tenant boundary, observability).
- [`docs/product-manager.md`](./docs/product-manager.md) — the 9-agent swarm spec, 18 scenarios, briefing modal, scoring.
- [`docs/chatbot.md`](./docs/chatbot.md) — chatbot internals (tools, system prompt, streaming, cost, lifecycle).
- [`docs/integrations.md`](./docs/integrations.md) — minicrew, Keepa, EzriRx, SP-API, eBay, FDA.
- [`docs/agents/`](./docs/agents/) — per-agent specs (Chief of Staff, Research Analyst, Repricer, Fulfillment Ops, Account Health, Customer Success, Bookkeeper, Portfolio Manager, Reflector).
- [`docs/mvp-scope.md`](./docs/mvp-scope.md) — what ships in Phase 1, what's deferred, success criteria.
- [`docs/open-questions.md`](./docs/open-questions.md) — unresolved decisions + pending Kaleem-side asks.
- [`docs/render-setup.md`](./docs/render-setup.md) — Render Blueprint click-by-click.
- [`docs/amazon-sp-api-setup.md`](./docs/amazon-sp-api-setup.md) — SP-API onboarding step-by-step (Phase 2).
- [`CLAUDE.md`](./CLAUDE.md) — full project briefing for AI agents picking up the repo cold.
- [`PLAN.md`](./PLAN.md) — 30,000-foot project view + decisions log + integrations table.

## License

TBD — private project.
