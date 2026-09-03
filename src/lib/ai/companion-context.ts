/**
 * CompanionContext — the canonical, single-object representation of
 * everything needed to generate a companion response.
 *
 * WHY THIS EXISTS: src/app/api/chat/stream/route.ts assembles ~30 engine
 * outputs (psychology, relationship, memory graph, memory facts, emotion,
 * agency, rupture/repair, beliefs, reputation, theory of mind, goals,
 * threads, journal, milestones, universe context, ...) as flat local
 * variables, fetched unconditionally on every message via one giant
 * Promise.all, then hand-fed into assembleFullPrompt() as ~30 separate
 * arguments. That means:
 *   - there is no single object anyone can log, test, or reason about as
 *     "the companion's current state for this turn"
 *   - there is no declared precedence when two engines' outputs could
 *     conflict (e.g. rupture state vs. relationship stage vs. mood)
 *   - there is no cognitive-budget gate — a "lol" message pays for the
 *     same 26-wide parallel load as a deep emotional message
 *
 * This module does NOT change route.ts's behavior. It defines the target
 * shape and an assembly function that performs the *same* underlying
 * engine calls route.ts already makes (types derived from the real
 * engines via ReturnType/Awaited, not hand-redeclared, so this can't
 * silently drift from what the engines actually return) — so route.ts can
 * be migrated to call into this incrementally and be verified at each
 * step, rather than rewritten in one pass.
 *
 * PRECEDENCE (declared here since nothing enforced it before): when
 * assembling a prompt, information should be treated as authoritative in
 * this order, highest first. Callers building a prompt from a
 * CompanionContext should resolve conflicts in this order, not in
 * whatever order fields happen to appear below.
 *
 *   1. canonical character definition       (character)
 *   2. active safety/moderation constraints (safety)      — can override anything below
 *   3. persistent relationship state        (relationship)
 *   4. validated long-term memory           (memory)
 *   5. current psychological/emotional state (state)
 *   6. live cognition scratchpad            (cognition)    — see note below
 *   7. recent conversation context          (conversation)
 *   8. world/universe context               (world)
 *   9. temporary/inferred signals           (inferred)      — lowest priority, easiest to override
 *
 * COMPANION-STATE CONSOLIDATION: this file's own header has said since it
 * was written that it is "the canonical, single-object representation" —
 * but until now it only actually covered relationship/memory/state/
 * conversation/world. Meanwhile unified-mind.ts (lib/mind/) computes a
 * genuinely separate "fortune arc" self-model and says explicitly in its
 * own header that it is "a composition layer... not authoritative state,"
 * and four more stores — companion-awareness.ts, working-memory.ts,
 * belief-store.ts (via belief-engine.ts's getActiveBeliefs, already
 * fetched above as `beliefs`), habit-store.ts, wisdom-store.ts — were each
 * independently readable with no single object holding all of them
 * together for one turn. That meant seven+ files could each be
 * independently queried at a call site, each with its own fetch, its own
 * failure mode, and no shared snapshot to log/test/diff as "the
 * companion's state right now."
 *
 * The new `cognition` section below closes that gap by pulling all of
 * them into this already-declared-canonical object: working memory,
 * beliefs, habits, wisdom, companion-to-companion social awareness, and
 * the unified-mind fortune arc. None of those five modules' own storage or
 * write paths change — this is purely an additional read composed here,
 * exactly like `memory` and `state` already compose their own sources.
 * unified-mind.ts's own docstring already scoped it correctly ("this does
 * not replace the individual engines... this is a composition layer on
 * top") — it's simply now composed one level higher, into the one object
 * this file always intended to be authoritative.
 */

