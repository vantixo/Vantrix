/**
 * Attention Engine — Vantrix Cognition Layer
 *
 * Not to be confused with ai/attention-router.ts, which allocates a
 * *token budget* across candidate context for the prompt this turn. This
 * module runs one layer up: it decides what's salient enough to be
 * *written into working-memory.ts* at all, and what deserves to be
 * broadcast to the rest of the cognition loop as "worth everyone
 * knowing about right now" (the global-workspace "broadcast" step).
 *
 * ai/attention-router.ts asks "given a budget, what earns a slot in the
 * prompt this turn". This module asks the prior question: "given
 * everything that just happened, what's worth remembering past this
 * turn at all". Its output feeds working-memory.ts, not the prompt
 * directly.
 */

import { commit, tick, type WorkingMemoryItem, type WorkingMemoryKind } from '@/lib/cognition/working-memory';

export interface AttentionSignal {
  id: string;
  kind: WorkingMemoryKind;
  summary: string;
  /**
   * Raw, engine-reported importance (0–1) before this module's own
   * weighting is applied — e.g. drive-engine.ts's magnitude for an
   * emotional beat, or a flat 1.0 for anything moderation/safety-flagged.
   */
  rawSalience: number;
  data?: Record<string, unknown>;
}

/** Per-kind multipliers — safety-relevant items are never allowed to be
 *  out-competed by ordinary conversational salience, and open threads
 *  decay in importance faster than commitments (forgetting a tangent is
 *  low-stakes; forgetting a promise isn't). */
const KIND_WEIGHT: Record<WorkingMemoryKind, number> = {
  watch_flag:    1.5,
  commitment:    1.2,
  active_task:   1.1,
  emotional_beat: 1.0,
  surfaced_fact: 0.9,
  open_thread:   0.8,
};

/** Only signals scoring at or above this after weighting get written to
 *  working memory — everything else is judged not worth carrying past
 *  this turn. */
const ATTENTION_THRESHOLD = 0.25;

export interface AttentionResult {
  admitted: WorkingMemoryItem[];
  dropped: AttentionSignal[];
}

/**
 * Score, threshold, and commit incoming signals into working memory for
 * one turn. This is the "broadcast" step of the loop: consciousness-loop.ts
 * calls tick() first (decaying last turn's state), then this, so newly
 * admitted items land in a freshly-decayed buffer rather than competing
 * against stale activation from several turns ago.
 */
export function attend(
  userId: string,
  characterId: string,
  signals: AttentionSignal[],
): AttentionResult {
  tick(userId, characterId);

  const admitted: WorkingMemoryItem[] = [];
  const dropped: AttentionSignal[] = [];

  for (const signal of signals) {
    const weight = KIND_WEIGHT[signal.kind] ?? 1.0;
    const score = Math.min(1, signal.rawSalience * weight);

    if (score < ATTENTION_THRESHOLD) {
      dropped.push(signal);
      continue;
    }

    const item = commit(userId, characterId, {
      id: signal.id,
      kind: signal.kind,
      summary: signal.summary,
      activation: score,
      data: signal.data,
    });
    admitted.push(item);
  }

  return { admitted, dropped };
}

/**
 * Convenience for the common case where the caller just has a single
 * noteworthy thing to flag (e.g. a moderation hit, or a promise the
 * character just made) rather than a batch to score together.
 */
export function attendOne(
  userId: string,
  characterId: string,
  signal: AttentionSignal,
): WorkingMemoryItem | null {
  const { admitted } = attend(userId, characterId, [signal]);
  return admitted[0] ?? null;
}
