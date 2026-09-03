/**
 * Belief Conflict — Vantrix
 *
 * Two things can go wrong that belief-updater.ts's simple reinforcement
 * doesn't fully handle:
 *
 *   1. Two *different* beliefs (different enough in wording that
 *      belief-updater.ts treated them as separate) end up pointing in
 *      opposite directions once both are confidently held — e.g. "he
 *      always follows through" and "he lets people down when it's
 *      inconvenient" can both form from real but different experiences.
 *   2. A single strong piece of fresh evidence sharply contradicts an
 *      established, confident belief — a near-instant "wait, that doesn't
 *      match what I thought" moment, distinct from the slow erosion
 *      belief-updater.ts already applies to the matched belief itself.
 *
 * This module only *detects* these; it deliberately does not auto-resolve
 * them. belief-engine.ts surfaces detected conflicts into the prompt as
 * texture — a character noticing her own contradiction — rather than the
 * system silently picking a winner, which would flatten exactly the kind
 * of nuance a real, coherent-but-imperfect self has.
 */

import type { BeliefState, BeliefRecord, BeliefCategory } from '@/lib/ai/belief-engine';
import type { ExperienceEvidence } from '@/lib/ai/belief-updater';

// ── Config ──────────────────────────────────────────────────────────────

// Both beliefs need to be at least this confident before a mismatch
// between them is worth surfacing — two half-formed beliefs disagreeing
// isn't interesting yet.
const CONFLICT_CONFIDENCE_FLOOR = 40;

// Word pairs whose presence across two same-category beliefs suggests
// opposite polarity. Deliberately small and literal rather than an NLP
// sentiment pass — this runs inline, cheaply, every turn.
const OPPOSING_PAIRS: [string, string][] = [
  ['always', 'never'],
  ['reliable', 'unreliable'],
  ['trust', 'distrust'],
  ['follows', 'ignores'],
  ['shows up', 'disappears'],
  ['honest', 'dishonest'],
  ['safe', 'unsafe'],
  ['stays', 'leaves'],
  ['cares', 'indifferent'],
  ['lasting', 'temporary'],
];

function impliesOpposite(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return OPPOSING_PAIRS.some(([x, y]) => (la.includes(x) && lb.includes(y)) || (la.includes(y) && lb.includes(x)));
}

// ── Types ───────────────────────────────────────────────────────────────

export interface BeliefConflict {
  kind: 'competing_beliefs' | 'evidence_contradicts_belief';
  description: string; // human/prompt-readable summary, never an instruction to resolve it
  beliefIds: string[];
  severity: 'mild' | 'notable';
}

// ── Competing beliefs within the same category ─────────────────────────

/**
 * Scan same-category belief pairs for opposing language, both held with
 * reasonable confidence. O(n^2) over a capped, small belief set (see
 * belief-engine.ts's MAX_BELIEFS) so this is cheap.
 */
export function findCompetingBeliefs(state: BeliefState): BeliefConflict[] {
  const conflicts: BeliefConflict[] = [];
  const byCategory = new Map<BeliefCategory, BeliefRecord[]>();

  for (const b of state.beliefs) {
    if (b.confidence < CONFLICT_CONFIDENCE_FLOOR) continue;
    const list = byCategory.get(b.category) ?? [];
    list.push(b);
    byCategory.set(b.category, list);
  }

  for (const beliefs of byCategory.values()) {
    for (let i = 0; i < beliefs.length; i++) {
      for (let j = i + 1; j < beliefs.length; j++) {
        const a = beliefs[i]!;
        const b = beliefs[j]!;
        if (!impliesOpposite(a.statement, b.statement)) continue;

        const bothConfident = a.confidence >= 60 && b.confidence >= 60;
        conflicts.push({
          kind: 'competing_beliefs',
          description: `part of her expects "${a.statement}," but another part has learned "${b.statement}"`,
          beliefIds: [a.id, b.id],
          severity: bothConfident ? 'notable' : 'mild',
        });
      }
    }
  }

  return conflicts;
}

/**
 * Convenience entry point belief-engine.ts calls each turn. Currently just
 * competing-beliefs detection, but kept separate from
 * checkEvidenceAgainstBelief so belief-engine.ts can call the latter only
 * when there's actually fresh evidence this turn, without re-scanning the
 * whole belief set unnecessarily.
 */
export function detectBeliefConflicts(state: BeliefState): BeliefConflict[] {
  return findCompetingBeliefs(state);
}

// ── Fresh evidence vs an established belief ─────────────────────────────

/**
 * Check whether a single new piece of evidence sharply contradicts an
 * already-confident belief — distinct from belief-updater.ts's gradual
 * reinforcement of the matched belief itself. Call this *before*
 * updateBeliefFromExperience so the conflict reflects the belief's state
 * prior to this turn's update; the update still happens regardless of
 * whether a conflict is flagged.
 */
export function checkEvidenceAgainstBelief(
  state: BeliefState,
  evidence: ExperienceEvidence,
  matchedBeliefId: string | null,
): BeliefConflict | null {
  if (!matchedBeliefId || evidence.confirms) return null;

  const belief = state.beliefs.find(b => b.id === matchedBeliefId);
  if (!belief || belief.confidence < 65) return null;

  const weight = evidence.weight ?? 0.6;
  if (weight < 0.6) return null; // only strong disconfirming evidence is worth flagging as a live conflict, not just gradual softening

  return {
    kind: 'evidence_contradicts_belief',
    description: `something that just happened cuts against how sure she's been that "${belief.statement}"`,
    beliefIds: [belief.id],
    severity: weight >= 0.85 ? 'notable' : 'mild',
  };
}
