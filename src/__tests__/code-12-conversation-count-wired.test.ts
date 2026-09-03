/**
 * CODE-12 — dating_matches.conversation_count Is Actually Written
 *
 * Regression test for: dating_matches.conversation_count (NOT NULL DEFAULT
 * 0, added in 20240101_production.sql) is read by three separate dating
 * features —
 *   - dating/compatibility/route.ts (engagement factor + the "10 new
 *     conversations" recompute trigger)
 *   - dating/chemistry/route.ts (the "Engagement" dimension + pacing)
 *   - dating/forecast/route.ts (the "Conversation" forecast dimension +
 *     strengthens/friction insight lines)
 * — but no code path anywhere in the app ever incremented it. It was
 * permanently 0 for every match, silently degrading all three features
 * (Engagement always at floor, pacing always computed off a zero
 * denominator, the count-based compatibility recompute trigger dead code
 * in practice, the forecast's "Conversation" dimension frozen at "Just
 * getting started" forever).
 *
 * Fix: 20261125_dating_conversation_count_wiring.sql adds an atomic
 * increment_conversation_count() RPC, called from dating/mood/route.ts —
 * the same session-end choke point that already advances bond_score and
 * streak_days via update_bond_score/update_dating_streak — so all three
 * counters now move together on every real dating chat session instead of
 * two moving and one staying frozen at 0 forever.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

function repoRoot(...parts: string[]): string {
  return join(__dirname, '..', '..', ...parts);
}

describe('CODE-12 — conversation_count is incremented somewhere real', () => {
  it('a migration defines increment_conversation_count() as an atomic UPDATE', () => {
    const migrationsDir = repoRoot('supabase', 'migrations');
    const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
    const owner = files.find(f => {
      const text = readFileSync(join(migrationsDir, f), 'utf-8');
      return /CREATE (OR REPLACE )?FUNCTION increment_conversation_count/.test(text);
    });
    expect(owner).toBeDefined();
    const text = readFileSync(join(migrationsDir, owner!), 'utf-8');
    // Must actually mutate the column, not just read it.
    expect(text).toMatch(/UPDATE\s+dating_matches/i);
    expect(text).toMatch(/conversation_count\s*=\s*conversation_count\s*\+\s*1/i);
  });

  it('dating/mood/route.ts — the session-end choke point — calls the RPC', () => {
    const route = src('app', 'api', 'dating', 'mood', 'route.ts');
    expect(route).toMatch(/rpc\(\s*['"]increment_conversation_count['"]/);
    // Same call site as the two counters it's meant to move alongside —
    // guards against someone "cleaning up" this call into its own isolated
    // request in a future edit, which would just reintroduce a different
    // dead-write path.
    expect(route).toMatch(/rpc\(\s*['"]update_bond_score['"]/);
    expect(route).toMatch(/rpc\(\s*['"]update_dating_streak['"]/);
  });

  it('a failed increment is logged, not silently swallowed', () => {
    const route = src('app', 'api', 'dating', 'mood', 'route.ts');
    expect(route).toMatch(/convCountRes\.error/);
  });

  it('sanity: this file itself exists (guards against a future rename breaking every check above silently passing on a missing file)', () => {
    expect(existsSync(join(__dirname, '..', 'app', 'api', 'dating', 'mood', 'route.ts'))).toBe(true);
  });
});
