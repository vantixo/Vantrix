/**
 * ARCH-11 — Experience → Lesson → Wisdom chain is actually wired
 *
 * recordExperience() had a live call site (chat/stream/route.ts), but
 * reinforceLessons(), synthesizeWisdom(), reflectOnSession(), and
 * getWisdom()/formatWisdomForPrompt() had zero callers anywhere in the
 * codebase — verified by direct grep excluding comments and barrel
 * re-export lines, cross-checked against cognition-engine.ts's re-export
 * names. The entire back half of the pipeline was dead: experiences were
 * logged but never turned into lessons, and lessons (had any existed)
 * were never turned into durable wisdom.
 *
 * Same verification style as ARCH-10: static assertions against the real
 * source, because what's under test is "does this call site exist and is
 * it correctly ordered / correctly gated", not business logic that
 * benefits from mocking the in-process Maps or Redis/Supabase layers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('ARCH-11 — reinforceLessons()/synthesizeWisdom() are wired at a real session boundary', () => {
  const route = src('app', 'api', 'chat', 'stream', 'route.ts');

  it('both functions are imported from the cognition-engine barrel', () => {
    expect(route).toMatch(/getRecentExperiences,\s*reinforceLessons,\s*synthesizeWisdom/);
  });

  it('the session-boundary gate uses the same >=2h "new visit" convention as agency-engine.ts', () => {
    expect(route).toMatch(/hoursSinceLastMsgForSession >= 2/);
  });

  it('does not fire on a relationship\'s very first message (total_interactions > 0 required)', () => {
    expect(route).toMatch(/psychology\.total_interactions > 0 && hoursSinceLastMsgForSession >= 2/);
  });

  it('reinforceLessons is called with this-session\'s recorded experiences before synthesizeWisdom', () => {
    const reinforceIdx   = route.indexOf('reinforceLessons(userId, characterId, psychology.total_interactions, priorSessionExperiences)');
    const synthesizeIdx  = route.indexOf('await synthesizeWisdom(userId, characterId, psychology.total_interactions)');
    expect(reinforceIdx).toBeGreaterThan(-1);
    expect(synthesizeIdx).toBeGreaterThan(-1);
    expect(reinforceIdx).toBeLessThan(synthesizeIdx);
  });

  it('the wiring runs fire-and-forget via after(), matching this file\'s existing background-task convention', () => {
    expect(route).toMatch(/after\(\(\) => \(async \(\) => \{\s*const priorSessionExperiences = getRecentExperiences/);
    expect(route).toMatch(/\.catch\(bg\('reinforceLessons\+synthesizeWisdom'\)\)/);
  });

  it('the session-boundary block is placed before this turn\'s own recordExperience() calls, so it processes the prior session\'s log rather than data this turn just wrote', () => {
    const sessionBoundaryIdx = route.indexOf('reinforceLessons() and synthesizeWisdom() had zero call sites');
    const firstRecordExperienceIdx = route.indexOf('recordExperience(userId, characterId, psychology.total_interactions, {');
    expect(sessionBoundaryIdx).toBeGreaterThan(-1);
    expect(firstRecordExperienceIdx).toBeGreaterThan(-1);
    expect(sessionBoundaryIdx).toBeLessThan(firstRecordExperienceIdx);
  });
});

describe('ARCH-11 — reflectOnSession() remains a documented, NOT-yet-wired gap (scope boundary of this fix)', () => {
  const route = src('app', 'api', 'chat', 'stream', 'route.ts');
  const reflectionEngine = src('lib', 'cognition', 'reflection-engine.ts');

  it('reflection-engine.ts still documents reflectOnSession as intended for a gap-detected session boundary', () => {
    expect(reflectionEngine).toMatch(/or when a long gap is detected before the next\s*\* session starts/);
  });

  it('chat/stream/route.ts explicitly notes reflectOnSession was NOT wired in this pass, rather than silently omitting it', () => {
    expect(route).toMatch(/NOT wired here: reflectOnSession\(\)/);
  });
});