import { getPsychology } from '@/lib/ai/attachment-engine';
import { ensureRelationship } from '@/lib/ai/relationship-engine';
import { getMemoryGraph, getDiscoveredLore } from '@/lib/ai/memory-graph';
import { getMemory } from '@/lib/ai/memory';
import { getDynamicInterests, detectTopicsFromMessage } from '@/lib/ai/personality-evolution';
import { getFactGraph } from '@/lib/ai/user-fact-graph';
import { getSessionBridge } from '@/lib/ai/session-bridge';
import { getEmotionState } from '@/lib/ai/emotion-state';
import { getRevolutionProfile } from '@/lib/ai/character-revolution';
import { assembleUniverseContext } from '@/lib/universe/universe-prompt';
import { getPriorityMemories } from '@/lib/ai/priority-memory';
import { getActiveGoals, getRecentIntents } from '@/lib/ai/goal-engine';
import { getOpenThreads, getLongTermPlan } from '@/lib/ai/agency-engine';
import { getRecentJournalEntries } from '@/lib/ai/daily-journal';
import { getUnsurfacedThoughts } from '@/lib/ai/independent-thoughts';
import { recomputeMilestones, getMilestones } from '@/lib/ai/relationship-milestones';
import { retrieveRelevantKnowledge } from '@/lib/ai/knowledge-library';
import { getCoreDesire, getFulfillment } from '@/lib/ai/desire-engine';
import { getCharacterSeedMemories } from '@/lib/ai/character-seed-memory';
import { getEvolutionTraits } from '@/lib/ai/bidirectional-evolution';
import { getActiveBeliefs } from '@/lib/cognition/belief-engine';
import { getWorkingMemory } from '@/lib/cognition/working-memory';
import { getCompanionRelationships } from '@/lib/ai/companion-awareness';
import { getUnifiedMind } from '@/lib/mind/unified-mind';
import { arbitrateMemoryContext } from '@/lib/ai/memory-arbiter';
import { logger } from '@/lib/logger';

/**
 * How much intelligence this turn needs. Not yet wired into route.ts —
 * defined here so classification and gating can be developed and tested
 * against real message samples before anything depends on it. See §20 of
 * the product brief this addresses ("cognitive budget").
 */
export type TurnComplexity = 'low' | 'normal' | 'high';

/**
 * Cheap, synchronous, zero-latency heuristic — deliberately simple so it
 * can run before any I/O. False negatives (treating something complex as
 * low) are the safe failure direction here: `assembleCompanionContext`
 * below does not yet use this to skip any engine calls, so misclassifying
 * something as `low` costs nothing today. It exists to be validated
 * against real traffic before it gates anything.
 */
export function classifyTurnComplexity(message: string): TurnComplexity {
  const trimmed = message.trim();
  // High-signal check runs FIRST and unconditionally — a short message
  // ("scared", "lonely") must never be short-circuited to `low` by the
  // length check below just because it's brief. Real crisis-adjacent
  // detection lives in lib/safety/crisis-detection.ts and gates the
  // request entirely before this ever runs; this is a much cheaper,
  // separate signal only used (once wired) to decide how much companion
  // context to load — erring toward `high` here is always the safe
  // direction, since it only means "load more," never "load less safety."
  const highSignal = /\b(remember|scared|afraid|hurt|love you|hate|dying|die|hurt myself|lonely|alone|miss you|trauma|abuse)\b/i;
  if (highSignal.test(trimmed) || trimmed.length > 280) return 'high';
  if (trimmed.length <= 12 && !/[?]/.test(trimmed)) return 'low';
  return 'normal';
}

export interface CompanionContext {
  meta: {
    userId: string;
    characterId: string;
    conversationId: string | null;
    message: string;
    complexity: TurnComplexity;
  };

  /** Precedence 1 — canonical character definition. Populated by the caller
   *  (route.ts already fetches the character row separately, since it also
   *  needs it for gating decisions before this context is assembled). */
  character: unknown;

  /** Precedence 3 — persistent relationship state. */
  relationship: {
    psychology: Awaited<ReturnType<typeof getPsychology>>;
    relationship: Awaited<ReturnType<typeof ensureRelationship>>;
    revolutionProfile: Awaited<ReturnType<typeof getRevolutionProfile>>;
    evolutionTraits: Awaited<ReturnType<typeof getEvolutionTraits>>;
  };

  /** Precedence 4 — validated long-term memory. */
  memory: {
    graph: Awaited<ReturnType<typeof getMemoryGraph>>;
    facts: Awaited<ReturnType<typeof getMemory>>;
    priority: Awaited<ReturnType<typeof getPriorityMemories>>;
    seed: Awaited<ReturnType<typeof getCharacterSeedMemories>>;
    factGraph: Awaited<ReturnType<typeof getFactGraph>>;
    dynamicInterests: Awaited<ReturnType<typeof getDynamicInterests>>;
    discoveredLore: Awaited<ReturnType<typeof getDiscoveredLore>>;
    relevantKnowledge: Awaited<ReturnType<typeof retrieveRelevantKnowledge>>;
  };

