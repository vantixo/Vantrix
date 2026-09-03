# Vantrix

Full-stack AI companion / creator marketplace platform. Next.js 15 (App Router),
Supabase (Postgres + RLS), Redis/Upstash, multi-provider AI routing.

## Requirements
- Node 24.x (see `engines` in `package.json`, `.nvmrc`, and `Dockerfile`)
- A Supabase project (Postgres + Auth)
- Redis (Upstash-compatible)

## Getting started
```bash
npm ci
cp .env.example .env.local   # fill in real values
npm run dev
```

## Scripts
| Script | Purpose |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Next lint |
| `npm test` | Run the vitest suite (regression tests for XSS, RLS, payment gating, moderation fail-closed, etc.) |
| `npm run db:migrate` | Push `supabase/migrations/*.sql` |
| `npm run db:types` | Regenerate `src/types/supabase.ts` from the live schema |
| `npm run verify:prod` | Sanity-check `.env.production` before deploying — run this before every prod deploy |
| `npm run worker` | Start the background job worker (`src/lib/queue/worker-runner.ts`) |

## CI
`.github/workflows/ci.yml` runs typecheck, lint, test, and build on every push/PR to `main`.

## Structure
- `src/app` — routes (App Router), including `admin/` (internal review tools) and `api/`
- `src/lib` — domain logic: `ai/` (provider routing), `safety/` (crisis detection), `moderation/`,
  `payments/`, `age-verification/`, `supabase/`
- `supabase/migrations` — sequential SQL migrations, source of truth for schema + RLS
- `services/` — standalone services (see `services/brain/README.md` for the semantic memory service)
- `scripts/` — operational scripts (`verify-production-config.mjs`, etc.)

## Admin tools
`/admin` (gated by `requireAdmin`, see `src/lib/auth/admin.ts`) includes review queues for
abuse signals, crisis events, reply-guard flags, and content moderation. Crisis events are
additionally readable by any profile with `role = 'safety_reviewer'`, independent of full
admin access — see `supabase/migrations/20260829_crisis_events_admin_access.sql`.

## Before deploying
1. `npm run verify:prod` against real `.env.production` — catches placeholder/live-key mismatches
   across payment providers.
2. Confirm all `supabase/migrations` have been applied (`npm run db:migrate`).
3. CI must be green on `main`.
