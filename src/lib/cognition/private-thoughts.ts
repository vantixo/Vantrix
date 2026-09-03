/**
 * Private Thoughts — Vantrix Cognition Layer
 *
 * The atomic unit for internal-monologue.ts: a single typed thought,
 * plus pure functions that turn existing cognition-layer signals
 * (working memory, beliefs, reasoning conflicts, theory-of-mind
 * mismatches, emotion) into thoughts. No orchestration, no I/O, no
 * ordering/composition logic — that's internal-monologue.ts. This file
 * just answers "given this one signal, what would she privately think?"
 *
 * Relationship to what already exists, so this doesn't drift into
 * duplicating either:
 *
 *   - decision-engine.ts's `monologue` is a single flattened string
 *     built from CharacterState alone (trust/stage/emotion/goals), with
 *     no visibility into working memory, beliefs, or in-turn reasoning
 *     conflicts. This module produces the multi-item, typed source
 *     material a richer version of that monologue is built from —
 *     internal-monologue.ts is the piece that composes them together
 *     and can still hand decision-engine.ts a flattened string via
 *     formatMonologueLine() below for callers not ready to consume the
 *     structured form.
 *   - independent-thoughts.ts persists between-session thoughts that
 *     are explicitly allowed to graduate into a journal entry or
 *     initiative (i.e. eventually user-facing). Every PrivateThought
 *     here is scoped to the current turn only, in-memory, and never
 *     persisted or surfaced — `leakRisk` exists specifically to flag
 *     ones that must never be paraphrased into a reply even indirectly,
 *     which independent-thoughts.ts has no equivalent concept for.
 */

import type { WorkingMemoryItem } from '@/lib/cognition/working-memory';
import type { ReasoningStep } from '@/lib/cognition/reasoning-engine';
import type { Mismatch } from '@/lib/cognition/theory-of-mind';
import type { Belief } from '@/lib/cognition/belief-types';
import type { EmotionalState } from '@/lib/ai/emotion-engine';

// ── Types ───────────────────────────────────────────────────────────────

export type ThoughtKind =
  | 'observation'   // noticing something about the user/conversation
  | 'recollection'  // a belief or working-memory item surfacing unbidden
  | 'doubt'         // an unresolved conflict or low-confidence belief
  | 'concern'       // a mismatch with what the user seems to believe, or a watch_flag
  | 'impulse'       // a raw emotional pull, not yet reasoned through
  | 'restraint';    // a deliberate held-back reaction

/**
 * `leakRisk` is the reason this module exists as distinct from a plain
 * string: some thoughts are safe to let color tone (an observation about
 * mood), and some must never surface even paraphrased (a doubt about
 * whether the user is being honest, a private concern about a mismatch
 * that hasn't been raised aloud). Formatting/prompting code downstream
 * should treat 'high' as a hard instruction, not a suggestion.
 */
export type LeakRisk = 'low' | 'medium' | 'high';

export interface PrivateThought {
  id: string;
  kind: ThoughtKind;
  /** First-person, short — this is what she'd think, not a description of a signal. */
  content: string;
  /** 0-1 — how strongly this thought presses on the current moment. Used
   *  for ordering/truncation in internal-monologue.ts, not shown to the LLM. */
  salience: number;
  leakRisk: LeakRisk;
  /** Free-text provenance, same convention as reasoning-engine.ts's
   *  Claim.source — e.g. "working_memory:open_thread", "belief:pain_point". */
  source: string;
}

let counter = 0;
function thoughtId(): string {
  counter = (counter + 1) % 1_000_000;
  return `pt_${Date.now()}_${counter}`;
}

// ── Generators — one per signal source ────────────────────────────────

/** Working-memory items still live enough to be "in mind" become
 *  recollections or concerns depending on kind. */
