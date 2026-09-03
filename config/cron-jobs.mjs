/**
 * config/cron-jobs.mjs
 *
 * SINGLE SOURCE OF TRUTH for every Vantrix cron job.
 *
 * Why this file exists:
 *   vercel.json's `crons` array is static and read at deploy time. But the
 *   schedule you actually want depends on which Vercel plan you're on:
 *
 *     - Vercel Hobby (free): a cron job may fire AT MOST ONCE PER DAY.
 *       Any entry in vercel.json that would fire more often fails the
 *       deployment outright (this is a hard deploy-time validation, not a
 *       soft throttle).
 *     - Vercel Pro/Enterprise: any frequency, down to once a minute.
 *
 *   Rather than hand-maintain two versions of vercel.json, every job's real
 *   desired schedule is declared once, here. `scripts/generate-vercel-json.mjs`
 *   reads this file and, based on the CRON_TIER env var, produces the
 *   correct vercel.json (and, for `free`, a GitHub Actions workflow that
 *   drives the jobs Hobby can't schedule natively — see that script's
 *   header comment for how that works).
 *
 * To change a schedule: edit the `schedule` value below and re-run
 *   `npm run cron:generate` (or just redeploy — it runs in `prebuild`).
 * To move a job's real duration budget: edit `maxDuration`.
 * Never hand-edit the `crons` or `functions` blocks in vercel.json —
 *   they're generated and get overwritten.
 */

/**
 * @typedef {Object} CronJob
 * @property {string} id            Unique slug, also used as the GitHub Actions job id
 * @property {string} path          Route path, e.g. '/api/cron/daily-reset'
 * @property {string} schedule      Real desired cron expression (5-field, UTC)
 * @property {number} maxDuration   Real desired function duration budget, in seconds
 * @property {string} description   One line — shown in comments/docs, not read by tooling
 */

/**
 * Vercel Hobby's hard per-invocation ceiling, in seconds (no Fluid compute
 * override assumed). scripts/generate-vercel-json.mjs imports this rather
 * than redeclaring it, so the "what can legally be clamped" number and the
 * "what actually fits" number below can never drift apart.
 */
export const HOBBY_MAX_DURATION_SECONDS = 60;

/**
 * Whether a job's REAL maxDuration fits inside Hobby's ceiling.
 *
 * This matters because clamping and fitting are different questions.
 * scripts/generate-vercel-json.mjs clamps every job's declared maxDuration
 * down to HOBBY_MAX_DURATION_SECONDS on CRON_TIER=free so the deploy itself
 * stays legal (Hobby rejects any `functions` entry above its ceiling
 * outright). That's harmless for a job whose real budget was already ≤60s
 * — the clamp is just generous headroom being trimmed off, nothing changes
 * about whether the job succeeds. It's NOT harmless for a job whose real
 * budget is >60s: clamping THAT job silently truncates work it actually
 * needs, so the invocation gets killed mid-run by the platform every time
 * it fires — same outcome whether Vercel's own scheduler or the free-tier
 * GitHub Actions fallback is what triggered it, since the duration ceiling
 * is enforced by the Function itself, not by whoever called it.
 *
 * A job failing this check must not be auto-scheduled on `free` at all
 * (see schedulableOnFree/excludedFromFree below) — it should sit
 * unscheduled until CRON_TIER=pro, not be scheduled to guarantee-fail
 * nightly.
 */
export function fitsFreeTier(job) {
  return job.maxDuration <= HOBBY_MAX_DURATION_SECONDS;
}

/**
 * GitHub Actions' shortest supported `schedule:` interval is 5 minutes —
 * unlike Vercel Cron (whose Hobby-vs-Pro ceiling is what HOBBY_MAX_DURATION_SECONDS
 * and fitsFreeTier() model above), GitHub Actions itself hard-rejects/ignores
 * any workflow cron expression with a shorter step than that. A job's `schedule`
 * field above stays the REAL desired cadence (used as-is for CRON_TIER=pro's
 * native vercel.json entry, and by the standalone worker-runner process) —
 * this function only computes what scripts/generate-vercel-json.mjs may
 * legally put in the generated GitHub Actions workflow when CRON_TIER=free.
 * A job clamped here needs its route to compensate for the lower trigger
 * frequency itself (see /api/queue/worker's internal drain loop).
 */
export function githubActionsSchedule(job) {
  const [minute] = job.schedule.trim().split(/\s+/);
  const isSubFiveMinute = minute === '*' || (minute.startsWith('*/') && Number(minute.slice(2)) < 5);
  return isSubFiveMinute ? '*/5 * * * *' : job.schedule;
}

