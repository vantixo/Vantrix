/**
 * Attention Router — Vantrix
 *
 * By the time a turn is ready to generate, there's far more available
 * context than could ever be usefully injected at once: memory-graph.ts
 * highlights, user-fact-graph.ts facts, theory-of-mind.ts signals,
 * self-model.ts's identity block, drive-engine.ts impulses, the selected
 * goal/task. Every prior engine assumed its own output would just get
 * concatenated in; nothing decided what actually deserves attention this
 * specific turn under a real budget, the way a person's attention is
 * naturally selective rather than omniscient.
 *
 * This module takes a heterogeneous list of candidate context items,
 * scores them with priority-engine.ts, and fills a token-ish budget
 * greedily in priority order — mirroring how a person's attention
 * actually narrows onto a handful of things at once, not everything they
 * technically know.
 */

import { fillBudget, type PriorityWeights } from '@/lib/ai/priority-engine';
import type { DriveState } from '@/lib/ai/drive-engine';

// ── Types ───────────────────────────────────────────────────────────────

export type AttentionSource =
  | 'memory' | 'user_fact' | 'theory_of_mind' | 'self_model'
  | 'drive_impulse' | 'selected_goal' | 'active_task' | 'social_model'
  // Relationship/psych-engine output (trust, attraction, attachment,
  // vulnerability, heartbreak/healing/closure, etc. — the S1-S21 family in
  // route.ts). Kept distinct from social_model/theory_of_mind, which model
  // *beliefs about* the user/character, because these candidates are the
  // relationship engines' own regulatory/safety content and deliberately
  // carry a different default alignment weight (see SOURCE_BASE_ALIGNMENT)
  // rather than being scored against the drive-alignment logic tuned for
  // cognitive/memory content.
  | 'relationship_signal';

export interface AttentionCandidate {
  id:         string;
  source:     AttentionSource;
  /** the actual prompt-ready text this candidate would contribute if selected */
  content:    string;
  /** 0-100 — inherent importance regardless of this turn's specifics */
  importance: number;
  /** 0-100 — how urgent/timely this is right now (an unresolved rupture beats a stable fact) */
  urgency:    number;
  /** turns/hours since this was last surfaced — used to avoid the same thing dominating every turn */
  staleness:  number;
  /** rough cost in the shared attention budget (e.g. estimated tokens) */
  cost:       number;
  /**
   * When true, this candidate is always injected regardless of budget —
   * for content whose absence is itself a safety risk (e.g. emotional-
   * safety-engine.ts's hard ceiling on romantic pull, or an active
   * unresolved rupture). Exempt candidates still have their cost deducted
   * from the shared budget so they aren't "free" — they just can't be
   * starved out by lower-priority color content the way an ordinary
   * candidate can.
   */
  exempt?: boolean;
}

export interface AttentionBudget {
  total: number; // total budget units available this turn
}

export interface RoutedAttention {
  selected:   AttentionCandidate[];
  excluded:   AttentionCandidate[];
  usedBudget: number;
  totalBudget: number;
}

// Some sources are inherently more load-bearing than others when it comes
// to *coherence* (self-model, active task) versus *color* (memory,
// drive_impulse) — this nudges alignment without hard-coding a fixed slot
// per source, so a genuinely irrelevant self-model fact can still lose out
// to an urgent memory if the scores actually call for it.
const SOURCE_BASE_ALIGNMENT: Record<AttentionSource, number> = {
  self_model:      65,
  active_task:     60,
  // Alongside active_task in load-bearing-for-coherence terms — the
  // goal that's actually driving this turn shouldn't lose out to color
  // context by default any more than the task it spawned does.
  selected_goal:   60,
  theory_of_mind:  55,
  social_model:    50,
  drive_impulse:   50,
  memory:          45,
  user_fact:       45,
  // Deliberately between theory_of_mind/social_model and memory/user_fact:
  // this content is more load-bearing than plain color (it can gate what's
  // safe to say) but isn't identity/task-coherence content either.
  relationship_signal: 50,
};

function driveAdjustedAlignment(source: AttentionSource, drives?: DriveState): number {
  const base = SOURCE_BASE_ALIGNMENT[source];
  if (!drives) return base;

  // A dominant curiosity/attachment drive slightly favors memory/theory-of-mind
  // content (things to be curious/attached about); a dominant security drive
  // favors theory-of-mind/social-model content (risk-relevant context).
  if ((drives.dominant.drive === 'curiosity' || drives.dominant.drive === 'attachment') && (source === 'memory' || source === 'theory_of_mind')) {
    return Math.min(100, base + 15);
  }
  if (drives.dominant.drive === 'security' && (source === 'theory_of_mind' || source === 'social_model')) {
    return Math.min(100, base + 15);
  }
  return base;
}

const ATTENTION_WEIGHTS: PriorityWeights = {
  importance: 0.35,
  urgency:    0.3,
  alignment:  0.2,
  freshnessBias: 0.15,
};

// ── Routing ─────────────────────────────────────────────────────────────

/**
 * Select which candidates fit within the budget this turn, in priority
 * order. `drives` is optional context used only to lightly bias alignment
 * — omit it and routing still works, just without drive-awareness.
 */
export function routeAttention(
  candidates: AttentionCandidate[],
  budget: AttentionBudget,
  drives?: DriveState,
): RoutedAttention {
  // Exempt candidates (safety-critical: emotional-safety-engine.ts's
  // ceiling, an active unresolved rupture, etc.) always make it in. Their
  // cost still comes out of the shared budget first — they aren't free,
  // they just can't be crowded out — so everything else genuinely competes
  // for whatever's left, which may be less than `budget.total` or even
  // (rarely) negative if exempt content alone exceeds it.
  const exempt = candidates.filter(c => c.exempt);
  const contested = candidates.filter(c => !c.exempt);
  const exemptCost = exempt.reduce((sum, c) => sum + c.cost, 0);
  const remainingBudget = Math.max(0, budget.total - exemptCost);

  const withAlignment = contested.map(c => ({
    id: c.id,
    importance: c.importance,
    urgency: c.urgency,
    alignment: driveAdjustedAlignment(c.source, drives),
    staleness: c.staleness,
    cost: c.cost,
  }));

  const selectedIds = new Set(fillBudget(withAlignment, remainingBudget, ATTENTION_WEIGHTS));

  const selected = candidates.filter(c => c.exempt || selectedIds.has(c.id));
  const excluded = candidates.filter(c => !c.exempt && !selectedIds.has(c.id));
  const usedBudget = selected.reduce((sum, c) => sum + c.cost, 0);

  return { selected, excluded, usedBudget, totalBudget: budget.total };
}

// ── Prompt assembly ─────────────────────────────────────────────────────

/**
 * Join the selected candidates' content in a stable, source-grouped order
 * (identity/task context first, situational color last) rather than
 * priority-score order, which would otherwise interleave unrelated
 * sections unpredictably turn to turn.
 */
const SOURCE_ORDER: AttentionSource[] = [
  'self_model', 'active_task', 'selected_goal', 'theory_of_mind', 'social_model',
  'drive_impulse', 'memory', 'user_fact', 'relationship_signal',
];

export function assembleRoutedPrompt(routed: RoutedAttention): string {
  const bySource = new Map<AttentionSource, string[]>();
  for (const c of routed.selected) {
    const list = bySource.get(c.source) ?? [];
    list.push(c.content);
    bySource.set(c.source, list);
  }

  const sections: string[] = [];
  for (const source of SOURCE_ORDER) {
    const items = bySource.get(source);
    if (items?.length) sections.push(items.join('\n'));
  }

  return sections.join('\n\n');
}
