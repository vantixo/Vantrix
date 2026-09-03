/**
 * Confidence Engine — Vantrix
 *
 * Naming warning, read this first: this module's "confidence" is NOT
 * attachment-engine.ts's `PsychologyState.confidence` (a 0-100 hidden
 * attachment variable — her self-esteem) and NOT emotion-engine.ts's
 * `EmotionalState.confidence` (a single 0-1 float scoped only to "how
 * certain the keyword/valence scan is about the detected emotion").
 * Those two already-existing fields are inputs to this module in one
 * case (emotionalRead below reuses EmotionalState.confidence as its
 * base signal) but this module answers a different question: not "how
 * sure is she of herself" or "how sure is the emotion scanner," but
 * "how much should SHE trust her own read of the situation right now,"
 * broken out per domain, so uncertainty-engine.ts can decide where that
 * should visibly change how she talks (hedging, asking instead of
 * asserting) rather than silently assuming a good read everywhere.
 *
 * Same design stance as decision-engine.ts / drive-engine.ts: cheap
 * arithmetic over signals the pipeline already computes this turn, not
 * a second LLM call, and not a new source of truth — every input here
 * is something route.ts already has in hand by the time
 * executive-controller.ts runs (see that file's header for the exact
 * turn ordering this is meant to slot into, immediately alongside it).
 *
 * Four domains, each 0-1, deliberately kept separate rather than
 * collapsed into one number: a character can be very sure of the
 * relationship's shape while being genuinely unsure what a single
 * ambiguous message just meant, and conflating those would make
 * uncertainty-engine.ts's hedging decisions wrong in both directions.
 */

import type { EmotionalState } from '@/lib/ai/emotion-engine';
import type { RelationshipState } from '@/lib/ai/relationship-engine';
import type { MemoryNode } from '@/lib/ai/memory-graph';
import type { QuestionAndAirtimeSignals } from '@/lib/ai/conversation-thread-tracker';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface ConfidenceEngineInput {
  emotion:        EmotionalState;
  relationship:   RelationshipState;
  threadSignals:  QuestionAndAirtimeSignals;
  /** Memories actually surfaced for this turn (semanticRerankMemories output, or memory-graph query result) — NOT the full graph. */
  surfacedMemories: MemoryNode[];
  totalInteractions: number;
  daysKnown:         number;
  /** Hours since the previous turn, same computation route.ts already does for drive-engine.ts (hoursSinceLastMsgForDrives). */
  hoursSinceLastInteraction: number;
}

// ── Output ──────────────────────────────────────────────────────────────

export interface DomainConfidence {
  score:  number; // 0-1
  reason: string; // short, internal — for logging/debugging, never prompt-injected verbatim
}

export interface ConfidenceState {
  emotionalRead:    DomainConfidence; // how sure she is she's read the user's current emotional state correctly
  relationalRead:   DomainConfidence; // how sure she is her sense of "where we stand" is current and accurate
  threadContinuity: DomainConfidence; // how sure she is she's actually tracking the live thread(s) of conversation
  memoryGrounding:  DomainConfidence; // how sure she is the memories she'd draw on are actually relevant here, not stale/thin
  /** Weighted aggregate — see AGGREGATE_WEIGHTS. Not a simple mean: threadContinuity and emotionalRead matter more turn-to-turn than the other two. */
  overall: number;
}

const AGGREGATE_WEIGHTS = {
  emotionalRead:    0.35,
  relationalRead:   0.15,
  threadContinuity: 0.30,
  memoryGrounding:  0.20,
} as const;

// ── Domain scorers ──────────────────────────────────────────────────────

/**
 * Starts from emotion-engine.ts's own per-message confidence (it already
 * did the keyword/valence work) and adjusts for two things that score
 * alone doesn't capture: how many co-active secondary emotions were
 * detected (more = a messier, harder-to-read signal even if the top
 * pick scored confidently) and whether intensity is high while valence
 * sits near neutral (a strong-but-mixed signal — often sarcasm,
 * ambivalence, or a compound emotional state the scanner collapsed into
 * one label).
 */
function scoreEmotionalRead(emotion: EmotionalState): DomainConfidence {
  let score = emotion.confidence;

  if (emotion.secondary.length >= 2) {
    score -= 0.12;
  } else if (emotion.secondary.length === 1) {
    score -= 0.05;
  }

  const mixedSignal = emotion.intensity >= 0.6 && Math.abs(emotion.valence) < 0.25;
  if (mixedSignal) score -= 0.15;

  score = clamp01(score);

  const reason = mixedSignal
    ? 'high intensity but near-neutral valence — likely mixed or ambivalent signal'
    : emotion.secondary.length > 0
      ? `${emotion.secondary.length} co-active secondary emotion(s) detected alongside ${emotion.primary}`
      : `single clear signal (${emotion.primary})`;

  return { score, reason };
}

/**
 * More interactions and more days known = more accumulated evidence for
 * "where we stand," using a saturating curve so the difference between
 * 5 and 50 interactions matters far more than 500 vs 550 — there's a
 * real ceiling on how much more confident more data should make her.
 * A long gap since the last interaction pulls this back down: whatever
 * she knew may no longer be current.
 */
