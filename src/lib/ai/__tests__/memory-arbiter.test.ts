// src/lib/ai/__tests__/memory-arbiter.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// memory-arbiter.ts owns conflict resolution between memory.ts (legacy flat
// facts) and user-fact-graph.ts (structured facts) — previously both were
// injected into the same prompt independently with no reconciliation. These
// tests exercise arbitrateMemoryContext() directly (no I/O) against the
// exact scenario described in the module header: overlapping-but-
// contradictory occupation facts from the two sources.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest';
import { arbitrateMemoryContext } from '../memory-arbiter';
import type { MemoryFact } from '../memory';
import type { UserFact } from '../user-fact-graph';
import type { CharacterSeedMemory } from '../character-seed-memory';

function legacyFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return { text: "User occupation: teacher", source: 'heuristic', confidence: 0.6, createdAt: Date.now() - 10_000, ...overrides };
}

function userFact(overrides: Partial<UserFact> = {}): UserFact {
  return {
    id: 'f1', category: 'work', key: 'occupation', value: 'nurse',
    confidence: 0.8, source: 'ai', learnedAt: new Date().toISOString(), lastUsed: new Date().toISOString(),
    ...overrides,
  };
}

describe('memory-arbiter — conflict resolution', () => {
  it('prefers user-fact-graph over legacy memory.ts on the same topic, regardless of confidence', () => {
    const result = arbitrateMemoryContext(
      [legacyFact({ text: 'User occupation: teacher', confidence: 0.95 })],
      [userFact({ value: 'nurse', confidence: 0.5 })],
      [],
    );
    expect(result.factsPromptBlock).toContain('nurse');
    expect(result.factsPromptBlock).not.toContain('teacher');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].reason).toBe('higher-precedence-source');
  });

  it('never emits both contradictory facts into the same prompt block', () => {
    const result = arbitrateMemoryContext(
      [legacyFact({ text: 'User occupation: teacher' })],
      [userFact({ value: 'nurse' })],
      [],
    );
    // The bug this fixes: model previously saw "teacher" AND "nurse" with
    // no signal which was current. Only one may reach the prompt.
    const mentionsTeacher = result.factsPromptBlock.includes('teacher');
    const mentionsNurse = result.factsPromptBlock.includes('nurse');
    expect(mentionsTeacher && mentionsNurse).toBe(false);
  });

  it('does not flag non-overlapping facts as conflicts', () => {
    const result = arbitrateMemoryContext(
      [legacyFact({ text: "User's name: Jake" })],
      [userFact({ category: 'location', key: 'location', value: 'Seattle' })],
      [],
    );
    expect(result.conflicts).toHaveLength(0);
    expect(result.factsPromptBlock).toContain('Jake');
    expect(result.factsPromptBlock).toContain('Seattle');
  });

  it('breaks ties within the same precedence tier by confidence, then recency', () => {
    const result = arbitrateMemoryContext(
      [],
      [
        userFact({ id: 'a', value: 'nurse', confidence: 0.4, learnedAt: new Date(Date.now() - 1000).toISOString() }),
        userFact({ id: 'b', value: 'doctor', confidence: 0.9, learnedAt: new Date().toISOString() }),
      ],
      [],
    );
    expect(result.factsPromptBlock).toContain('doctor');
    expect(result.conflicts[0].reason).toBe('higher-confidence');
  });

  it('keeps factsPromptBlock free of seed memories, but promptBlock includes both', () => {
    const seed: CharacterSeedMemory = {
      id: 's1', category: 'backstory', headline: 'Grew up in Portland',
      content: 'Details...', importance: 80, is_testable: false, test_hint: null,
    };
    const result = arbitrateMemoryContext([legacyFact()], [], [seed]);
    expect(result.factsPromptBlock).not.toContain('Portland');
    expect(result.promptBlock).toContain('Portland');
    expect(result.promptBlock).toContain('teacher');
  });

  it('returns empty blocks and zero conflicts when all sources are empty', () => {
    const result = arbitrateMemoryContext([], [], []);
    expect(result.promptBlock).toBe('');
    expect(result.factsPromptBlock).toBe('');
    expect(result.conflicts).toHaveLength(0);
    expect(result.factCount).toBe(0);
  });
});
