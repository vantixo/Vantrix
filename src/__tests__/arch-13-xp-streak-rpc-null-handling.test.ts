/**
 * ARCH-13 — awardXp()/checkStreak() no longer trust RPC return values that
 * don't exist
 *
 * increment_xp genuinely RETURNS VOID in the live SQL function (verified
 * against 20240101_production.sql) — PostgREST returns null for a void
 * RPC. awardXp() used to cast that null to a rich result object and read
 * `.leveled_up` off it directly, throwing a TypeError on every single
 * call. Both real callers (chat/stream/route.ts, queue/worker.ts) fire
 * this on every message via .catch(bg(...)), so the crash was silently
 * swallowed — meaning level-up unlockables have never actually been
 * granted, even though the underlying XP increment itself succeeds.
 *
 * check_and_update_streak's cast had the same shape of problem in the
 * other direction: removing the redundant cast surfaced (via tsc) that
 * the code was accessing `.streak`/`.broken`/etc. on a value TypeScript
 * correctly says can be null — the cast wasn't just stale, it was masking
 * a real unhandled-failure path this whole time.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('ARCH-13 — awardXp() reads real post-increment state instead of a nonexistent RPC return value', () => {
  const engine = src('lib', 'growth', 'streak-rewards-engine.ts');

  it('no longer casts the increment_xp RPC result to a rich object shape', () => {
    expect(engine).not.toMatch(/data as unknown as \{ total_xp: number; level: number; leveled_up: boolean; xp_to_next: number \}/);
  });

  it('captures level before the RPC call and re-fetches user_xp after, deriving leveled_up by comparison', () => {
    expect(engine).toMatch(/const beforeLevel = \(/);
    expect(engine).toMatch(/leveled_up: \(after\?\.level \?\? beforeLevel\) > beforeLevel/);
  });

  it('the before-state read happens before the increment_xp RPC call, not after', () => {
    const beforeIdx = engine.indexOf('const beforeLevel = (');
    const rpcIdx = engine.indexOf(`await supabaseAdmin.rpc('increment_xp'`);
    expect(beforeIdx).toBeGreaterThan(-1);
    expect(rpcIdx).toBeGreaterThan(-1);
    expect(beforeIdx).toBeLessThan(rpcIdx);
  });
});

describe('ARCH-13 — checkStreak() no longer masks a possible-null RPC response behind a stale cast', () => {
  const engine = src('lib', 'growth', 'streak-rewards-engine.ts');

  it('throws a clear, diagnosable error instead of silently accessing properties on null', () => {
    expect(engine).toMatch(/checkStreak: check_and_update_streak RPC failed for \$\{userId\}/);
  });

  it('defensively normalizes an array-or-object RPC response, matching the sibling consume_streak_shield handling for the same RETURNS TABLE\\(\\.\\.\\.\\) SQL signature', () => {
    expect(engine).toMatch(/const result = Array\.isArray\(data\) \? data\[0\] : data;/);
  });
});