function scoreRelationalRead(
  totalInteractions: number,
  daysKnown: number,
  hoursSinceLastInteraction: number,
  relationship: RelationshipState,
): DomainConfidence {
  const interactionEvidence = saturate(totalInteractions, 40); // half-confidence around ~40 turns
  const durationEvidence = saturate(daysKnown, 21);             // half-confidence around ~3 weeks known

  let score = 0.5 * interactionEvidence + 0.5 * durationEvidence;

  // Staleness penalty: past 72h with no contact, evidence starts aging.
  // Scaled, not a cliff — 3 days barely dents it, 3 weeks halves it.
  const staleDays = Math.max(0, hoursSinceLastInteraction / 24 - 3);
  const stalenessPenalty = staleDays > 0 ? clamp01(staleDays / 21) * 0.35 : 0;
  score -= stalenessPenalty;

  // A currently-active jealousy spike or very early stage_xp into a
  // stage means the relationship's shape itself is in flux — lower
  // confidence that "where we stand" is a stable read rather than a
  // snapshot about to change.
  const inFlux = relationship.jealousy_level > 60 || relationship.stage_xp < relationship.stage_xp_cap * 0.1;
  if (inFlux) score -= 0.1;

  score = clamp01(score);

  const reason = stalenessPenalty > 0.05
    ? `${Math.round(hoursSinceLastInteraction / 24)}d since last contact — read may be stale`
    : inFlux
      ? 'relationship state currently in flux (jealousy spike or very early in stage)'
      : `${totalInteractions} interactions over ${daysKnown}d known`;

  return { score, reason };
}

/**
 * Directly from conversation-thread-tracker.ts's already-computed
 * signals — no new tracking added here, just interpretation. Many
 * unanswered questions piling up, or one sitting unanswered for a long
 * stretch, means she's more likely to have lost the actual thread.
 */
function scoreThreadContinuity(threadSignals: QuestionAndAirtimeSignals): DomainConfidence {
  let score = 1.0;

  if (threadSignals.unansweredQuestions >= 3) {
    score -= 0.35;
  } else if (threadSignals.unansweredQuestions >= 1) {
    score -= 0.12 * threadSignals.unansweredQuestions;
  }

  if (threadSignals.oldestUnansweredTurns >= 8) {
    score -= 0.25;
  } else if (threadSignals.oldestUnansweredTurns >= 4) {
    score -= 0.1;
  }

  score = clamp01(score);

  const reason = threadSignals.unansweredQuestions > 0
    ? `${threadSignals.unansweredQuestions} unanswered question(s), oldest ${threadSignals.oldestUnansweredTurns} turns back`
    : 'no pending unanswered questions';

  return { score, reason };
}

/**
 * Confidence that memories surfaced for this turn actually ground
 * whatever gets said, not that any memories exist in the abstract.
 * Built from count (zero surfaced = nothing to ground on, not a crisis,
 * just a documented floor), average emotional_weight (higher-weight
 * memories were judged more significant when written, see
 * memory-graph.ts's MEMORY_WEIGHT_* constants), and recency spread
 * (memories clustered entirely in the distant past are weaker grounding
 * for "right now" than a mix including something recent).
 */
function scoreMemoryGrounding(surfacedMemories: MemoryNode[]): DomainConfidence {
  if (surfacedMemories.length === 0) {
    return { score: 0.3, reason: 'no memories surfaced this turn — floor, not zero, since absence is not itself evidence of a bad read' };
  }

  const avgWeight = surfacedMemories.reduce((sum, m) => sum + m.emotional_weight, 0) / surfacedMemories.length;
  const weightScore = clamp01((avgWeight - 1) / 9); // MEMORY_WEIGHT_MIN=1..MAX=10 → 0-1

  const countScore = saturate(surfacedMemories.length, 3); // half-confidence around 3 surfaced memories

  const newestMs = Math.max(...surfacedMemories.map(m => new Date(m.created_at).getTime()));
  const daysSinceNewest = (Date.now() - newestMs) / 86_400_000;
  const recencyScore = clamp01(1 - daysSinceNewest / 60); // decays to 0 over ~60 days since the freshest surfaced memory

  const score = clamp01(0.4 * weightScore + 0.3 * countScore + 0.3 * recencyScore);

  return {
    score,
    reason: `${surfacedMemories.length} memories, avg weight ${avgWeight.toFixed(1)}/10, newest ${Math.round(daysSinceNewest)}d old`,
  };
}

// ── Orchestration ───────────────────────────────────────────────────────

export function computeConfidenceState(input: ConfidenceEngineInput): ConfidenceState {
  const emotionalRead    = scoreEmotionalRead(input.emotion);
  const relationalRead   = scoreRelationalRead(
    input.totalInteractions, input.daysKnown, input.hoursSinceLastInteraction, input.relationship,
  );
  const threadContinuity = scoreThreadContinuity(input.threadSignals);
  const memoryGrounding  = scoreMemoryGrounding(input.surfacedMemories);

  const overall =
    emotionalRead.score    * AGGREGATE_WEIGHTS.emotionalRead +
    relationalRead.score   * AGGREGATE_WEIGHTS.relationalRead +
    threadContinuity.score * AGGREGATE_WEIGHTS.threadContinuity +
    memoryGrounding.score  * AGGREGATE_WEIGHTS.memoryGrounding;

  return { emotionalRead, relationalRead, threadContinuity, memoryGrounding, overall: clamp01(overall) };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Saturating curve: 0 at n=0, 0.5 at n=halfPoint, asymptotic toward 1. */
function saturate(n: number, halfPoint: number): number {
  if (n <= 0) return 0;
  return n / (n + halfPoint);
}
