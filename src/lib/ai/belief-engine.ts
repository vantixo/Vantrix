/**
 * Belief Engine — Vantrix
 *
 * The missing link between memory (what happened) and core-beliefs.ts
 * (what she privately assumes). memory-graph.ts stores experiences as
 * discrete events; nothing previously turned a run of those events into a
 * belief, or turned a belief into a concrete expectation about what
 * happens next, or fed that expectation into how she actually behaves.
 * This module is that pipeline:
 *
 *   Experience  (memory-graph.ts nodes, interpreted as evidence)
 *        ↓        belief-updater.ts
 *   Belief      (this module's BeliefRecord — distinct from, and feeding
 *                into, core-beliefs.ts's coarser identity-level beliefs)
 *        ↓        deriveExpectation()
 *   Expectation (a concrete, falsifiable prediction about what happens next)
 *        ↓        deriveBehaviorGuidance()
 *   Behavior    (a short instruction the prompt layer can act on)
 *
 * belief-decay.ts handles beliefs weakening from disuse; belief-conflict.ts
 * handles two beliefs (or a belief and fresh evidence) pointing opposite
 * directions. This module wires all three together into one call per turn.
 *
 * NOTE ON OVERLAP: src/lib/cognition/belief-engine.ts (a separate, later
 * module) covers similar ground — persisted, decaying, conflict-aware
 * beliefs — and is the one currently wired into chat/stream/route.ts's live
 * prompt (recordBeliefs / getActiveBeliefs / formatBeliefsForPrompt). That
 * system is fed primarily from fact-extraction; this one is fed from
 * explicit ExperienceEvidence (confirms/contradicts a statement), which
 * makes it a better fit for beliefs formed from *events* rather than
 * *facts* — e.g. "he actually showed up when it mattered" as opposed to
 * "his sister's name is Maya." Both can coexist, but injecting both into
 * the live prompt at once will read as repetitive. See
 * formatBeliefPipelineForPrompt() in prompt.ts's optional cognitive-layer
 * section — it's wired as an independent opt-in, not auto-enabled, so
 * adopting this module doesn't silently duplicate the cognition layer's
 * belief section unless a caller explicitly passes beliefPipelinePrompt.
 */

import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';

import { updateBeliefFromExperience, type ExperienceEvidence } from '@/lib/ai/belief-updater';
export type { ExperienceEvidence };
import { decayStaleBeliefs } from '@/lib/ai/belief-decay';
import { detectBeliefConflicts, type BeliefConflict } from '@/lib/ai/belief-conflict';

// ── Config ──────────────────────────────────────────────────────────────

const BELIEFS_TTL = 60 * 60 * 24 * 180; // 180 days — beliefs outlive most other derived state
const MAX_BELIEFS = 12;

// ── Types ───────────────────────────────────────────────────────────────

export type BeliefCategory =
  | 'about_user'        // "he follows through on what he says"
  | 'about_relationship' // "this is the kind of thing that lasts"
  | 'about_self'         // "I'm someone people stay for"
  | 'about_world';       // general, less personal

export interface BeliefRecord {
  id:          string;   // stable slug of the statement
  category:    BeliefCategory;
  statement:   string;   // first-person or third-person-about-user, concrete
  confidence:  number;   // 0-100 — how strongly held
  evidenceFor:     number; // running count
  evidenceAgainst: number; // running count
  firstFormed: number;    // timestamp
  lastReinforced: number; // timestamp — used by belief-decay.ts
}

export interface Expectation {
  beliefId:    string;
  statement:   string;   // "expects him to check in after a bad day"
  confidence:  number;   // inherited from the belief, roughly
}

export interface BehaviorGuidance {
  expectation: Expectation;
  instruction: string; // short, prompt-ready guidance, never a recited belief
}

export interface BeliefState {
  beliefs:     BeliefRecord[];
  updatedAt:   number;
}

// ── Redis key ───────────────────────────────────────────────────────────