/** @type {CronJob[]} */
export const CRON_JOBS = [
  // Real desired cadence is every minute (see githubActionsSchedule() above
  // for how the free-tier GitHub Actions fallback handles GH's 5-minute
  // floor) — Vercel Pro's native scheduler and the standalone worker-runner
  // process both honor this schedule value directly at full precision.
  { id: 'queue-worker',              path: '/api/queue/worker',                  schedule: '* * * * *',     maxDuration: 60, description: 'Drains the chat/image job queue' },
  { id: 'daily-reset',                path: '/api/cron/daily-reset',              schedule: '0 0 * * *',     maxDuration: 30, description: 'Daily message-count reset, subscription/trial expiry, session prune, message archive' },
  // maxDuration values below are kept in sync with each route's own
  // `export const maxDuration` (see src/__tests__/production-runtime-budgets.test.ts,
  // which fails the build if they ever drift again) — content-engine,
  // universe-images, and backstory-engine all genuinely need up to 280s for
  // their real Fal/OpenRouter generation batches, confirmed against the
  // route source; this registry previously under-declared all three as 60s,
  // which caused generate-vercel-json.mjs to clamp their vercel.json
  // `functions` entry to 60s on CRON_TIER=free while the route itself still
  // ran (and could be killed mid-batch by) its true 280s workload. Now that
  // fitsFreeTier() sees their real cost, all three correctly fall out of
  // free-tier scheduling entirely (see excludedFromFree()) until CRON_TIER=pro,
  // same treatment content-engine-video already had.
  { id: 'content-engine',             path: '/api/cron/content-engine',           schedule: '0 2 * * *',     maxDuration: 280, description: 'Daily content generation pass. Needs CRON_TIER=pro (see fitsFreeTier) — real Fal/OpenRouter batch genuinely runs up to 280s.' },
  { id: 'universe-images',            path: '/api/cron/universe-images',          schedule: '30 2 * * *',    maxDuration: 280, description: 'Universe/world image generation. Needs CRON_TIER=pro (see fitsFreeTier) — real Fal batch genuinely runs up to 280s.' },
  // The only job in this list whose maxDuration exceeds HOBBY_MAX_DURATION_SECONDS
  // (280 > 60) — see fitsFreeTier(). On CRON_TIER=free this job is therefore
  // excluded from scheduling entirely (neither native Vercel cron nor the
  // GitHub Actions fallback) rather than clamped-and-run-to-fail; the route
  // itself also self-skips at runtime as a second guard — see its header.
  { id: 'content-engine-video',       path: '/api/cron/content-engine-video',     schedule: '50 2 * * *',    maxDuration: 280, description: 'Automatic character video generation, 1/run, bounded poll — see route header for why this is split from content-engine. Needs CRON_TIER=pro (see fitsFreeTier).' },
  { id: 'backstory-engine',           path: '/api/cron/backstory-engine',         schedule: '0 3 * * *',     maxDuration: 280, description: 'Character backstory generation. Needs CRON_TIER=pro (see fitsFreeTier) — real OpenRouter batch genuinely runs up to 280s.' },
  { id: 'training-data-export',       path: '/api/cron/training-data-export',     schedule: '0 * * * *',     maxDuration: 60, description: 'Hourly training data export' },
  { id: 'priority-memory-export',     path: '/api/cron/priority-memory-export',   schedule: '0 4 * * *',     maxDuration: 60, description: 'Daily priority memory export' },
  { id: 'nudges',                     path: '/api/cron/nudges',                   schedule: '0 */6 * * *',   maxDuration: 30, description: 'Re-engagement nudges, every 6h' },
  { id: 'character-initiatives',      path: '/api/cron/character-initiatives',    schedule: '0 */2 * * *',   maxDuration: 60, description: 'Characters take initiative in convos, every 2h' },
  { id: 'character-posts',            path: '/api/cron/character-posts',          schedule: '0 */3 * * *',   maxDuration: 60, description: 'Character social posts, every 3h' },
  { id: 'character-social',           path: '/api/cron/character-social',         schedule: '20 */3 * * *',  maxDuration: 60, description: 'Character-to-character social interactions, every 3h' },
  { id: 'surprises',                  path: '/api/cron/surprises',                schedule: '0 14 * * *',    maxDuration: 60, description: 'Daily surprise engine' },
  { id: 'billing-recovery',           path: '/api/cron/billing-recovery',         schedule: '*/5 * * * *',   maxDuration: 30, description: 'Retries failed payments, every 5min' },
  { id: 'memory-archive',             path: '/api/cron/memory-archive',           schedule: '0 3 * * 0',     maxDuration: 60, description: 'Weekly memory archive (Sundays)' },
  { id: 'embedding-backfill',         path: '/api/cron/embedding-backfill',       schedule: '30 3 * * *',    maxDuration: 60, description: 'Backfills missing pgvector embeddings for memory_graph + characters, daily' },
  { id: 'message-archive',            path: '/api/cron/message-archive',          schedule: '0 4 * * *',     maxDuration: 60, description: 'Daily message archive (30-day window)' },
  { id: 'economy-tick',               path: '/api/cron/economy-tick',             schedule: '0 * * * *',     maxDuration: 60, description: 'Hourly world-economy tick' },
  { id: 'governance-tick',            path: '/api/cron/governance-tick',          schedule: '0 */4 * * *',   maxDuration: 60, description: 'Governance simulation, every 4h' },
  { id: 'civic-affairs-tick',         path: '/api/cron/civic-affairs-tick',       schedule: '0 */3 * * *',   maxDuration: 60, description: 'Civic affairs simulation, every 3h' },
  { id: 'narrative-tick',             path: '/api/cron/narrative-tick',           schedule: '0 */2 * * *',   maxDuration: 60, description: 'World narrative progression, every 2h' },
  { id: 'legacy-tick',                path: '/api/cron/legacy-tick',              schedule: '0 */6 * * *',   maxDuration: 60, description: 'Legacy/generational tick, every 6h' },
  { id: 'deep-tick',                  path: '/api/cron/deep-tick',                schedule: '0 14 * * *',    maxDuration: 60, description: 'Daily deep-simulation tick' },
  { id: 'paystack-renewal',           path: '/api/cron/paystack-renewal',         schedule: '0 */6 * * *',   maxDuration: 30, description: 'Paystack subscription renewal sweep, every 6h' },
  { id: 'referral-payouts',           path: '/api/cron/referral-payouts',         schedule: '0 6 * * 1',     maxDuration: 30, description: 'Weekly referral payouts (Mondays)' },
  { id: 'belief-maintenance',         path: '/api/cron/belief-maintenance',       schedule: '0 5 * * 1',     maxDuration: 30, description: 'Weekly belief-system maintenance (Mondays)' },
  { id: 'wisdom-habit-maintenance',   path: '/api/cron/wisdom-habit-maintenance', schedule: '15 5 * * 1',    maxDuration: 30, description: 'Weekly wisdom/habit maintenance (Mondays)' },
  { id: 'aging-tick',                 path: '/api/cron/aging-tick',               schedule: '0 7 * * *',     maxDuration: 30, description: 'Daily character aging tick' },
  { id: 'animate-backfill',           path: '/api/cron/animate-backfill',         schedule: '0 */6 * * *',   maxDuration: 30, description: 'Backfills missing animations, every 6h' },
  { id: 'registration-reminders',     path: '/api/cron/registration-reminders',   schedule: '0 * * * *',     maxDuration: 60, description: 'Hourly registration reminder emails' },
  { id: 'daily-world-choice',         path: '/api/cron/daily-world-choice',       schedule: '5 4 * * *',     maxDuration: 60, description: 'Daily world-choice event' },
  { id: 'message-recovery',           path: '/api/cron/message-recovery',         schedule: '*/5 * * * *',   maxDuration: 30, description: 'Recovers stuck/failed messages, every 5min' },
  { id: 'revocation-sweep',           path: '/api/cron/revocation-sweep',         schedule: '0 * * * *',     maxDuration: 30, description: 'Hourly token/session revocation sweep' },
];

