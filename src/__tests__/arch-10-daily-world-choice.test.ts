/**
 * ARCH-10 — Daily World Choice: consume-once guarantee & tick-engine wiring
 *
 * Mirrors the verification style of ARCH-09 (world-tick race guards):
 * static assertions against the actual source, because the property under
 * test is "does this code contain the exact guard clause it claims to",
 * not business logic that benefits from mocking supabase-js's fluent
 * builder. A resolved-choice race is the same class of bug ARCH-09 already
 * covers for last_ticked_at — this file checks the newer surface that
 * builds on top of it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('ARCH-10 — resolveLocationChoiceLean claims a choice atomically, exactly once', () => {
  const file = src('lib', 'universe', 'daily-choice.ts');

  it('the claiming UPDATE is conditioned on resolved = false, same idiom as last_ticked_at guards', () => {
    expect(file).toMatch(/\.update\(\{\s*resolved:\s*true/);
    expect(file).toMatch(/\.eq\("resolved",\s*false\)/);
  });

  it('a lean is only returned when the claim actually matched a row (claimed truthy)', () => {
    expect(file).toMatch(/if\s*\(!claimed \|\| !relevant \|\| !winningEffect\) return null;/);
  });

  it('a choice is NOT claimed when the winning effect belongs to the other engine — regression test for the economy/governance cadence mismatch bug (economy ticks hourly, governance every 4h, so economy_tick was silently claiming-and-dropping governance_pressure effects before governance_tick ever ran)', () => {
    expect(file).toMatch(/if\s*\(winningEffect && !relevant\) return null;/);
    // this guard must run BEFORE the claiming UPDATE, not after
    const guardIdx  = file.indexOf('if (winningEffect && !relevant) return null;');
    const claimIdx  = file.indexOf('.update({\n      resolved: true,');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(claimIdx);
  });

  it('zero-vote choices still resolve (no lingering unresolved rows) but yield no lean', () => {
    expect(file).toMatch(/winningOption = tally\.votesA > tally\.votesB \? "a" : tally\.votesB > tally\.votesA \? "b" : null/);
  });

  it('only choices at least ~30 minutes old are eligible, so a choice can\'t be consumed before votes exist', () => {
    expect(file).toMatch(/Date\.now\(\)\s*-\s*30\s*\*\s*60\s*\*\s*1000/);
  });

  it('the engine filter prevents a governance-tick call from consuming an economy_pressure effect and vice versa', () => {
    expect(file).toMatch(/const relevant = winningEffect && winningEffect\.type === engine;/);
  });

  it('vote insertion is idempotent — a second cast returns the existing vote rather than throwing', () => {
    expect(file).toMatch(/export async function castVote/);
    expect(file).toMatch(/if \(existing\) return \{ status: "already_voted", option: existing \};/);
  });
});

describe('ARCH-10 — governance and economy ticks actually consume the lean, not just import it', () => {
  it('runGovernanceTick calls resolveLocationChoiceLean before computing newApproval/newStability', () => {
    const file = src('lib', 'universe', 'governance.ts');
    expect(file).toMatch(/import\s*\{\s*resolveLocationChoiceLean\s*\}\s*from\s*'\.\/daily-choice'/);
    const leanIdx = file.indexOf("resolveLocationChoiceLean(locationId, 'governance_pressure')");
    const newApprovalIdx = file.indexOf('const newApproval');
    expect(leanIdx).toBeGreaterThan(-1);
    expect(leanIdx).toBeLessThan(newApprovalIdx);
  });

  it('runEconomyTick calls resolveLocationChoiceLean before computing newGdp/newUnemployment', () => {
    const file = src('lib', 'universe', 'economy.ts');
    expect(file).toMatch(/import\s*\{\s*resolveLocationChoiceLean\s*\}\s*from\s*'\.\/daily-choice'/);
    const leanIdx = file.indexOf("resolveLocationChoiceLean(locationId, 'economy_pressure')");
    const newGdpIdx = file.indexOf('const newGdp');
    expect(leanIdx).toBeGreaterThan(-1);
    expect(leanIdx).toBeLessThan(newGdpIdx);
  });

  it('the gdp lean is scaled to current gdp, not a flat constant, since gdp has no fixed range', () => {
    const file = src('lib', 'universe', 'economy.ts');
    expect(file).toMatch(/Math\.round\(econ\.gdp \* 0\.02\)/);
  });
});

describe('ARCH-10 — RLS: votes are insert-your-own-only, no update/delete policy exists', () => {
  const migration = src('..', 'supabase', 'migrations', '20260905_daily_world_choice.sql');

  it('enables RLS on both new tables', () => {
    expect(migration).toMatch(/ALTER TABLE daily_world_choices\s+ENABLE ROW LEVEL SECURITY;/);
    expect(migration).toMatch(/ALTER TABLE user_world_choice_votes\s+ENABLE ROW LEVEL SECURITY;/);
  });

  it('only SELECT and INSERT policies exist on votes — no UPDATE/DELETE policy lets a user change their vote after seeing the tally', () => {
    expect(migration).toMatch(/CREATE POLICY "users_read_own_vote"/);
    expect(migration).toMatch(/CREATE POLICY "users_insert_own_vote"/);
    expect(migration).not.toMatch(/CREATE POLICY[^;]*ON user_world_choice_votes[^;]*FOR UPDATE/);
    expect(migration).not.toMatch(/CREATE POLICY[^;]*ON user_world_choice_votes[^;]*FOR DELETE/);
  });

  it('one vote per user per choice is enforced at the DB level, not just the API', () => {
    expect(migration).toMatch(/UNIQUE \(choice_id, user_id\)/);
  });

  it('exactly one active choice per day is enforced at the DB level', () => {
    expect(migration).toMatch(/UNIQUE \(active_date\)/);
  });
});
