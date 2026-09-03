/**
 * Priority Engine — Vantrix
 *
 * A small, generic weighted-scoring utility shared by goal-selector.ts
 * (which goal gets to drive this turn) and attention-router.ts (which
 * pieces of available context are worth surfacing given a limited
 * budget). Deliberately not specific to goals or memories — both callers
 * reduce their candidates to the same shape (importance/urgency/decay/
 * driveAlignment) and let this module do the actual ranking, so the
 * ranking math only has to be gotten right once.
 *
 * Pure, synchronous, no storage of its own.
 */

// ── Types ───────────────────────────────────────────────────────────────

export interface PriorityCandidate {
  id:        string;
  /** 0-100 — how much this inherently matters, independent of timing */
  importance: number;
  /** 0-100 — how time-sensitive this is right now (an open question outranks a long-term ambition in a given moment) */
  urgency:   number;
  /** 0-100 — how relevant this is to the current dominant drive/context; 50 = neutral */
  alignment: number;
  /** turns or hours since this was last acted on/surfaced — used to avoid the same thing dominating every turn */
  staleness: number;
  /** 0-1 multiplier applied last — lets callers suppress a candidate without removing it (e.g. "on cooldown") */
  suppression?: number;
}

export interface PriorityScore {
  id:     string;
  score:  number; // 0-100
  rank:   number; // 1 = highest
}

export interface PriorityWeights {
  importance: number;
  urgency:    number;
  alignment:  number;
  /** how much a fresh (non-stale) candidate is favored over a recently-used one; higher = stronger recency bias against repeats */
  freshnessBias: number;
}

export const DEFAULT_WEIGHTS: PriorityWeights = {
  importance:    0.4,
  urgency:       0.3,
  alignment:     0.2,
  freshnessBias: 0.1,
};

// ── Scoring ─────────────────────────────────────────────────────────────

function freshnessScore(staleness: number): number {
  // Staleness measured in turns/hours (caller-defined unit); this just
  // needs a monotonic curve that rewards "hasn't been used recently"
  // without letting ancient, irrelevant candidates dominate purely by
  // virtue of being old — caps out at 100.
  return Math.min(100, staleness * 8);
}

/**
 * Score and rank a set of candidates. `weights` defaults to a balanced mix
 * but callers with a strong reason (e.g. attention-router.ts under a tight
 * budget) can shift emphasis — e.g. weighting urgency higher when the
 * turn is time-sensitive.
 */
export function rankCandidates(
  candidates: PriorityCandidate[],
  weights: PriorityWeights = DEFAULT_WEIGHTS,
): PriorityScore[] {
  const scored = candidates.map((c) => {
    const suppression = c.suppression ?? 1;
    const raw =
      c.importance * weights.importance +
      c.urgency * weights.urgency +
      c.alignment * weights.alignment +
      freshnessScore(c.staleness) * weights.freshnessBias;

    return { id: c.id, score: Math.round(Math.max(0, Math.min(100, raw)) * suppression) };
  });

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  return sorted.map((s, i) => ({ ...s, rank: i + 1 }));
}

/**
 * Convenience: rank and return only the top N ids, in order — the common
 * case for both goal-selector.ts (top 1) and attention-router.ts (top N
 * within a budget).
 */
export function topCandidates(candidates: PriorityCandidate[], n: number, weights?: PriorityWeights): string[] {
  return rankCandidates(candidates, weights).slice(0, n).map(s => s.id);
}

/**
 * Score-weighted budget allocation: given a token/attention budget and a
 * ranked set of candidates each with an estimated cost, greedily fill the
 * budget in rank order. Used by attention-router.ts to decide how many
 * context items actually fit this turn rather than just picking a fixed
 * top-N.
 */
export function fillBudget(
  candidates: (PriorityCandidate & { cost: number })[],
  budget: number,
  weights?: PriorityWeights,
): string[] {
  const ranked = rankCandidates(candidates, weights);
  const byId = new Map(candidates.map(c => [c.id, c]));

  const chosen: string[] = [];
  let remaining = budget;

  for (const r of ranked) {
    const cost = byId.get(r.id)?.cost ?? 0;
    if (cost <= remaining) {
      chosen.push(r.id);
      remaining -= cost;
    }
  }

  return chosen;
}
