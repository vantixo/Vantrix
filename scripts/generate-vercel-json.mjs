#!/usr/bin/env node
/**
 * scripts/generate-vercel-json.mjs
 *
 * Generates vercel.json from config/cron-jobs.mjs, tiered by CRON_TIER.
 *
 *   CRON_TIER=free (default)  → deployable on Vercel Hobby today.
 *   CRON_TIER=pro              → full-frequency schedules, for when you've
 *                                 upgraded to Vercel Pro.
 *
 * Runs automatically in `prebuild` (see package.json), so vercel.json is
 * always freshly generated from config/cron-jobs.mjs before every build —
 * on your machine, in CI, and on Vercel itself (Vercel runs your project's
 * build command, including npm's pre/post hooks, before reading the
 * resulting vercel.json to register crons/functions for the deployment).
 *
 * ── What changes between tiers ──────────────────────────────────────────
 *
 * 1. Crons (Hobby: max once/day per job, or the deploy is rejected)
 *    - free: only jobs that already fire ≤ once/day go into vercel.json's
 *      `crons` array, scheduled exactly as configured (nothing lost).
 *    - pro:  every job goes into `crons`, at its real frequency.
 *    - The sub-daily jobs (queue/worker every minute, billing-recovery
 *      every 5min, the world-simulation ticks every 2-6h, etc.) can't run
 *      on Hobby's own scheduler at their real cadence. On `free` this
 *      script instead emits .github/workflows/vantrix-free-tier-crons.yml,
 *      which hits the SAME routes on the SAME schedule from GitHub Actions
 *      (an external caller — Vercel's Hobby frequency cap only limits its
 *      own built-in scheduler, not requests from elsewhere). Every route
 *      already authenticates via requireCronAuth() (Bearer/x-cron-secret),
 *      so this is exactly as secure as Vercel's own cron trigger, and
 *      src/lib/cron/lock.ts already guards against double-firing if a
 *      route is ever reachable from two schedulers during a tier switch.
 *
 * 2. Function duration (Hobby: 60s hard max)
 *    - free: any maxDuration above 60 is clamped to 60 *for deploy
 *      legality* — Hobby rejects a `functions` entry above its ceiling.
 *    - pro:  real values (up to 280s) are used unclamped.
 *
 * 3. Regions (Hobby: single region only; deploy fails before the build
 *    step if you list more than your plan allows)
 *    - free: collapses `regions` to the first entry only.
 *    - pro:  keeps the full regions list.
 *
 * 4. Jobs whose REAL maxDuration exceeds 60s (today: just content-engine-video,
 *    which genuinely needs up to 280s — see config/cron-jobs.mjs's
 *    fitsFreeTier()) are NOT scheduled at all on `free`, in either `crons`
 *    or the GitHub Actions workflow below. Clamping-and-scheduling that job
 *    like every other one would deploy cleanly and then time out on every
 *    real invocation — the duration ceiling is enforced by the Vercel
 *    Function itself, so no external scheduler works around it the way
 *    GitHub Actions works around the frequency cap in (1). Its `functions`
 *    entry is still emitted (clamped, same as any other job) purely so a
 *    manual/direct hit of the route doesn't hit an unconfigured-duration
 *    default; the route itself also self-skips at runtime on CRON_TIER=free
 *    — see its header comment. It moves into `crons` automatically the
 *    moment CRON_TIER=pro is set.
 *
 * Usage:
 *   CRON_TIER=free node scripts/generate-vercel-json.mjs   (default)
 *   CRON_TIER=pro  node scripts/generate-vercel-json.mjs
 *   npm run cron:generate:free
 *   npm run cron:generate:pro
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CRON_JOBS,
  nativeOnFree,
  externalOnFree,
  excludedFromFree,
  githubActionsSchedule,
  HOBBY_MAX_DURATION_SECONDS,
} from '../config/cron-jobs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const TIER = (process.env.CRON_TIER || 'free').toLowerCase();
if (TIER !== 'free' && TIER !== 'pro') {
  console.error(`✗ CRON_TIER must be "free" or "pro", got "${TIER}"`);
  process.exit(1);
}

// Imported from config/cron-jobs.mjs rather than redeclared here, so this
// number and the one fitsFreeTier() checks jobs against can never drift.
const FREE_MAX_DURATION = HOBBY_MAX_DURATION_SECONDS; // Vercel Hobby hard ceiling (no Fluid compute override assumed)

// ── Non-cron function duration budgets (unrelated to crons, but the same
//    Hobby 60s ceiling applies, so this must be tier-aware too or a `free`
//    deploy fails on these three routes regardless of the cron work above) ──
const OTHER_FUNCTIONS = {
  'src/app/api/chat/stream/route.ts':          45,
  'src/app/api/chat/guest/route.ts':           30,
  'src/app/api/chat/image/route.ts':           60,
  'src/app/api/images/generate-batch/route.ts':280,
  'src/app/api/queue/workers/route.ts':        60,
  'src/app/api/notifications/route.ts':        25,
  'src/app/api/characters/generate-image/route.ts': 15,
  'src/app/api/user/export/route.ts':          30,
  'src/app/api/webhooks/fal-lora/route.ts':    120,
  'src/app/api/workers/run/route.ts':          280,
  'src/app/api/universe/status/route.ts':      15,
  'src/app/api/universe/legends/route.ts':     15,
  'src/app/api/universe/history/route.ts':     15,
  'src/app/api/universe/artifacts/route.ts':   15,
  'src/app/api/universe/world/route.ts':       15,
  'src/app/api/universe/locations/route.ts':   15,
  'src/app/api/universe/factions/route.ts':    15,
  'src/app/api/universe/profile/route.ts':     15,
  // Previously missing from this map entirely, so vercel.json had no
  // `functions` entry for any of them — on CRON_TIER=free that left Vercel
  // to fall back on each route's own uncapped `export const maxDuration`
  // (fal-animate/fal-3d-model 120, admin/generate-character-models 120,
  // admin/content-queue[/[id]] 280, admin/generate-character-portraits 300,
  // digital-twin/train 300), all above Hobby's ceiling and none tier-aware.
  // Routed through capDuration() like every other entry here now.
  'src/app/api/webhooks/fal-animate/route.ts':              120,
  'src/app/api/webhooks/fal-3d-model/route.ts':              120,
  'src/app/api/admin/content-queue/route.ts':                280,
  'src/app/api/admin/content-queue/[id]/route.ts':           280,
  'src/app/api/admin/generate-character-portraits/route.ts': 300,
  'src/app/api/admin/generate-character-models/route.ts':    120,
  'src/app/api/digital-twin/train/route.ts':                 300,
};

const ALL_REGIONS = ['iad1', 'sin1', 'fra1'];

function capDuration(seconds) {
  return TIER === 'free' ? Math.min(seconds, FREE_MAX_DURATION) : seconds;
}

function routeFileFor(job) {
  // '/api/cron/daily-reset' -> 'src/app/api/cron/daily-reset/route.ts'
  return `src/app${job.path}/route.ts`;
}

// ── crons[] ──────────────────────────────────────────────────────────────
const eligibleJobs = TIER === 'free' ? nativeOnFree() : CRON_JOBS;
const crons = eligibleJobs.map((j) => ({ path: j.path, schedule: j.schedule }));

// ── functions{} ──────────────────────────────────────────────────────────
const functions = {};
for (const job of CRON_JOBS) {
  functions[routeFileFor(job)] = { maxDuration: capDuration(job.maxDuration) };
}
for (const [file, seconds] of Object.entries(OTHER_FUNCTIONS)) {
  functions[file] = { maxDuration: capDuration(seconds) };
}

// ── full vercel.json ─────────────────────────────────────────────────────
const vercelConfig = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: 'nextjs',
  buildCommand: 'npm run build',
  installCommand: 'npm ci',
  regions: TIER === 'free' ? [ALL_REGIONS[0]] : ALL_REGIONS,
  crons,
  headers: [
    {
      source: '/api/(.*)',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
    },
  ],
  rewrites: [{ source: '/health', destination: '/api/health' }],
  redirects: [{ source: '/home', destination: '/discover', permanent: true }],
  env: {
    NODE_ENV: 'production',
    NODE_OPTIONS: '--max-old-space-size=8192',
  },
  functions,
};

writeFileSync(
  join(ROOT, 'vercel.json'),
  JSON.stringify(vercelConfig, null, 2) + '\n',
);

console.log(`✓ vercel.json generated for CRON_TIER=${TIER}`);
console.log(`  ${crons.length}/${CRON_JOBS.length} jobs scheduled natively in vercel.json`);

// ── Loud, build-time visibility for jobs that CANNOT run on this tier ─────
// (as opposed to jobs merely deferred to the GitHub Actions fallback, which
// still run at full frequency — see CRON_TIERS.md). Silently clamping one
// of these down to FREE_MAX_DURATION and scheduling it anyway is exactly
// the bug this script exists to prevent: it would deploy clean and then
// fail on every real invocation, discovered only by someone noticing a
// dead man's switch alert or missing output days later.
if (TIER === 'free') {
  const tooLarge = excludedFromFree();
  if (tooLarge.length) {
    console.warn(
      `⚠ ${tooLarge.length} job(s) need more than ${FREE_MAX_DURATION}s and are NOT scheduled on CRON_TIER=free (neither natively nor via GitHub Actions) — they will not run until you switch to CRON_TIER=pro:`,
    );
    for (const j of tooLarge) {
      console.warn(`    - ${j.id} (${j.path}): needs ${j.maxDuration}s`);
    }
  }
}

// ── GitHub Actions fallback for sub-daily jobs on the free tier ───────────
const workflowPath = join(ROOT, '.github/workflows/vantrix-free-tier-crons.yml');
if (TIER === 'free') {
  const jobs = externalOnFree();
  const lines = [];
  lines.push('# AUTO-GENERATED by scripts/generate-vercel-json.mjs — do not hand-edit.');
  lines.push('#');
  lines.push('# Drives the cron jobs that fire more than once/day, which Vercel Hobby');
  lines.push("# can't schedule natively. Each job below hits its Vantrix route on its");
  lines.push('# real cadence, authenticating exactly like Vercel Cron does.');
  lines.push('#');
  lines.push('# Setup — add two repo secrets (Settings → Secrets and variables → Actions):');
  lines.push('#   VANTRIX_BASE_URL   e.g. https://your-app.vercel.app');
  lines.push('#   CRON_SECRET        same value as the CRON_SECRET env var on Vercel');
  lines.push('#');
  lines.push('# When you upgrade to Vercel Pro: set CRON_TIER=pro and redeploy — the');
  lines.push('# same jobs move into vercel.json at full precision. You can then delete');
  lines.push('# this workflow file (or just leave it disabled; nothing depends on it).');
  lines.push('#');
  lines.push('# Caveat: GitHub Actions schedules are best-effort (can run several minutes');
  lines.push('# late under load) and are auto-disabled after 60 days with no repo');
  lines.push('# activity. For the money-moving jobs (billing-recovery) consider a');
  lines.push('# dedicated pinger (e.g. cron-job.org, free) instead if exact timing matters.');
  lines.push('name: Vantrix free-tier crons');
  lines.push('on:');
  lines.push('  workflow_dispatch: {}');
  lines.push('  schedule:');
  // Dedupe: several jobs legitimately share a cadence (e.g. training-data-export,
  // economy-tick, registration-reminders, and revocation-sweep are all hourly).
  // One trigger entry per distinct schedule; the run step below fires every
  // job whose schedule matches, not just one.
  //
  // Schedules are run through githubActionsSchedule() first — GitHub Actions'
  // own scheduler cannot fire more often than every 5 minutes (unlike Vercel
  // Cron, whose Hobby/Pro split is already handled by fitsFreeTier/capDuration
  // above). A job whose real cadence is sub-5-minute (today: only
  // queue-worker, at '* * * * *') gets clamped to '*/5 * * * *' here — its
  // route is expected to compensate for the lower external trigger frequency
  // internally (see /api/queue/worker's drain loop) since GitHub simply
  // cannot be told to call it any more often than that.
  const scheduleGroups = new Map();
  for (const job of jobs) {
    const ghSchedule = githubActionsSchedule(job);
    if (!scheduleGroups.has(ghSchedule)) scheduleGroups.set(ghSchedule, []);
    scheduleGroups.get(ghSchedule).push(job.id);
  }
  for (const [schedule, ids] of scheduleGroups) {
    lines.push(`    - cron: '${schedule}' # ${ids.join(', ')}`);
  }
  lines.push('jobs:');
  lines.push('  dispatch:');
  lines.push('    runs-on: ubuntu-latest');
  lines.push('    steps:');
  lines.push('      - name: Determine which job(s) are due this run');
  lines.push('        env:');
  lines.push('          CRON_SECRET: ${{ secrets.CRON_SECRET }}');
  lines.push('          BASE_URL: ${{ secrets.VANTRIX_BASE_URL }}');
  lines.push('        run: |');
  lines.push('          set -e');
  lines.push('          SCHEDULE="${{ github.event.schedule }}"');
  lines.push('          # schedule::path pairs, one per job. Several jobs legitimately share');
  lines.push('          # a cadence (e.g. four jobs all run "0 * * * *"), so this is a list to');
  lines.push('          # loop and filter, not a schedule -> single-path map.');
  lines.push('          PAIRS=(');
  for (const job of jobs) {
    // Matched against $SCHEDULE below, which is github.event.schedule — the
    // clamped schedule GitHub actually fired on, not job's real cadence.
    lines.push(`            "${githubActionsSchedule(job)}::${job.path}"`);
  }
  lines.push('          )');
  lines.push('          FAILED=()');
  lines.push('          fire() {');
  lines.push('            local path="$1"');
  lines.push('            echo "-> $path"');
  lines.push('            if curl -fsS -X GET "$BASE_URL$path" -H "Authorization: Bearer $CRON_SECRET"; then');
  lines.push('              echo "   ok $path"');
  lines.push('            else');
  lines.push('              echo "   ! $path failed"');
  lines.push('              FAILED+=("$path")');
  lines.push('            fi');
  lines.push('          }');
  lines.push('          if [ -z "$SCHEDULE" ]; then');
  lines.push('            echo "Manual run (workflow_dispatch) — hitting every job once."');
  lines.push('            for pair in "${PAIRS[@]}"; do fire "${pair#*::}"; done');
  lines.push('          else');
  lines.push('            echo "Schedule $SCHEDULE fired — running all jobs on that cadence:"');
  lines.push('            for pair in "${PAIRS[@]}"; do');
  lines.push('              if [ "${pair%%::*}" = "$SCHEDULE" ]; then fire "${pair#*::}"; fi');
  lines.push('            done');
  lines.push('          fi');
  lines.push('          # Every matching route is fired above regardless of earlier failures');
  lines.push('          # (a stuck economy-tick shouldn\'t suppress billing-recovery). Failure');
  lines.push('          # is only surfaced now, once the whole batch has run — this is what');
  lines.push('          # actually failed silently before: `|| echo` always exited 0, so a');
  lines.push('          # dead route showed green here forever. Non-zero exit -> failed GH');
  lines.push('          # Actions run -> default email/UI notification to repo watchers.');
  lines.push('          if [ ${#FAILED[@]} -gt 0 ]; then');
  lines.push('            echo "::error::${#FAILED[@]} cron route(s) failed: ${FAILED[*]}"');
  lines.push('            exit 1');
  lines.push('          fi');
  lines.push('');

  mkdirSync(dirname(workflowPath), { recursive: true });
  writeFileSync(workflowPath, lines.join('\n'));
  console.log(`✓ .github/workflows/vantrix-free-tier-crons.yml generated (${jobs.length} sub-daily jobs)`);
} else if (existsSync(workflowPath)) {
  console.log('  (pro tier — vantrix-free-tier-crons.yml left as-is; safe to delete once confirmed migrated)');
}
