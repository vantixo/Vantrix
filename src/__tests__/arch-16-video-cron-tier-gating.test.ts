/**
 * ARCH-16 — content-engine-video cannot be scheduled to fail on CRON_TIER=free
 *
 * Bug: config/cron-jobs.mjs declares content-engine-video's real budget at
 * maxDuration: 280 (needed for submit + bounded poll + R2 upload), but
 * scripts/generate-vercel-json.mjs clamps every job's duration to 60s on
 * CRON_TIER=free for deploy legality (Vercel Hobby's hard ceiling) and,
 * before this fix, scheduled the job anyway because its cron expression
 * ("50 2 * * *") is daily-or-less — the same test isDailyOrLess() applies
 * to every other job. Result: on Hobby, this job would fire nightly,
 * submit a real paid video-generation request, and get killed by the
 * platform mid-poll every single time, discovered only by a missed
 * dead-man's-switch ping or a draining wallet.
 *
 * Fix: fitsFreeTier()/excludedFromFree() in config/cron-jobs.mjs separate
 * "legal to deploy" (frequency-only) from "can actually complete"
 * (duration-aware), and nativeOnFree()/externalOnFree() are built on top
 * of the latter — so a job whose real maxDuration exceeds Hobby's ceiling
 * is excluded from BOTH the native vercel.json crons array and the
 * GitHub Actions free-tier fallback, not just clamped-and-scheduled. The
 * route itself also self-skips at runtime via env.CRON_TIER as a second,
 * independent guard against direct/manual invocation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

function root(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', '..', ...parts), 'utf-8');
}

describe('ARCH-16 — config/cron-jobs.mjs excludes over-budget jobs from free-tier scheduling entirely', () => {
  it('fitsFreeTier/excludedFromFree exist and are duration-aware, not just frequency-aware', () => {
    const cfg = root('config', 'cron-jobs.mjs');
    expect(cfg).toMatch(/export function fitsFreeTier\(job\)/);
    expect(cfg).toMatch(/job\.maxDuration <= HOBBY_MAX_DURATION_SECONDS/);
    expect(cfg).toMatch(/export const excludedFromFree/);
  });

  it('nativeOnFree and externalOnFree are both built on the duration-aware filter, not raw CRON_JOBS', () => {
    const cfg = root('config', 'cron-jobs.mjs');
    // Old bug shape: `CRON_JOBS.filter((j) => isDailyOrLess(j.schedule))` —
    // frequency-only, no duration check at all.
    expect(cfg).not.toMatch(/export const nativeOnFree = \(\) => CRON_JOBS\.filter/);
    expect(cfg).toMatch(/const schedulableOnFree = \(\) => CRON_JOBS\.filter\(fitsFreeTier\)/);
    expect(cfg).toMatch(/nativeOnFree = \(\) => schedulableOnFree\(\)\.filter/);
    expect(cfg).toMatch(/externalOnFree = \(\) => schedulableOnFree\(\)\.filter/);
  });

  it('content-engine-video is the job that fails the fit check (maxDuration 280 > 60)', () => {
    const cfg = root('config', 'cron-jobs.mjs');
    const entry = cfg.match(/\{ id: 'content-engine-video',[^}]*\}/);
    expect(entry).not.toBeNull();
    expect(entry![0]).toMatch(/maxDuration: 280/);
  });

  it('scripts/generate-vercel-json.mjs imports HOBBY_MAX_DURATION_SECONDS instead of redeclaring the ceiling', () => {
    const gen = root('scripts', 'generate-vercel-json.mjs');
    expect(gen).toMatch(/HOBBY_MAX_DURATION_SECONDS/);
    expect(gen).toMatch(/const FREE_MAX_DURATION = HOBBY_MAX_DURATION_SECONDS/);
  });

  it('the generator prints a build-time warning for any job excluded from free-tier scheduling', () => {
    const gen = root('scripts', 'generate-vercel-json.mjs');
    expect(gen).toMatch(/excludedFromFree\(\)/);
    expect(gen).toMatch(/console\.warn/);
  });
});

describe('ARCH-16 — the currently-generated free-tier vercel.json actually reflects the fix', () => {
  it('content-engine-video is NOT in the generated crons array', () => {
    const vercelJson = JSON.parse(root('vercel.json'));
    const cronPaths = (vercelJson.crons as Array<{ path: string }>).map((c) => c.path);
    expect(cronPaths).not.toContain('/api/cron/content-engine-video');
  });

  it('content-engine-video is NOT in the generated free-tier GitHub Actions workflow', () => {
    const workflow = root('.github', 'workflows', 'vantrix-free-tier-crons.yml');
    expect(workflow).not.toMatch(/content-engine-video/);
  });

  it('every other daily-or-less job that actually fits the duration budget is still scheduled — the fix excludes over-budget jobs, not the mechanism', () => {
    const vercelJson = JSON.parse(root('vercel.json'));
    const cronPaths = (vercelJson.crons as Array<{ path: string }>).map((c) => c.path);
    expect(cronPaths).toContain('/api/cron/daily-reset');
    // content-engine is NOT asserted present here: config/cron-jobs.mjs's
    // registry previously under-declared content-engine/universe-images/
    // backstory-engine at maxDuration: 60 when their real Fal/OpenRouter
    // batches genuinely run up to 280s — the exact same silent-mid-batch-
    // kill failure mode this test file's header describes for
    // content-engine-video, just undetected for these three because
    // nothing had corrected their declared duration yet. Now that
    // config/cron-jobs.mjs declares their real cost, fitsFreeTier()
    // correctly excludes all three from free-tier scheduling too — see
    // config/cron-jobs.mjs's own comment at those three entries.
    expect(cronPaths).not.toContain('/api/cron/content-engine');
    expect(cronPaths.length).toBeGreaterThan(10);
  });
});

describe('ARCH-16 — the route itself independently self-skips on CRON_TIER=free', () => {
  it('reads env.CRON_TIER and returns an ok:true skipped response before doing any paid work', () => {
    const route = src('app', 'api', 'cron', 'content-engine-video', 'route.ts');
    const guard = route.match(/if \(env\.CRON_TIER === "free"\) \{[\s\S]*?\n {2}\}/);
    expect(guard).not.toBeNull();
    expect(guard![0]).toMatch(/skipped: true/);
    // Must return before enqueueAndGenerate is actually CALLED (the import
    // line naturally appears earlier in the file and doesn't count).
    const guardIndex = route.indexOf('env.CRON_TIER === "free"');
    const callIndex = route.indexOf('await enqueueAndGenerate({');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(callIndex).toBeGreaterThan(guardIndex);
  });

  it('the skip path pings heartbeatSuccess, not heartbeatFail — an expected skip should not page anyone', () => {
    const route = src('app', 'api', 'cron', 'content-engine-video', 'route.ts');
    const guard = route.match(/if \(env\.CRON_TIER === "free"\) \{[\s\S]*?\n {2}\}/);
    expect(guard![0]).toMatch(/heartbeatSuccess\(heartbeatName\)/);
    expect(guard![0]).not.toMatch(/heartbeatFail/);
  });
});

describe('ARCH-16 — CRON_TIER is validated and available at request runtime, not just at build time', () => {
  it('src/env.ts exposes CRON_TIER as a validated enum defaulting to the safe (skip) side', () => {
    const env = src('env.ts');
    expect(env).toMatch(/CRON_TIER:\s*z\.enum\(\['free', 'pro'\]\)\.default\('free'\)/);
  });
});