  /** Precedence 5 — current psychological/emotional state. */
  state: {
    emotion: Awaited<ReturnType<typeof getEmotionState>>;
    coreDesire: Awaited<ReturnType<typeof getCoreDesire>>;
    fulfillment: Awaited<ReturnType<typeof getFulfillment>> | null;
    milestones: Awaited<ReturnType<typeof getMilestones>>;
  };

  /**
   * Precedence 6 — live cognition scratchpad. This is the consolidation
   * point for the previously-scattered companion-state modules (see
   * "COMPANION-STATE CONSOLIDATION" above). `fortune` is unified-mind.ts's
   * composed self-model (kept as its own sub-object rather than flattened,
   * since it's itself a composition of several world-state engines and
   * callers may reasonably want it as one unit); everything else is a
   * direct read of its respective store/engine, unmodified.
   */
  cognition: {
    workingMemory: ReturnType<typeof getWorkingMemory>;
    beliefs: Awaited<ReturnType<typeof getActiveBeliefs>>;
    companionRelationships: Awaited<ReturnType<typeof getCompanionRelationships>>;
    /** Null only if unified-mind's own composition failed outright — see catch below. */
    fortune: Awaited<ReturnType<typeof getUnifiedMind>> | null;
    /**
     * Arbitrated view of memory.facts + memory.factGraph (both still
     * present above, unmodified, for callers mid-migration) — see
     * memory-arbiter.ts. Use THIS, not memory.facts/memory.factGraph
     * directly, when injecting "what you know about this user" into a
     * prompt: it resolves same-topic contradictions between the two
     * sources by a declared precedence instead of injecting both.
     */
    canonicalMemory: ReturnType<typeof arbitrateMemoryContext>;
  };

  /** Precedence 7 — recent conversation context. */
  conversation: {
    sessionBridge: Awaited<ReturnType<typeof getSessionBridge>>;
    recentIntents: Awaited<ReturnType<typeof getRecentIntents>>;
    openThreads: Awaited<ReturnType<typeof getOpenThreads>>;
    longTermPlan: Awaited<ReturnType<typeof getLongTermPlan>>;
    journalEntries: Awaited<ReturnType<typeof getRecentJournalEntries>>;
    unsurfacedThoughts: Awaited<ReturnType<typeof getUnsurfacedThoughts>>;
    activeGoals: Awaited<ReturnType<typeof getActiveGoals>>;
  };

  /** Precedence 8 — world/universe context. */
  world: {
    universeContext: Awaited<ReturnType<typeof assembleUniverseContext>>;
  };

  /** Precedence 2 — safety/moderation constraints. Deliberately left for
   *  the caller to populate: crisis detection, tier/NSFW gating, and
   *  moderation all run as hard *gates* before generation even starts
   *  (route.ts is correct to keep those as early returns, not context
   *  fields) — this slot exists so anything that must survive into the
   *  prompt itself (e.g. "avoid topic X this turn") has a declared home
   *  instead of being smuggled into an unrelated field. */
  safety: Record<string, unknown>;
}

export interface AssembleCompanionContextInput {
  userId: string;
  characterId: string;
  conversationId: string | null;
  message: string;
  character: unknown;
}

/**
 * Assembles a CompanionContext by running the same engine calls route.ts's
 * "mega-parallel context load" already performs. Currently always fetches
 * everything (matching route.ts's existing behavior exactly, so swapping
 * this in is behavior-preserving) — the complexity classification above is
 * computed and attached but does not yet skip anything. That's a
 * deliberate, separately-reviewable next step once this shape has been
 * proven against real route.ts output, not bundled into this change.
 */
