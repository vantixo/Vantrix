# Cron Jobs — Free-Tier Deploy, Then Scale

31 of the 32 cron jobs (see `config/cron-jobs.mjs`) are live, wired to
their routes, and deployable today on Vercel Hobby (free) — no
functionality is disabled for those 31. What changes between tiers is
*how* the sub-daily ones get triggered, not whether they run.

**The one exception: `content-engine-video`.** Its real budget is up to
280s (submit + bounded poll + upload); Hobby hard-caps every invocation
at 60s regardless of what triggers it, and no scheduling trick fixes a
duration problem the way GitHub Actions fixes the frequency one below.
So on `CRON_TIER=free` this job is deliberately excluded from scheduling
altogether — not clamped-and-run-to-fail — until you're on
`CRON_TIER=pro`. See `fitsFreeTier()` in `config/cron-jobs.mjs`, the
"What changes" section header of `scripts/generate-vercel-json.mjs`, and
the CRON_TIER guard in the route itself for the three places this is
enforced.

## The problem this solves

Vercel Hobby crons are capped at once per day; anything more frequent
fails at deploy time. Vantrix has jobs from every-minute (the queue
worker) down to weekly. Hand-maintaining two `vercel.json` files would
drift the moment either one changed.

## The fix: one source of truth, generated output

`config/cron-jobs.mjs` lists every job's *real* schedule and duration
once. `scripts/generate-vercel-json.mjs` reads it and, based on
`CRON_TIER`, writes `vercel.json` (and, on `free`, a GitHub Actions
workflow). This runs automatically in `npm run prebuild` — every build,
local or on Vercel, regenerates `vercel.json` fresh. **Don't hand-edit
`vercel.json`'s `crons` or `functions` blocks — edit
`config/cron-jobs.mjs` instead.**

| | `CRON_TIER=free` (default) | `CRON_TIER=pro` |
|---|---|---|
| Jobs that already run ≤ once/day and fit 60s (14) | Native Vercel cron | Native Vercel cron |
| Jobs that run more often (17: queue worker, billing/message recovery, the world-sim ticks, etc.) | `.github/workflows/vantrix-free-tier-crons.yml`, at their real cadence | Native Vercel cron, at their real cadence |
| The one job whose real duration exceeds 60s (`content-engine-video`) | **Not scheduled anywhere** — sits idle until `pro` | Native Vercel cron, real 280s budget |
| Function duration cap | 60s (Hobby's hard max) | Real value, up to 280s |
| Regions | 1 (`iad1`) | 3 (`iad1`, `sin1`, `fra1`) |

Nothing is throttled to daily on the free tier — the 17 frequent jobs
still run at full frequency, just triggered by GitHub Actions instead
of Vercel's own scheduler. (Vercel's once-a-day cap only limits its
*built-in* scheduler; the routes themselves are ordinary
`requireCronAuth()`-protected HTTP endpoints and will run for any
caller with the right secret — that's the whole trick, and it's also
exactly why it does NOT help `content-engine-video`: GitHub Actions
would happily call that route on any cadence you like, but the
*duration* cap it would still run into is enforced by the Vercel
Function itself, not by whichever scheduler placed the call.)

`npm run cron:generate` prints a build-time warning naming any job this
applies to, so it's never silently discovered nights later via a missed
dead-man's-switch ping.

## Deploying free today

1. Leave `CRON_TIER` unset (or set it to `free`) as a Vercel env var.
2. Push. `vercel.json` is already generated for `free` in this repo.
3. Add two GitHub repo secrets so the fallback workflow can call your
   deployment (Settings → Secrets and variables → Actions):
   - `VANTRIX_BASE_URL` — your production URL
   - `CRON_SECRET` — same value as the `CRON_SECRET` env var on Vercel
4. That's it — the 14 daily-or-less jobs run on Vercel's own cron, the
   17 frequent ones run on GitHub Actions, both hitting the same
   `requireCronAuth()`-gated routes. `content-engine-video` won't run
   yet — that's expected, not a bug, until step 2 below.
5. Set `CRON_TIER=free` explicitly as a real (not just implied-by-default)
   Vercel env var too — the route-level guard reads it at request time,
   so an explicit value there is what keeps `content-engine-video`
   self-skipping even if it's ever hit directly (see its route header).

## Scaling up later

```
CRON_TIER=pro npm run cron:generate   # or: set CRON_TIER=pro in Vercel env vars
```

Redeploy, and update the `CRON_TIER` Vercel env var (not just the local
generate command above) — the route-level guard reads it at request
runtime, so the env var is what actually turns `content-engine-video`
on, not just regenerating `vercel.json`. All 32 jobs move to native
Vercel cron at full precision, all 3 regions come back, and function
durations go back to their real budgets. The GitHub Actions workflow
becomes redundant — safe to disable or delete once you've confirmed the
Pro deploy is running.

## Alerting

Two independent layers, both already in place:

- **Dispatcher-level.** `vantrix-free-tier-crons.yml` fires every due route
  and only fails the GitHub Actions run at the end, once the whole batch
  has been attempted — one stuck route no longer suppresses the rest, and
  a failure now shows as a failed run (default GH email/UI notification to
  watchers) instead of a silent `|| echo` that always exited 0.
- **Per-job dead man's switch.** `src/lib/cron/heartbeat.ts` pings a
  `HEARTBEAT_<JOB>` URL (healthchecks.io, BetterStack, Cronitor, etc.) on
  start/success/fail for 30 of the 32 jobs — see that file's header for
  full setup. `ping()` is a no-op until the matching env var is set, so
  it's safe to deploy before every job has one configured. The 2
  intentional exceptions: `queue/worker` (fires every minute — too
  frequent for external ping monitoring to add signal) and
  `content-engine-video` (doesn't run on `CRON_TIER=free` at all — see
  above).

## Notes

- `src/lib/cron/lock.ts` already provides a distributed lock per job, so
  if a route is briefly reachable from both Vercel and GitHub Actions
  during a tier switch, it won't double-run.
- For `billing-recovery` / `message-recovery` (money- and
  message-delivery–sensitive, every 5 min), GitHub Actions' schedule
  timing is best-effort and can lag under load. If exact timing matters
  before you're ready for Pro, point a free precise pinger (e.g.
  cron-job.org) at those two routes instead of relying on the generated
  workflow for just those two.
- Manually run the whole free-tier batch once with `workflow_dispatch`
  (Actions tab → "Vantrix free-tier crons" → Run workflow) — useful
  right after your first deploy, to confirm every route responds before
  waiting for the real schedule.
