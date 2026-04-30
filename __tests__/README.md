# Tests

Three categories of tests live here, per Phase 1 plan T1:

1. **Tool input validation** — one `*.test.ts` per tool in `lib/tools/*` that exercises the Zod schema with valid + invalid inputs. Catches schema drift early.

2. **Tool-loop termination** — a single test that mocks the Anthropic SDK to always return a `tool_use` block and asserts the `/api/chat` handler stops at `MAX_TOOL_ITERATIONS` (8) instead of looping forever.

3. **Migration reset** — a test that runs `supabase db reset` against the local Supabase instance and asserts all 5 migrations apply cleanly with no errors. Requires `supabase start` to be running locally; skipped in CI unless `RUN_MIGRATION_TESTS=1` is set.

Run with `npm test`. Watch mode: `npm run test:watch`.
