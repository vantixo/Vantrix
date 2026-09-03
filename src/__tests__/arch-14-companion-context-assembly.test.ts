/**
 * ARCH-14 — CompanionContext assembles the same shape route.ts's
 * mega-parallel load produces, and turn-complexity classification behaves
 * as documented.
 *
 * Context: src/app/api/chat/stream/route.ts fetches ~26 engine outputs as
 * flat local variables with no single object representing "the
 * companion's current state." companion-context.ts introduces that single
 * object with a declared precedence order, without changing route.ts's
 * behavior yet (see file header for the migration plan). This test
 * guards two things:
 *   1. assembleCompanionContext() calls every engine it claims to and
 *      places each result under the correct precedence group — a
 *      mis-grouped field here would silently make wrong data
 *      "authoritative" whenever this replaces route.ts's assembly.
 *   2. classifyTurnComplexity() — not yet wired to skip anything, but its
 *      classification boundaries need to be locked before anything
 *      depends on them, so a later change can't silently reclassify a
 *      high-signal message (e.g. self-harm language) as low-complexity.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/ai/attachment-engine',     () => ({ getPsychology: vi.fn().mockResolvedValue({ psych: true }) }));
vi.mock('@/lib/ai/relationship-engine',   () => ({ ensureRelationship: vi.fn().mockResolvedValue({ rel: true }) }));
vi.mock('@/lib/ai/memory-graph',          () => ({
  getMemoryGraph: vi.fn().mockResolvedValue({ graph: true }),
  getDiscoveredLore: vi.fn().mockResolvedValue({ lore: true }),
}));
vi.mock('@/lib/ai/memory',                () => ({ getMemory: vi.fn().mockResolvedValue({ facts: true }) }));
vi.mock('@/lib/ai/personality-evolution', () => ({
  getDynamicInterests: vi.fn().mockResolvedValue({ interests: true }),
  detectTopicsFromMessage: vi.fn().mockReturnValue(['topic']),
}));
vi.mock('@/lib/ai/user-fact-graph',       () => ({ getFactGraph: vi.fn().mockResolvedValue({ facts: true }) }));
vi.mock('@/lib/ai/session-bridge',        () => ({ getSessionBridge: vi.fn().mockResolvedValue({ bridge: true }) }));
vi.mock('@/lib/ai/emotion-state',         () => ({ getEmotionState: vi.fn().mockResolvedValue({ emotion: true }) }));
vi.mock('@/lib/ai/character-revolution',  () => ({ getRevolutionProfile: vi.fn().mockResolvedValue({ rev: true }) }));
vi.mock('@/lib/universe/universe-prompt', () => ({ assembleUniverseContext: vi.fn().mockResolvedValue('universe') }));
vi.mock('@/lib/ai/priority-memory',       () => ({ getPriorityMemories: vi.fn().mockResolvedValue({ priority: true }) }));
vi.mock('@/lib/ai/goal-engine',           () => ({
  getActiveGoals: vi.fn().mockResolvedValue({ goals: true }),
  getRecentIntents: vi.fn().mockResolvedValue({ intents: true }),
}));
vi.mock('@/lib/ai/agency-engine',         () => ({
  getOpenThreads: vi.fn().mockResolvedValue({ threads: true }),
  getLongTermPlan: vi.fn().mockResolvedValue({ plan: true }),
}));
vi.mock('@/lib/ai/daily-journal',         () => ({ getRecentJournalEntries: vi.fn().mockResolvedValue({ journal: true }) }));
vi.mock('@/lib/ai/independent-thoughts',  () => ({ getUnsurfacedThoughts: vi.fn().mockResolvedValue({ thoughts: true }) }));
vi.mock('@/lib/ai/relationship-milestones', () => ({
  getMilestones: vi.fn().mockResolvedValue({ milestones: true }),
  recomputeMilestones: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/ai/knowledge-library',     () => ({ retrieveRelevantKnowledge: vi.fn().mockResolvedValue({ knowledge: true }) }));
vi.mock('@/lib/ai/desire-engine',         () => ({
  getCoreDesire: vi.fn().mockResolvedValue({ desire: true }),
  getFulfillment: vi.fn().mockResolvedValue({ fulfillment: true }),
}));
vi.mock('@/lib/ai/character-seed-memory', () => ({ getCharacterSeedMemories: vi.fn().mockResolvedValue({ seed: true }) }));
vi.mock('@/lib/ai/bidirectional-evolution', () => ({ getEvolutionTraits: vi.fn().mockResolvedValue({ traits: true }) }));
// COMPANION-STATE CONSOLIDATION (see companion-context.ts's own header):
// these five became real dependencies of assembleCompanionContext when the
// previously-scattered cognition modules were pulled into the `cognition`
// section below. Left unmocked, each hits a real Supabase/store call with
// no test credentials configured — not a rejection, a hang, which is why
// this file's two async tests were timing out at 5000ms rather than
// failing fast with a clear error.
vi.mock('@/lib/cognition/belief-engine',   () => ({ getActiveBeliefs: vi.fn().mockResolvedValue([{ belief: true }]) }));
vi.mock('@/lib/cognition/working-memory',  () => ({ getWorkingMemory: vi.fn().mockReturnValue({ workingMemory: true }) })); // sync, not async — see its own signature
vi.mock('@/lib/ai/companion-awareness',    () => ({ getCompanionRelationships: vi.fn().mockResolvedValue([{ companionRelationship: true }]) }));
vi.mock('@/lib/mind/unified-mind',         () => ({ getUnifiedMind: vi.fn().mockResolvedValue({ fortune: true }) }));
vi.mock('@/lib/ai/memory-arbiter',         () => ({ arbitrateMemoryContext: vi.fn().mockReturnValue({ canonicalMemory: true }) })); // sync, not async — see its own signature
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { assembleCompanionContext, classifyTurnComplexity } from '../lib/ai/companion-context';

describe('ARCH-14 — CompanionContext assembly', () => {
  it('places every engine output under its declared precedence group', async () => {
    const ctx = await assembleCompanionContext({
      userId: 'u1',
      characterId: 'c1',
      conversationId: 'conv1',
      message: 'hey, how has your day been going?',
      character: { name: 'Test Character' },
    });

    expect(ctx.meta).toMatchObject({ userId: 'u1', characterId: 'c1', conversationId: 'conv1', message: 'hey, how has your day been going?' });
    expect(ctx.character).toEqual({ name: 'Test Character' });

    // Precedence 3 — relationship
    expect(ctx.relationship.psychology).toEqual({ psych: true });
    expect(ctx.relationship.relationship).toEqual({ rel: true });
    expect(ctx.relationship.revolutionProfile).toEqual({ rev: true });
    expect(ctx.relationship.evolutionTraits).toEqual({ traits: true });

    // Precedence 4 — memory
    expect(ctx.memory.graph).toEqual({ graph: true });
    expect(ctx.memory.facts).toEqual({ facts: true }); // from getMemory, not getFactGraph
    expect(ctx.memory.discoveredLore).toEqual({ lore: true });
    expect(ctx.memory.priority).toEqual({ priority: true });
    expect(ctx.memory.seed).toEqual({ seed: true });

    // Precedence 5 — state
    expect(ctx.state.emotion).toEqual({ emotion: true });
    expect(ctx.state.coreDesire).toEqual({ desire: true });
    expect(ctx.state.fulfillment).toEqual({ fulfillment: true });
    expect(ctx.state.milestones).toEqual({ milestones: true });

    // Precedence 6 — cognition (COMPANION-STATE CONSOLIDATION)
    expect(ctx.cognition.workingMemory).toEqual({ workingMemory: true });
    expect(ctx.cognition.beliefs).toEqual([{ belief: true }]);
    expect(ctx.cognition.companionRelationships).toEqual([{ companionRelationship: true }]);
    expect(ctx.cognition.fortune).toEqual({ fortune: true });
    expect(ctx.cognition.canonicalMemory).toEqual({ canonicalMemory: true });

    // Precedence 7 — conversation
    expect(ctx.conversation.sessionBridge).toEqual({ bridge: true });
    expect(ctx.conversation.openThreads).toEqual({ threads: true });
    expect(ctx.conversation.longTermPlan).toEqual({ plan: true });
    expect(ctx.conversation.activeGoals).toEqual({ goals: true });

    // Precedence 8 — world
    expect(ctx.world.universeContext).toBe('universe');

    // Safety slot exists and is empty until a caller populates it
    expect(ctx.safety).toEqual({});

    expect(ctx.meta.complexity).toBe('normal');
  });

  it('falls back to null (not throwing) when getFulfillment rejects', async () => {
    const { getFulfillment } = await import('@/lib/ai/desire-engine');
    (getFulfillment as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));

    const ctx = await assembleCompanionContext({
      userId: 'u1', characterId: 'c1', conversationId: null, message: 'hi', character: {},
    });
    expect(ctx.state.fulfillment).toBeNull();
  });
});

describe('ARCH-14 — classifyTurnComplexity', () => {
  it('classifies short, non-question messages as low', () => {
    expect(classifyTurnComplexity('lol')).toBe('low');
    expect(classifyTurnComplexity('ok')).toBe('low');
    expect(classifyTurnComplexity('good morning')).toBe('low');
  });

  it('classifies self-harm/crisis-adjacent language as high regardless of length', () => {
    expect(classifyTurnComplexity('scared')).toBe('high');
    expect(classifyTurnComplexity("I'm so lonely")).toBe('high');
    expect(classifyTurnComplexity('i miss you so much')).toBe('high');
  });

  it('classifies very long messages as high', () => {
    expect(classifyTurnComplexity('a'.repeat(300))).toBe('high');
  });

  it('classifies an ordinary question as normal', () => {
    expect(classifyTurnComplexity('What do you think about this?')).toBe('normal');
  });

  it('a short message with a question mark is not auto-low', () => {
    expect(classifyTurnComplexity('ok?')).toBe('normal');
  });
});
