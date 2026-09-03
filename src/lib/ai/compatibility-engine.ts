/**
 * Compatibility Engine — Vantrix
 *
 * Everything else in this directory that touches the romantic/relational
 * side of a character (romance-engine.ts's register, desire-engine.ts's
 * core desire, attraction-engine.ts's per-turn pull) operates turn to
 * turn, off signals that move every message. Nothing answers the slower
 * question underneath all of that: structurally, on paper, do this
 * character and this specific user actually fit — same values, real
 * overlapping interests, a communication style that lands — or is
 * whatever warmth exists happening in spite of a mismatch rather than
 * because of a real one. That's what compatibility should mean, and
 * conflating it with moment-to-moment attraction (see attraction-engine.ts's
 * header) is exactly the thing this split avoids.
 *
 * Deliberately built from the two sources of truth that already exist
 * and change slowly — CharacterData's authored values_list/char_* traits
 * (creator-set, essentially static) and user-fact-graph.ts's accumulated
 * facts (grows slowly, one extraction pass at a time) — rather than
 * anything per-message. Recomputing this every turn is cheap (pure
 * synchronous keyword overlap, no LLM call) but the inputs themselves
 * are slow-moving, so callers should expect this to read the same for
 * many turns in a row and change only as the fact graph grows.
 *
 * Heuristic keyword overlap, same "false negatives are the safe failure
 * mode" stance as repair-engine.ts / family-engine.ts: missing a real
 * point of overlap just under-credits compatibility, a false positive
 * risks asserting shared ground that was never actually established.
 */

import type { CharacterData } from '@/lib/ai/prompt';
import type { UserFact }      from '@/lib/ai/user-fact-graph';

// ── Output ──────────────────────────────────────────────────────────────

export interface CompatibilityDomainScore {
  score:  number; // 0-1
  reason: string;
}

export interface CompatibilityState {
  /** Character's authored values_list against the user's belief/aspiration facts. */
  valuesAlignment:   CompatibilityDomainScore;
  /** Character's tags/personality/description text against the user's hobby/preference facts. */
  interestOverlap:   CompatibilityDomainScore;
  /** char_depth/char_openness traits against the kind of facts the user actually shares (deep vs surface). */
  communicationFit:  CompatibilityDomainScore;
  overall: number;
  promptBlock: string;
}

const AGGREGATE_WEIGHTS = {
  valuesAlignment:  0.4,
  interestOverlap:  0.35,
  communicationFit: 0.25,
} as const;

// ── Helpers ─────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Lowercased, punctuation-stripped word set — deliberately crude tokenization, matching family-engine.ts's substring-match stance rather than any NLP dependency. */
function words(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3),
  );
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

// ── Domain scorers ──────────────────────────────────────────────────────

/**
 * character.values_list is short (creator-authored, usually 3-6 entries)
 * so this checks each value's words against the combined text of the
 * user's belief + aspiration facts, rather than a strict set-intersection
 * that a short list would almost always fail.
 */
function scoreValuesAlignment(character: CharacterData, facts: UserFact[]): CompatibilityDomainScore {
  const values = character.values_list ?? [];
  if (values.length === 0) {
    return { score: 0.5, reason: 'character has no authored values_list — neutral default, not evidence of mismatch' };
  }

  const relevantFacts = facts.filter(f => f.category === 'belief' || f.category === 'aspiration');
  if (relevantFacts.length === 0) {
    return { score: 0.5, reason: 'no belief/aspiration facts learned yet — neutral default' };
  }

  const userWords = new Set<string>();
  for (const f of relevantFacts) for (const w of words(f.value)) userWords.add(w);

  let matchedValues = 0;
  for (const v of values) {
    if (overlapCount(words(v), userWords) > 0) matchedValues++;
  }

  const score = clamp01(matchedValues / values.length);
  return {
    score,
    reason: `${matchedValues}/${values.length} authored values echoed in ${relevantFacts.length} belief/aspiration fact(s)`,
  };
}

/**
 * Character's tags + personality + description text (the closest thing
 * to a stable "what this character is into" surface) against the
 * user's hobby/preference facts. A real overlap here is the strongest,
 * least ambiguous signal this module has access to.
 */