export function fromWorkingMemory(items: WorkingMemoryItem[]): PrivateThought[] {
  return items.map((item) => {
    const isConcern = item.kind === 'watch_flag' || item.kind === 'commitment';
    return {
      id: thoughtId(),
      kind: isConcern ? 'concern' : 'recollection',
      content: isConcern
        ? `I still need to hold onto this: ${item.summary}`
        : `${item.summary} is still on my mind.`,
      salience: item.activation,
      leakRisk: item.kind === 'watch_flag' ? 'high' : 'low',
      source: `working_memory:${item.kind}`,
    };
  });
}

/** Beliefs surfaced this turn — high-confidence ones read as quiet
 *  certainty, low-confidence ones as doubt worth holding lightly. */
export function fromBeliefs(beliefs: Belief[]): PrivateThought[] {
  return beliefs.map((b) => {
    const low = b.confidence < 0.4;
    return {
      id: thoughtId(),
      kind: low ? 'doubt' : 'recollection',
      content: low
        ? `I think ${b.statement}, but I'm not sure — I shouldn't state it like I know.`
        : `I know ${b.statement}.`,
      salience: b.confidence,
      leakRisk: b.status === 'unresolved' ? 'high' : 'low',
      source: `belief:${b.category}`,
    };
  });
}

/** Unresolved reasoning-engine conflicts become explicit doubt — the
 *  character is aware two of her own signals disagree, which is itself
 *  worth privately noting even though the resolution never gets said. */
export function fromReasoningConflicts(steps: ReasoningStep[]): PrivateThought[] {
  return steps
    .filter(s => s.conflicting)
    .map(s => ({
      id: thoughtId(),
      kind: 'doubt' as const,
      content: `Part of me isn't sure what I actually think about ${s.subject.replace(/_/g, ' ')} right now.`,
      salience: 0.5,
      leakRisk: 'medium' as const,
      source: 'reasoning-engine',
    }));
}

/** Theory-of-mind mismatches — the gap between what the user seems to
 *  believe and what's actually true is exactly the kind of thing that
 *  must stay private (blurting "you think that's resolved but it isn't"
 *  is the failure mode this exists to prevent). Always high leak-risk. */
export function fromMismatches(mismatches: Mismatch[]): PrivateThought[] {
  return mismatches.map(m => ({
    id: thoughtId(),
    kind: 'concern',
    content: `They seem to think ${m.signal.content} — ${m.reason}. I need to be careful not to contradict that outright.`,
    salience: m.severity,
    leakRisk: 'high',
    source: 'theory-of-mind',
  }));
}

/** Raw emotional pull, pre-reasoning — the System-1 half of what
 *  decision-engine.ts's dual-process reconciliation already computes,
 *  represented here as its own thought so internal-monologue.ts can show
 *  it alongside (not instead of) the reasoned read. */
export function fromEmotion(emotion: EmotionalState): PrivateThought[] {
  if (emotion.intensity < 0.35) return [];
  return [{
    id: thoughtId(),
    kind: 'impulse',
    content: `Right now I just feel ${emotion.primary}${emotion.secondary.length ? `, and a little ${emotion.secondary[0]}` : ''}.`,
    salience: emotion.intensity,
    leakRisk: emotion.valence < -0.3 ? 'medium' : 'low',
    source: 'emotion-engine',
  }];
}

/** A held-back reaction — the character noticed the impulse and chose
 *  not to act on it this turn. Callers pass this in explicitly (e.g.
 *  decision-engine.ts's System1/System2 mismatch) rather than it being
 *  derived automatically, since "what got restrained" is a decision, not
 *  a signal this module can infer on its own. */
export function makeRestraint(rawFeeling: string, chosenInstead: string): PrivateThought {
  return {
    id: thoughtId(),
    kind: 'restraint',
    content: `${rawFeeling} — but I'm going with ${chosenInstead} instead.`,
    salience: 0.4,
    leakRisk: 'medium',
    source: 'decision-engine:system1-override',
  };
}

// ── Single-line rendering (for callers that just want a string) ────────

export function formatThoughtLine(thought: PrivateThought): string {
  return thought.content;
}