/**
 * A cron expression fires "at most once per day" — and is therefore legal
 * on Vercel Hobby exactly as written — iff both the minute and hour fields
 * are fixed values (no `*` and no `/` step). Day-of-month/month/weekday
 * restrictions (weekly jobs like memory-archive) only make it fire LESS
 * often, so they don't need special handling here.
 */
export function isDailyOrLess(schedule) {
  const [minute, hour] = schedule.trim().split(/\s+/);
  const isFixed = (field) => !field.includes('*') && !field.includes('/');
  return isFixed(minute) && isFixed(hour);
}

/**
 * Jobs eligible for ANY kind of automatic scheduling on CRON_TIER=free —
 * i.e. jobs that both fit Hobby's duration ceiling (fitsFreeTier) and are
 * the ones nativeOnFree/externalOnFree below further split by frequency.
 * A job that fails fitsFreeTier is excluded here and therefore excluded
 * from both native Vercel cron and the GitHub Actions fallback: there is
 * no scheduling trick that fixes a duration problem, only a frequency one.
 */
const schedulableOnFree = () => CRON_JOBS.filter(fitsFreeTier);

/** Jobs that Vercel's own Hobby-tier scheduler can run as-written. */
export const nativeOnFree = () => schedulableOnFree().filter((j) => isDailyOrLess(j.schedule));

/** Jobs that need an external scheduler on Hobby (fire more than once/day). */
export const externalOnFree = () => schedulableOnFree().filter((j) => !isDailyOrLess(j.schedule));

/** Jobs whose real duration budget is too large to ever run on CRON_TIER=free — see fitsFreeTier. */
export const excludedFromFree = () => CRON_JOBS.filter((j) => !fitsFreeTier(j));