export async function assembleCompanionContext(
  input: AssembleCompanionContextInput,
): Promise<CompanionContext> {
  const { userId, characterId, conversationId, message, character } = input;
  const complexity = classifyTurnComplexity(message);

  const [
    psychology, relationship, memoryGraph, memoryFacts,
    dynamicInterests, factGraph, sessionBridge, discoveredLore,
    emotion, revolutionProfile, universeContext, priorityMemories,
    activeGoals, recentIntents, openThreads, longTermPlan,
    journalEntries, unsurfacedThoughts, milestones, relevantKnowledge,
    coreDesire, seedMemories, evolutionTraits,
    beliefs, companionRelationships, fortune,
  ] = await Promise.all([
    getPsychology(userId, characterId),
    ensureRelationship(userId, characterId),
    // FEATURE-7 (Invisible Memory): fetch a wider candidate pool from the DB
    // (emotion/recency ranked) so semanticRerankMemories() downstream has
    // real material to promote a genuinely relevant-but-lower-emotion memory
    // into the top slice that formatMemoryGraphForPrompt() actually shows.
    // At 12, the DB step alone decided the visible set and semantic
    // relevance could only reorder within it — "1. relevant memories" from
    // the spec never got a real chance to win over "3. emotionally
    // meaningful". 30 is still a single cheap indexed (user_id,
    // character_id) query; formatMemoryGraphForPrompt still caps what's
    // shown to the model at 8.
    getMemoryGraph(userId, characterId, 30),
    getMemory(userId, characterId),
    getDynamicInterests(userId, characterId),
    getFactGraph(userId, characterId),
    getSessionBridge(userId, characterId),
    getDiscoveredLore(userId, characterId),
    getEmotionState(userId, characterId),
    getRevolutionProfile(userId, characterId, 0),
    assembleUniverseContext(characterId, { userId }),
    getPriorityMemories(userId, characterId, { limit: 12 }),
    getActiveGoals(characterId, userId),
    getRecentIntents(userId, characterId, 5),
    getOpenThreads(userId, characterId),
    getLongTermPlan(userId, characterId),
    getRecentJournalEntries(userId, characterId, 3),
    getUnsurfacedThoughts(userId, characterId, 3),
    getMilestones(userId, characterId),
    retrieveRelevantKnowledge(characterId, { userMessage: message, recentTopics: detectTopicsFromMessage(message) }),
    getCoreDesire(characterId),
    getCharacterSeedMemories(characterId, 8),
    getEvolutionTraits(userId, characterId),
    // COMPANION-STATE CONSOLIDATION — see file header. Each of these is
    // independently try/caught, same tolerance model already used for
    // fulfillment below and throughout unified-mind.ts's own
    // getUnifiedMind(): one store being unavailable degrades that slice,
    // never the whole context assembly.
    //
    // COMPUTE-BUDGET FIX: getAllHabits/getAllWisdom were fetched here and
    // never consumed by any caller (verified repo-wide — route.ts never
    // reads cognition.habits/cognition.wisdom, and assembleCompanionContext
    // has exactly one real caller). Removed rather than left as dead I/O
    // that ran on every single turn for nothing. habit-engine.ts and
    // wisdom-engine.ts still call getAllHabits/getAllWisdom directly for
    // their own logic — this only removes this file's own unused copy.
    getActiveBeliefs(userId, characterId).catch(() => []),
    getCompanionRelationships(characterId).catch(() => []),
    getUnifiedMind(userId, characterId).catch((err) => {
      logger.warn('companion-context: getUnifiedMind failed', { userId, characterId, error: String(err) });
      return null;
    }),
  ]);

  // Arbitrated view of memory.ts + user-fact-graph.ts + seed memories —
  // computed synchronously here (not fetched again) since memoryFacts,
  // factGraph, and seedMemories above are already the same three sources
  // getCanonicalMemoryContext() would otherwise re-fetch from Redis/
  // Supabase a second time on every single turn. Never throws — pure
  // in-memory arbitration over data that already fetched fail-open.
  const canonicalMemory = arbitrateMemoryContext(memoryFacts, factGraph, seedMemories, { userId, characterId });

  // fulfillment and recomputeMilestones both have independent failure
  // handling already established at the route.ts call sites — preserved
  // here rather than left to a bare await, so this function's failure
  // behavior matches route.ts's exactly.
  const fulfillment = await getFulfillment(characterId, userId).catch(() => null);
  void recomputeMilestones; // re-exported for callers that need the mutation, not read here

  logger.debug('companion-context: assembled', { userId, characterId, complexity });

  return {
    meta: { userId, characterId, conversationId, message, complexity },
    character,
    relationship: { psychology, relationship, revolutionProfile, evolutionTraits },
    memory: {
      graph: memoryGraph, facts: memoryFacts, priority: priorityMemories,
      seed: seedMemories, factGraph, dynamicInterests, discoveredLore, relevantKnowledge,
    },
    state: { emotion, coreDesire, fulfillment, milestones },
    cognition: {
      workingMemory: getWorkingMemory(userId, characterId),
      beliefs, companionRelationships, fortune, canonicalMemory,
    },
    conversation: {
      sessionBridge, recentIntents, openThreads, longTermPlan,
      journalEntries, unsurfacedThoughts, activeGoals,
    },
    world: { universeContext },
    safety: {},
  };
}