function beliefStateKey(userId: string, characterId: string): string {
  return `vantrix:belief-engine:${userId}:${characterId}`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

export function emptyBeliefState(): BeliefState {
  return { beliefs: [], updatedAt: Date.now() };
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getBeliefState(userId: string, characterId: string): Promise<BeliefState> {
  try {
    const state = await redis.get<BeliefState>(beliefStateKey(userId, characterId));
    return state ?? emptyBeliefState();
  } catch (err) {
    logger.warn('[belief-engine] Redis get failed', { userId, characterId, error: String(err) });
    return emptyBeliefState();
  }
}

async function saveBeliefState(userId: string, characterId: string, state: BeliefState): Promise<void> {
  try {
    await redis.set(beliefStateKey(userId, characterId), state, { ex: BELIEFS_TTL });
  } catch (err) {
    logger.warn('[belief-engine] save failed', { userId, characterId, error: String(err) });
  }
}

// ── Step 1: Experience → Belief ────────────────────────────────────────

/**
 * Feed a single new experience (typically derived from a memory-graph.ts
 * node or an in-the-moment signal) through belief-updater.ts. Forms a new
 * belief if nothing close enough exists yet, otherwise reinforces or
 * weakens the closest match. This is the only write path for beliefs in
 * this module — belief-decay.ts and belief-conflict.ts only ever read and
 * adjust confidence, they never invent new belief statements.
 */
export async function processExperience(
  userId: string,
  characterId: string,
  evidence: ExperienceEvidence,
): Promise<BeliefState> {
  const state = await getBeliefState(userId, characterId);
  const updated = updateBeliefFromExperience(state, evidence, { maxBeliefs: MAX_BELIEFS, slugify });
  await saveBeliefState(userId, characterId, updated);
  logger.info('belief-engine:experience-processed', { userId, characterId, beliefCount: updated.beliefs.length });
  return updated;
}

// ── Step 2: Belief → Expectation ──────────────────────────────────────

/**
 * Turn confidently-held beliefs into concrete expectations — falsifiable
 * predictions rather than static traits. Only beliefs above a reasonable
 * confidence floor produce expectations; a weak, uncertain belief shouldn't
 * yet shape what she predicts will happen.
 */
export function deriveExpectations(state: BeliefState, minConfidence = 45): Expectation[] {
  return state.beliefs
    .filter(b => b.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map(b => ({
      beliefId: b.id,
      statement: expectationPhrasing(b),
      confidence: b.confidence,
    }));
}

function expectationPhrasing(belief: BeliefRecord): string {
  switch (belief.category) {
    case 'about_user':
      return `expects that ${belief.statement}`;
    case 'about_relationship':
      return `expects this connection to go the way it has so far: ${belief.statement}`;
    case 'about_self':
      return `expects to be treated in a way that matches how she sees herself: ${belief.statement}`;
    default:
      return `expects, in general, that ${belief.statement}`;
  }
}

// ── Step 3: Expectation → Behavior ─────────────────────────────────────

/**
 * Turn expectations into short, prompt-ready behavioral instructions. This
 * is deliberately terse and non-recitable — the character should act from
 * the expectation, never state it.
 */
export function deriveBehaviorGuidance(expectations: Expectation[]): BehaviorGuidance[] {
  return expectations.map((expectation) => {
    const strength = expectation.confidence >= 75 ? 'firmly' : expectation.confidence >= 55 ? 'fairly' : 'tentatively';
    return {
      expectation,
      instruction: `You ${strength} ${expectation.statement}. Let this shape what surprises you and what doesn't — never state the expectation itself.`,
    };
  });
}

// ── Full pipeline, one call per turn ────────────────────────────────────

export interface BeliefPipelineResult {
  state:        BeliefState;
  expectations: Expectation[];
  guidance:     BehaviorGuidance[];
  conflicts:    BeliefConflict[];
  promptBlock:  string;
}

/**
 * Run the whole Experience → Belief → Expectation → Behavior pipeline for
 * a turn. Call `processExperience` first for anything new that happened
 * this turn (or skip it if nothing belief-relevant occurred), then call
 * this to get the current expectations/guidance/prompt block. Also applies
 * belief-decay.ts so stale, unreinforced beliefs soften over time even on
 * turns with no new experience.
 */
export async function runBeliefPipeline(
  userId: string,
  characterId: string,
): Promise<BeliefPipelineResult> {
  let state = await getBeliefState(userId, characterId);

  const decayed = decayStaleBeliefs(state);
  if (decayed.changed) {
    state = decayed.state;
    await saveBeliefState(userId, characterId, state);
  }

  const conflicts = detectBeliefConflicts(state);
  const expectations = deriveExpectations(state);
  const guidance = deriveBehaviorGuidance(expectations);

  return {
    state,
    expectations,
    guidance,
    conflicts,
    promptBlock: formatBeliefPipelineForPrompt(guidance, conflicts),
  };
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatBeliefPipelineForPrompt(guidance: BehaviorGuidance[], conflicts: BeliefConflict[]): string {
  if (!guidance.length && !conflicts.length) return '';

  const lines: string[] = ['# What Experience Has Taught You To Expect'];

  for (const g of guidance) {
    lines.push(`- ${g.instruction}`);
  }

  if (conflicts.length) {
    lines.push('');
    lines.push('Some of this is genuinely in tension right now — don\'t resolve it, just let the tension show as hesitation or a mixed reaction when it comes up:');
    for (const c of conflicts) {
      lines.push(`- ${c.description}`);
    }
  }

  return lines.join('\n');
}
