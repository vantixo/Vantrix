/**
 * Belief Updater — Vantrix
 *
 * The Experience → Belief step of belief-engine.ts's pipeline. Takes a
 * single piece of evidence (typically distilled from a memory-graph.ts
 * node — an argument, a kept promise, a moment of real vulnerability) and
 * either reinforces the closest existing belief or forms a new one.
 *
 * Deliberately simple matching (keyword/category overlap, not embeddings)
 * — this runs inline on the hot path and belief formation from a handful
 * of experiences should feel more like a person's gut sense forming than a
 * precise classifier. False merges are cheap to correct via
 * belief-conflict.ts; false splits just mean two closely related beliefs
 * coexist for a while, which is realistic too.
 */

import type { BeliefState, BeliefRecord, BeliefCategory } from '@/lib/ai/belief-engine';

// ── Config ──────────────────────────────────────────────────────────────

const NEW_BELIEF_STARTING_CONFIDENCE = 35;
const REINFORCE_STEP_FOR = 8;
const REINFORCE_STEP_AGAINST = 12; // disconfirming evidence moves confidence down faster than confirming moves it up — a person updates faster on being let down than on being reassured
const MATCH_OVERLAP_THRESHOLD = 0.34; // fraction of shared significant words to treat as "the same belief"

// ── Types ───────────────────────────────────────────────────────────────

export interface ExperienceEvidence {
  category:  BeliefCategory;
  /** The belief statement this experience supports or contradicts, phrased as if already true — e.g. "he follows through on what he says" */
  statement: string;
  /** true = this experience confirms the statement, false = it contradicts it */
  confirms:  boolean;
  /** 0-1, how strong a signal this single experience is; a small kindness is weaker evidence than a major rupture or repair */
  weight?:   number;
}

interface UpdaterOptions {
  maxBeliefs: number;
  slugify: (s: string) => string;
}

// ── Matching ────────────────────────────────────────────────────────────

const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'and', 'that', 'she', 'he', 'they', 'it', 'her', 'him', 'i', 'you']);

function significantWords(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function overlapScore(a: string, b: string): number {
  const wa = significantWords(a);
  const wb = significantWords(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size);
}

function findClosestBelief(beliefs: BeliefRecord[], category: BeliefCategory, statement: string): BeliefRecord | null {
  let best: BeliefRecord | null = null;
  let bestScore = 0;

  for (const b of beliefs) {
    if (b.category !== category) continue;
    const score = overlapScore(b.statement, statement);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }

  return bestScore >= MATCH_OVERLAP_THRESHOLD ? best : null;
}

// ── Update ──────────────────────────────────────────────────────────────

/**
 * Apply one piece of evidence to the belief set: reinforce/weaken the
 * closest matching belief, or form a fresh one starting at a deliberately
 * modest confidence (a single experience shouldn't produce a firmly held
 * belief). Evicts the weakest belief if the set is at capacity and a new
 * one needs to form.
 */
export function updateBeliefFromExperience(
  state: BeliefState,
  evidence: ExperienceEvidence,
  options: UpdaterOptions,
): BeliefState {
  const weight = Math.max(0.2, Math.min(1, evidence.weight ?? 0.6));
  const now = Date.now();

  const existing = findClosestBelief(state.beliefs, evidence.category, evidence.statement);

  if (existing) {
    const delta = (evidence.confirms ? REINFORCE_STEP_FOR : -REINFORCE_STEP_AGAINST) * weight;
    const confidence = Math.max(5, Math.min(95, Math.round(existing.confidence + delta)));

    const updatedBelief: BeliefRecord = {
      ...existing,
      confidence,
      evidenceFor: existing.evidenceFor + (evidence.confirms ? 1 : 0),
      evidenceAgainst: existing.evidenceAgainst + (evidence.confirms ? 0 : 1),
      lastReinforced: now,
    };

    return {
      beliefs: state.beliefs.map(b => (b.id === updatedBelief.id ? updatedBelief : b)),
      updatedAt: now,
    };
  }

  // Contradicting evidence with nothing to attach to isn't strong enough
  // on its own to seed a brand-new belief — a single disconfirming moment
  // shouldn't invent "she believes the opposite" out of nothing.
  if (!evidence.confirms) {
    return { ...state, updatedAt: now };
  }

  const fresh: BeliefRecord = {
    id: options.slugify(evidence.statement),
    category: evidence.category,
    statement: evidence.statement,
    confidence: Math.round(NEW_BELIEF_STARTING_CONFIDENCE * weight + NEW_BELIEF_STARTING_CONFIDENCE * 0.5),
    evidenceFor: 1,
    evidenceAgainst: 0,
    firstFormed: now,
    lastReinforced: now,
  };

  let beliefs = [...state.beliefs, fresh];

  if (beliefs.length > options.maxBeliefs) {
    // Evict the weakest, least-recently-reinforced belief to make room —
    // beliefs that never get reinforced are exactly the ones that
    // shouldn't be taking up a permanent slot.
    beliefs = [...beliefs].sort((a, b) => a.confidence - b.confidence || a.lastReinforced - b.lastReinforced);
    beliefs = beliefs.slice(1);
  }

  return { beliefs, updatedAt: now };
}
