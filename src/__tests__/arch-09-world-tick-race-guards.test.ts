/**
 * ARCH-09 — World Tick Duplicate-Invocation & Race-Condition Guards
 *
 * Two layers, verified separately:
 *
 * Layer 1 (cheap, cron-level): every world-tick cron route
 * (economy/governance/narrative/deep/legacy-tick) now acquires a Redis
 * lock (lib/cron/lock.ts, SET NX EX) before doing any work, sized to
 * slightly less than its own schedule interval (vercel.json). A duplicate
 * invocation — platform retry, manual re-trigger — no-ops instead of
 * enqueueing a second full batch of jobs.
 *
 * Layer 2 (the actual guarantee): runEconomyTick() and runGovernanceTick()
 * (lib/universe/economy.ts, lib/universe/governance.ts) make their UPDATE
 * conditional on a dedicated `last_ticked_at` column being NULL or older
 * than the tick's guard window, and check whether the write actually
 * matched a row. This is necessary because layer 1 doesn't cover every
 * path — full_universe_tick (api/workers/run/route.ts) can enqueue a
 * governance_tick job independently of the governance-tick cron's own
 * schedule, so two job rows for the same city can exist and both get
 * processed regardless of any cron-level lock.
 *
 * The conditional-write mechanism was verified against a live, local
 * Postgres 16 instance (not just asserted in a comment): two concurrent
 * writes computing independent deltas off the same stale read resulted in
 * exactly one applied delta, never both, never neither.
 *
 * An earlier revision reused the existing `updated_at` column (already
 * trigger-maintained, no migration needed) instead of adding a dedicated
 * one. That was ALSO verified against the same live instance — and found
 * broken: because updated_at is refreshed by any write to the row, an
 * unrelated write immediately before a due tick caused that tick to be
 * incorrectly skipped, 100% reproducible, not a rare race. `last_ticked_at`
 * (20260711_tick_last_ticked_at.sql) exists specifically so nothing but
 * the tick engines themselves can ever write to it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('ARCH-09 — layer 1: every world-tick cron acquires a lock before enqueueing', () => {
  const routes = ['economy-tick', 'governance-tick', 'narrative-tick', 'deep-tick', 'legacy-tick'];

  it.each(routes)('%s imports and calls acquireCronLock before doing any work', (route) => {
    const file = src('app', 'api', 'cron', route, 'route.ts');
    expect(file).toMatch(/import\s*\{[^}]*\bacquireCronLock\b[^}]*\}\s*from\s*['"]@\/lib\/cron\/lock['"]/);
    const lockIdx  = file.indexOf('acquireCronLock(');
    const authIdx  = file.indexOf('requireCronAuth(');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(authIdx); // auth checked first, then the lock
  });

  it('lock windows are sized to slightly less than each route\'s real vercel.json schedule', () => {
    // economy: hourly (3600s) -> 3300; governance: 4h (14400s) -> 14100;
    // narrative: 2h (7200s) -> 6900; legacy: 6h (21600s) -> 21300;
    // deep: daily (86400s) -> 86100.
    expect(src('app', 'api', 'cron', 'economy-tick', 'route.ts')).toMatch(/acquireCronLock\('economy-tick', 3300\)/);
    expect(src('app', 'api', 'cron', 'governance-tick', 'route.ts')).toMatch(/acquireCronLock\('governance-tick', 14100\)/);
    expect(src('app', 'api', 'cron', 'narrative-tick', 'route.ts')).toMatch(/acquireCronLock\('narrative-tick', 6900\)/);
    expect(src('app', 'api', 'cron', 'legacy-tick', 'route.ts')).toMatch(/acquireCronLock\('legacy-tick', 21300\)/);
    expect(src('app', 'api', 'cron', 'deep-tick', 'route.ts')).toMatch(/acquireCronLock\('deep-tick', 86100\)/);
  });

  it('the lock fails OPEN on a Redis error, never silently blocking every cron during an outage', () => {
    const lock = src('lib', 'cron', 'lock.ts');
    expect(lock).toMatch(/catch\s*\{[\s\S]*return true;/);
  });
});

describe('ARCH-09 — layer 2: per-city tick handlers guard against a double-applied write', () => {
  it('runEconomyTick conditions its UPDATE on location_economy.last_ticked_at and checks the result', () => {
    const file = src('lib', 'universe', 'economy.ts');
    expect(file).toMatch(/\.or\(`last_ticked_at\.is\.null,last_ticked_at\.lt\.\$\{guardCutoff\}`\)/);
    expect(file).toMatch(/if \(!applied\)/);
  });

  it('runGovernanceTick conditions its UPDATE on city_governance.last_ticked_at and checks the result', () => {
    const file = src('lib', 'universe', 'governance.ts');
    expect(file).toMatch(/\.or\(`last_ticked_at\.is\.null,last_ticked_at\.lt\.\$\{guardCutoff\}`\)/);
    expect(file).toMatch(/if \(!applied\)/);
  });

  it('both handlers use a DEDICATED tick column, never reusing the shared updated_at', () => {
    // updated_at is refreshed by ANY write to the row (touch_updated_at
    // fires on every UPDATE regardless of cause). Reusing it as the tick
    // guard was tried and confirmed broken against a live Postgres
    // instance: an unrelated write to the row falsely blocked the next
    // legitimate tick. last_ticked_at is written ONLY by the tick engines.
    const economy    = src('lib', 'universe', 'economy.ts');
    const governance = src('lib', 'universe', 'governance.ts');
    expect(economy).toMatch(/last_ticked_at/);
    expect(governance).toMatch(/last_ticked_at/);
    expect(economy).not.toMatch(/\.or\(`updated_at/);
    expect(governance).not.toMatch(/\.or\(`updated_at/);
  });

  it('the migration adding last_ticked_at exists for both tables', () => {
    const migration = readFileSync(
      join(__dirname, '..', '..', 'supabase', 'migrations', '20260711_tick_last_ticked_at.sql'),
      'utf-8'
    );
    expect(migration).toMatch(/ALTER TABLE location_economy[\s\S]*ADD COLUMN IF NOT EXISTS last_ticked_at/);
    expect(migration).toMatch(/ALTER TABLE city_governance[\s\S]*ADD COLUMN IF NOT EXISTS last_ticked_at/);
  });
});
