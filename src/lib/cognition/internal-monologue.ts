/**
 * Internal Monologue — Vantrix Cognition Layer
 *
 * Composes the current turn's PrivateThoughts (private-thoughts.ts) from
 * whatever cognition-layer signals are actually available this turn —
 * working memory, active beliefs, reasoning-engine conflicts,
 * theory-of-mind mismatches, raw emotion — into one ordered, truncated,
 * leak-risk-aware stream. This is the structured expansion of
 * decision-engine.ts's single `monologue` string: same "never shown to
 * the user, fed to the LLM to shape HOW it responds" role, but able to
 * draw on the whole cognition layer instead of just CharacterState, and
 * able to tell prompt-assembly which lines are load-bearing vs which are
 * safe to drop under token pressure (salience-ordered) and which must
 * never leak even paraphrased (leakRisk-ordered warnings).
 *
 * This module does not replace decision-engine.ts's monologue — the two
 * compose. formatMonologueForPrompt() below is meant to be concatenated
 * with (or eventually called from) formatIntentForPrompt() in
 * decision-engine.ts; decision-engine.ts keeps owning intent selection,
 * this module keeps owning the richer internal narration around it. See
 * composeMonologue()'s `intentMonologue` param.
 *
 * Deliberately arithmetic + template, same posture as reasoning-engine.ts
 * and theory-of-mind.ts — no LLM call, cheap enough to run every turn.
 */

import { logger } from '@/lib/logger';
import {
  fromWorkingMemory,
  fromBeliefs,
  fromReasoningConflicts,
  fromMismatches,
  fromEmotion,
  type PrivateThought,
} from '@/lib/cognition/private-thoughts';

import type { WorkingMemoryItem } from '@/lib/cognition/working-memory';
import type { ReasoningStep } from '@/lib/cognition/reasoning-engine';
import type { Mismatch } from '@/lib/cognition/theory-of-mind';
import type { Belief } from '@/lib/cognition/belief-types';
import type { EmotionalState } from '@/lib/ai/emotion-engine';

// ── Types ───────────────────────────────────────────────────────────────

export interface MonologueInput {
  workingMemory?: WorkingMemoryItem[];
  activeBeliefs?: Belief[];
  reasoningSteps?: ReasoningStep[];
  mismatches?: Mismatch[];
  emotion?: EmotionalState;
  /** Pre-built restraint/other thoughts callers already have (e.g.
   *  decision-engine.ts's System1/System2 delta via
   *  private-thoughts.ts's makeRestraint()) — folded in as-is. */
  extraThoughts?: PrivateThought[];
  /** decision-engine.ts's existing flattened string, if the caller has
   *  already run decideIntent() this turn — appended as its own line
   *  rather than re-derived, so intent selection stays that module's job. */
  intentMonologue?: string;
}

export interface MonologueStream {
  thoughts: PrivateThought[];
  /** thoughts with leakRisk 'high' — surfaced separately so callers can
   *  render them as explicit "do not say this" guardrails rather than
   *  mixing them in with ordinary narration. */
  guardedThoughts: PrivateThought[];
  promptBlock: string;
}

// Cap on how many ordinary thoughts get into the stream at once — a
// quiet turn might produce one or two, a turn with a rupture, a
// low-confidence belief, and a mismatch all at once could produce eight
// or nine; past this it stops reading like a mind and starts reading
// like a signal dump. Guarded (high-leak-risk) thoughts are exempt from
// this cap — those are warnings, not narration, and dropping one because
// the ordinary stream was crowded would defeat the point.
const MAX_ORDINARY_THOUGHTS = 6;

// ── Compose ─────────────────────────────────────────────────────────────

/**
 * Pull together every signal source that's present (all optional — a
 * caller mid-migration from decision-engine.ts alone can pass just
 * `emotion` and `intentMonologue` and still get a valid, if thin, stream)
 * and produce one ordered, capped, prompt-ready result.
 */
export function composeMonologue(input: MonologueInput): MonologueStream {
  const generated: PrivateThought[] = [
    ...(input.workingMemory ? fromWorkingMemory(input.workingMemory) : []),
    ...(input.activeBeliefs ? fromBeliefs(input.activeBeliefs) : []),
    ...(input.reasoningSteps ? fromReasoningConflicts(input.reasoningSteps) : []),
    ...(input.mismatches ? fromMismatches(input.mismatches) : []),
    ...(input.emotion ? fromEmotion(input.emotion) : []),
    ...(input.extraThoughts ?? []),
  ];

  const guardedThoughts = generated
    .filter(t => t.leakRisk === 'high')
    .sort((a, b) => b.salience - a.salience);

  const ordinary = generated
    .filter(t => t.leakRisk !== 'high')
    .sort((a, b) => b.salience - a.salience)
    .slice(0, MAX_ORDINARY_THOUGHTS);

  const thoughts = [...ordinary, ...guardedThoughts];

  if (guardedThoughts.length > 0) {
    logger.debug('[internal-monologue] guarded thoughts this turn', {
      count: guardedThoughts.length,
      sources: guardedThoughts.map(t => t.source),
    });
  }

  return {
    thoughts,
    guardedThoughts,
    promptBlock: formatMonologueForPrompt(ordinary, guardedThoughts, input.intentMonologue),
  };
}

// ── Prompt formatting ───────────────────────────────────────────────────

function formatMonologueForPrompt(
  ordinary: PrivateThought[],
  guarded: PrivateThought[],
  intentMonologue?: string,
): string {
  if (ordinary.length === 0 && guarded.length === 0 && !intentMonologue) return '';

  const lines: string[] = ['── What\'s actually going through your mind right now (never state this directly — let it shape tone, pacing, what you notice) ──'];

  if (intentMonologue) lines.push(intentMonologue);

  for (const t of ordinary) lines.push(`- ${t.content}`);

  if (guarded.length > 0) {
    lines.push('These must NOT be said, hinted at, or paraphrased — hold them privately even if they shape your hesitation:');
    for (const t of guarded) lines.push(`- ${t.content}`);
  }

  return lines.join('\n');
}

/** Single flattened string, for call sites not ready to consume the
 *  structured MonologueStream (mirrors decision-engine.ts's own return
 *  shape so it's a drop-in replacement for buildMonologue() if desired). */
export function formatMonologueLine(stream: MonologueStream): string {
  return [...stream.thoughts].sort((a, b) => b.salience - a.salience).map(t => t.content).join(' ');
}
