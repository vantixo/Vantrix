/**
 * Reflection Engine — Vantrix Cognition Layer
 *
 * consciousness-loop.ts's resolveCycle() lets a caller report back
 * specific, already-known facts to carry into working-memory.ts
 * (a promise made, a task completed). This module is upstream of that:
 * given everything else this layer computed for the turn — attention
 * result, executive decision, prediction, mismatches from
 * theory-of-mind.ts — it distills what's actually *worth* remembering
 * into a short set of candidate ResolutionNotes, so callers don't have
 * to hand-assemble that judgment call at every call site.
 *
 * It also covers the coarser-grained case resolveCycle() doesn't:
 * periodic (end-of-session, not end-of-turn) reflection, which looks
 * back over several turns' worth of admitted working-memory activity
 * and produces one compact narrative summary — the kind of thing worth
 * surfacing next session even after ordinary decay would have dropped
 * the individual items ("things felt tense for a while, then settled"
 * rather than five separate emotional_beat entries).
 */

import { logger } from '@/lib/logger';
import type { WorkingMemoryItem } from '@/lib/cognition/working-memory';
import type { ResolutionNote } from '@/lib/cognition/consciousness-loop';
import type { Mismatch } from '@/lib/cognition/theory-of-mind';
import type { PredictionResult } from '@/lib/cognition/prediction-engine';

// ── Types ───────────────────────────────────────────────────────────────

export interface TurnReflectionInput {
  turn: number;
  admitted: WorkingMemoryItem[];
  mismatches: Mismatch[];
  prediction: PredictionResult | null;
}

export interface SessionReflection {
  userId: string;
  characterId: string;
  /** Compact, prompt-ready narrative of the session's arc. */
  summary: string;
  /** The handful of items judged worth carrying past ordinary decay —
   *  callers typically write these back in with a deliberately high
   *  activation so they survive the next session's early turns. */
  carryForward: ResolutionNote[];
  spanTurns: number;
}

// Only emotional_beat / commitment items above this activation get
// folded into a session summary — routine open_threads and low-salience
// surfaced_facts aren't worth carrying across a session boundary.
const SESSION_WORTHY_THRESHOLD = 0.5;

// ── Per-turn reflection ─────────────────────────────────────────────────

/**
 * Distill one turn's cognition output into candidate ResolutionNotes.
 * This does not write anything itself — pass the result to
 * consciousness-loop.ts's resolveCycle() (optionally filtered further)
 * so the actual write stays owned by that module.
 */
export function reflectOnTurn(input: TurnReflectionInput): ResolutionNote[] {
  const notes: ResolutionNote[] = [];

  // A mismatch severe enough to matter is itself worth remembering —
  // if it wasn't corrected this turn, it should still be flagged next
  // turn rather than silently dropped.
  for (const mismatch of input.mismatches) {
    if (mismatch.severity < 0.5) continue;
    notes.push({
      id: `reflection-mismatch-${mismatch.signal.id}`,
      kind: 'open_thread',
      summary: mismatch.reason,
      activation: mismatch.severity,
    });
  }

  // Elevated disengagement risk is worth a note even though it isn't
  // tied to a single working-memory item — it's a trend, not an event,
  // and trends are exactly what ordinary per-signal attention scoring
  // (attention-engine.ts) has no way to notice on its own.
  if (input.prediction && input.prediction.disengagementRisk > 0.6 && input.prediction.confidence > 0.4) {
    notes.push({
      id: 'reflection-disengagement-risk',
      kind: 'watch_flag',
      summary: 'conversation trend has been cooling over recent turns',
      activation: input.prediction.disengagementRisk,
    });
  }

  return notes;
}

// ── Session-level reflection ────────────────────────────────────────────

/**
 * Summarize a session's worth of admitted working-memory items into one
 * short narrative plus a small carry-forward set. Intended to run once,
 * at session end (or when a long gap is detected before the next
 * session starts) — not per turn, since it's meant to survive exactly
 * the kind of decay/eviction that working-memory.ts otherwise applies.
 */
export function reflectOnSession(
  userId: string,
  characterId: string,
  items: WorkingMemoryItem[],
  spanTurns: number,
): SessionReflection {
  const worthy = items
    .filter(i => (i.kind === 'emotional_beat' || i.kind === 'commitment') && i.activation >= SESSION_WORTHY_THRESHOLD)
    .sort((a, b) => b.activation - a.activation);

  const summary = worthy.length === 0
    ? ''
    : `This session: ${worthy.map(i => i.summary).join('; ')}`;

  const carryForward: ResolutionNote[] = worthy.slice(0, 5).map(i => ({
    id: `session-carry-${i.id}`,
    kind: i.kind,
    summary: i.summary,
    activation: Math.max(i.activation, 0.6), // re-boosted so it survives early next-session decay
    data: i.data,
  }));

  logger.debug('[cognition/reflection-engine] session reflected', {
    userId, characterId, spanTurns, carried: carryForward.length,
  });

  return { userId, characterId, summary, carryForward, spanTurns };
}

/** Prompt-ready rendering of a session reflection, if it produced one. */
export function formatSessionReflectionForPrompt(reflection: SessionReflection): string {
  return reflection.summary ? `Looking back on last time: ${reflection.summary}` : '';
}
