/**
 * ARCH-12 — Wisdom/habit maintenance cron actually decays stale entries
 *
 * Previously runWisdomMaintenanceCron()/runHabitMaintenanceCron() were
 * called with a shared sinceTurn=0 for every pair. Since a real
 * lastAppliedTurn/lastFiredTurn is never negative, `x >= 0` is true for
 * every row, every week — the decay guard's `continue` fired
 * unconditionally, so the sweep silently decayed nothing, ever, while
 * still reporting success. Verified by direct trace of the actual
 * comparison, not inference.
 *
 * Same verification style as ARCH-10/ARCH-11: static assertions against
 * the real source, because what's under test is "does each pair now
 * carry its own real turn count instead of a shared constant zero",
 * which is a wiring/data-flow property, not business logic that benefits
 * from mocking supabase-js's fluent builder.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('ARCH-12 — each pair carries its own currentTurn, not a shared sinceTurn=0', () => {
  const route = src('app', 'api', 'cron', 'wisdom-habit-maintenance', 'route.ts');
  const wisdomEngine = src('lib', 'cognition', 'wisdom-engine.ts');
  const habitEngine = src('lib', 'cognition', 'habit-engine.ts');

  it('the cron route no longer passes a hardcoded 0 to either *MaintenanceCron function', () => {
    expect(route).not.toMatch(/runWisdomMaintenanceCron\(wisdomPairs,\s*0\)/);
    expect(route).not.toMatch(/runHabitMaintenanceCron\(habitPairs,\s*0\)/);
  });

  it('distinctPairs() fetches real per-pair turn counts from character_psychology.total_interactions', () => {
    expect(route).toMatch(/\.from\('character_psychology'\)/);
    expect(route).toMatch(/select\('user_id,character_id,total_interactions'\)/);
    expect(route).toMatch(/currentTurn: turnByPair\.get/);
  });

  it('runWisdomMaintenanceCron/runHabitMaintenanceCron signatures require currentTurn per pair (no sinceTurn default parameter)', () => {
    expect(wisdomEngine).toMatch(/distinctPairs: Array<\{ userId: string; characterId: string; currentTurn: number \}>/);
    expect(wisdomEngine).not.toMatch(/sinceTurn = 0/);
    expect(habitEngine).toMatch(/distinctPairs: Array<\{ userId: string; characterId: string; currentTurn: number \}>/);
    expect(habitEngine).not.toMatch(/sinceTurn = 0/);
  });

  it('each pair\'s own currentTurn is threaded through to the per-pair maintenance call', () => {
    expect(wisdomEngine).toMatch(/await runWisdomMaintenance\(userId, characterId, currentTurn\)/);
    expect(habitEngine).toMatch(/await runHabitMaintenance\(userId, characterId, currentTurn\)/);
  });

  it('regression guard: the decay-guard comparison itself (lastAppliedTurn/lastFiredTurn >= sinceTurn) is unchanged — the fix is in what value sinceTurn receives, not the comparison logic', () => {
    expect(wisdomEngine).toMatch(/if \(principle\.lastAppliedTurn >= sinceTurn\) continue;/);
    expect(habitEngine).toMatch(/if \(habit\.lastFiredTurn >= sinceTurn\) continue;/);
  });
});