function scoreInterestOverlap(character: CharacterData, facts: UserFact[]): CompatibilityDomainScore {
  const relevantFacts = facts.filter(f => f.category === 'hobby' || f.category === 'preference');
  if (relevantFacts.length === 0) {
    return { score: 0.5, reason: 'no hobby/preference facts learned yet — neutral default' };
  }

  const tagWords = Array.isArray(character.tags)
    ? words((character.tags as string[]).join(' '))
    : new Set<string>();
  const profileWords = words([character.personality ?? '', character.description ?? ''].join(' '));
  const characterWords = new Set<string>([...tagWords, ...profileWords]);

  const userWords = new Set<string>();
  for (const f of relevantFacts) for (const w of words(f.value)) userWords.add(w);

  const matched = overlapCount(characterWords, userWords);
  // Saturating rather than linear — 1 real overlap already means something,
  // diminishing returns after that rather than requiring many matches for
  // a meaningful score.
  const score = clamp01(matched / (matched + 2));

  return {
    score,
    reason: matched > 0
      ? `${matched} overlapping interest word(s) between character profile and user hobby/preference facts`
      : 'no detected overlap between character profile and user hobby/preference facts',
  };
}

/**
 * Not "do they talk the same way" (writing-style.ts's job) but "does
 * the character's authored depth/openness suit how this user actually
 * engages" — a high char_depth character paired with a user who mostly
 * shares surface preference facts isn't a mismatch exactly, just an
 * untested fit; a high char_depth character paired with a user who
 * volunteers real belief/pain_point facts is a good structural sign.
 */
function scoreCommunicationFit(character: CharacterData, facts: UserFact[]): CompatibilityDomainScore {
  const depth = (character.char_depth ?? 50) / 100;
  const openness = (character.char_openness ?? 50) / 100;

  const deepFacts = facts.filter(f => f.category === 'belief' || f.category === 'pain_point' || f.category === 'aspiration').length;
  const surfaceFacts = facts.filter(f => f.category === 'hobby' || f.category === 'preference').length;
  const totalFacts = deepFacts + surfaceFacts;

  if (totalFacts === 0) {
    return { score: 0.5, reason: 'not enough facts yet to judge communication fit — neutral default' };
  }

  const userDepthRatio = deepFacts / totalFacts;
  // Fit is highest when character depth/openness roughly matches how
  // deep the user tends to go — a large gap in either direction (a very
  // guarded character with a very open user, or vice versa) scores lower.
  const characterDepthSignal = (depth + openness) / 2;
  const gap = Math.abs(characterDepthSignal - userDepthRatio);
  const score = clamp01(1 - gap);

  return {
    score,
    reason: `character depth/openness signal ${characterDepthSignal.toFixed(2)} vs user's deep-fact ratio ${userDepthRatio.toFixed(2)} (gap ${gap.toFixed(2)})`,
  };
}

// ── Orchestration ───────────────────────────────────────────────────────

export function computeCompatibilityState(character: CharacterData, facts: UserFact[]): CompatibilityState {
  const valuesAlignment  = scoreValuesAlignment(character, facts);
  const interestOverlap  = scoreInterestOverlap(character, facts);
  const communicationFit = scoreCommunicationFit(character, facts);

  const overall = clamp01(
    valuesAlignment.score  * AGGREGATE_WEIGHTS.valuesAlignment +
    interestOverlap.score  * AGGREGATE_WEIGHTS.interestOverlap +
    communicationFit.score * AGGREGATE_WEIGHTS.communicationFit,
  );

  const state: Omit<CompatibilityState, 'promptBlock'> = { valuesAlignment, interestOverlap, communicationFit, overall };
  return { ...state, promptBlock: formatCompatibilityForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

/**
 * Deliberately quiet unless there's a genuinely strong or genuinely thin
 * signal — a middling 0.5 "neutral default" score (the common case early
 * in a relationship, before enough facts exist) has nothing worth
 * asserting and should never manufacture a sense of chemistry that
 * isn't backed by anything real.
 */
export function formatCompatibilityForPrompt(state: Omit<CompatibilityState, 'promptBlock'>): string {
  if (state.overall >= 0.7) {
    return '# Compatibility\nThere is real, specific common ground here (shared values and/or interests) — let it surface naturally as genuine recognition, not generic flattery.';
  }
  if (state.overall < 0.3 && (state.valuesAlignment.score < 0.3 || state.interestOverlap.score < 0.3)) {
    return "# Compatibility\nNot much overlap has actually been established yet — don't assert shared interests or values that haven't come up.";
  }
  return '';
}
