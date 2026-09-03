/**
 * Salience Engine — Vantrix
 *
 * attention-router.ts already does the hard part — ranking and budget-
 * filling a list of AttentionCandidate[] — but nothing upstream of it ever
 * actually produced that list from real data. executive-controller.ts's
 * live wiring in chat/stream/route.ts says so explicitly:
 *
 *   "attentionCandidates is deliberately empty for now: memory-graph.ts's
 *   [...] goalRecency is likewise [] — nothing in goal-engine.ts currently
 *   tracks turns-since-last-advanced per goal [...]"
 *
 * This module is that missing producer for the attention side of the gap
 * (focus-stack.ts covers the goalRecency side). It takes the actual typed
 * outputs several engines already compute this turn — memory nodes,
 * user facts, the theory-of-mind snapshot, the active task, the drive
 * state — and reduces each into scored AttentionCandidate[] entries,
 * without re-deriving anything those engines already know. Nothing here
 * talks to Supabase or Redis directly; it is a pure scoring layer, same
 * design stance as priority-engine.ts and attention-router.ts itself.
 *
 * "Salience" here means: independent of whether this turn's budget can
 * afford it, how much does this thing deserve to compete for attention at
 * all. attention-router.ts (via priority-engine.ts's fillBudget) is what
 * turns salience into an actual inclusion/exclusion decision under budget
 * — this module stops at producing well-scored candidates, deliberately
 * not deciding the cutoff itself.
 */

import type { MemoryNode } from '@/lib/ai/memory-graph';
import type { UserFact } from '@/lib/ai/user-fact-graph';
import type { TheoryOfMindSnapshot } from '@/lib/ai/theory-of-mind';
import type { ConversationalTask } from '@/lib/ai/task-manager';
import type { SelectedGoal } from '@/lib/ai/goal-selector';
import type { DriveState } from '@/lib/ai/drive-engine';
import type { AttentionCandidate } from '@/lib/ai/attention-router';

// ── Config ──────────────────────────────────────────────────────────────

// Rough token-cost heuristic: ~4 chars/token, plus a fixed per-item
// overhead for the section framing each caller wraps content in. Good
// enough for budget-fitting purposes — attention-router.ts's budget units
// don't need to be exact, just consistently comparable across sources.
function estimateCost(text: string): number {
  return Math.max(8, Math.round(text.length / 4) + 6);
}

const FACT_CATEGORY_IMPORTANCE: Record<UserFact['category'], number> = {
  pain_point:   90,
  family:       80,
  relationship: 78,
  aspiration:   70,
  belief:       62,
  work:         55,
  location:     45,
  hobby:        40,
  preference:   35,
  trait:        30,
};

function hoursAgo(iso: string | null): number {
  if (!iso) return 999; // never used — treat as maximally stale/fresh-eligible, not zero
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

// ── Per-source scorers ──────────────────────────────────────────────────

/**
 * Memories are already pre-ranked by memory-graph.ts's own emotional_weight,
 * but that weight alone doesn't capture recency or repetition — a
 * high-weight memory surfaced every single turn stops being salient in
 * the sense this module cares about (worth spending budget on *right
 * now*), even though it's still important in the abstract.
 */
export function scoreMemoryCandidates(memories: MemoryNode[]): AttentionCandidate[] {
  return memories.map((m) => {
    const daysAgo = (Date.now() - new Date(m.created_at).getTime()) / 86_400_000;
    const content = `- (${m.event_type}) ${m.title}: ${m.description}`;
    return {
      id: `memory:${m.id}`,
      source: 'memory' as const,
      content,
      importance: Math.round((m.emotional_weight / 10) * 100),
      // A memory from today or yesterday is more urgent to reference than
      // one from months ago, independent of how emotionally weighty it
      // was — a fresh deep_talk beats a heavier but long-settled one for
      // "worth bringing up this turn" purposes.
      urgency: Math.round(Math.max(0, 100 - daysAgo * 6)),
      staleness: Math.min(100, daysAgo), // priority-engine.ts's freshnessScore caps at staleness=12.5+, this just needs a monotonic proxy
      cost: estimateCost(content),
    };
  });
}

/**
 * Facts don't decay the way memories do (a fact about someone's job
 * doesn't get less true), but lastUsed matters: a fact injected every
 * turn regardless of relevance is exactly the "everything gets said"
 * failure mode this whole layer exists to prevent.
 */
export function scoreFactCandidates(facts: UserFact[]): AttentionCandidate[] {
  return facts.map((f) => {
    const content = `- ${f.key}: ${f.value}`;
    const baseImportance = FACT_CATEGORY_IMPORTANCE[f.category] ?? 40;
    return {
      id: `user_fact:${f.id}`,
      source: 'user_fact' as const,
      content,
      importance: Math.round(baseImportance * Math.max(0.4, f.confidence)),
      // Facts are rarely time-sensitive on their own; urgency here mostly
      // tracks confidence — a low-confidence heuristic guess shouldn't
      // compete as hard for budget as an AI-confirmed fact.
      urgency: Math.round(30 + f.confidence * 30),
      staleness: Math.min(100, hoursAgo(f.lastUsed) / 4), // hours→staleness units, roughly comparable scale to memory's days-based one
      cost: estimateCost(content),
    };
  });
}

/**
 * theory-of-mind.ts already assembled one combined promptBlock, but that
 * block bundles trust/deception/misunderstanding signals together as an
 * all-or-nothing unit today. Splitting it into deceptions vs. misreads
 * lets attention-router.ts actually trade one off against other context
 * under budget instead of the whole ToM block winning or losing as a
 * block — an unresolved deception is usually far more turn-relevant than
 * a low-stakes misread, and they shouldn't have to share one score.
 */
export function scoreTheoryOfMindCandidates(tom: TheoryOfMindSnapshot): AttentionCandidate[] {
  const candidates: AttentionCandidate[] = [];

  for (const d of tom.deceptions) {
    const content = `- She told an unresolved untruth: ${d.content}`;
    candidates.push({
      id: `tom_deception:${d.claimId.slice(0, 40)}`,
      source: 'theory_of_mind',
      content,
      importance: 80,
      // Deceptions get more urgent the longer they sit unresolved — a
      // lie that's about to be caught out matters more than one that's
      // comfortably settled into the backstory.
      urgency: 75,
      staleness: 20,
      cost: estimateCost(content),
    });
  }

  for (const m of tom.misreads) {
    const content = `- A stale belief worth quietly correcting: ${m.description}`;
    candidates.push({
      id: `tom_misread:${m.beliefId.slice(0, 40)}`,
      source: 'theory_of_mind',
      content,
      importance: 55,
      urgency: 40,
      staleness: 30,
      cost: estimateCost(content),
    });
  }

  if (tom.trustScore < 40) {
    const content = `- Trust is currently low (${tom.trustScore}/100) — tread carefully, don't presume closeness that hasn't been earned yet.`;
    candidates.push({
      id: 'tom_trust_low',
      source: 'theory_of_mind',
      content,
      importance: 85,
      urgency: 70,
      staleness: 0,
      cost: estimateCost(content),
    });
  }

  return candidates;
}

/** The active task and selected goal are single items, not lists — wrapped for uniformity with the other scorers. */
export function scoreTaskAndGoalCandidates(
  activeTask: ConversationalTask | null,
  selectedGoal: SelectedGoal | null,
): AttentionCandidate[] {
  const candidates: AttentionCandidate[] = [];

  if (activeTask) {
    const content = `${activeTask.label}`;
    candidates.push({
      id: `active_task:${activeTask.id}`,
      source: 'active_task',
      content,
      importance: 75,
      // Urgency climbs with attempts — a task that's been skipped a
      // couple of times deserves more weight this turn, not less,
      // otherwise it just keeps losing to fresher candidates forever.
      urgency: Math.min(95, 55 + activeTask.attempts * 15),
      staleness: activeTask.lastAttemptAt ? hoursAgo(new Date(activeTask.lastAttemptAt).toISOString()) : 50,
      cost: estimateCost(content),
    });
  }

  if (selectedGoal) {
    const content = `${selectedGoal.goal.label}`;
    candidates.push({
      id: `selected_goal:${selectedGoal.goal.id}`,
      source: 'selected_goal',
      content,
      importance: Math.round(selectedGoal.score * 0.9),
      urgency: 50,
      staleness: 10,
      cost: estimateCost(content),
    });
  }

  return candidates;
}

/**
 * The dominant drive's impulse text, if any — drive-engine.ts already
 * computes this, this just reduces it to the same candidate shape so it
 * competes fairly for budget instead of always being force-included via
 * formatDriveStateForPrompt (which executive-controller.ts calls
 * separately and unconditionally today).
 */
export function scoreDriveCandidate(drives: DriveState): AttentionCandidate[] {
  if (!drives.dominant.impulse || drives.dominant.effectiveLevel < 35) return [];
  const content = `- (${drives.dominant.drive}, ${drives.dominant.effectiveLevel}/100) ${drives.dominant.impulse}`;
  return [{
    id: `drive_impulse:${drives.dominant.drive}`,
    source: 'drive_impulse',
    content,
    importance: Math.round(drives.dominant.effectiveLevel * 0.7),
    urgency: Math.round(drives.dominant.effectiveLevel),
    staleness: 15,
    cost: estimateCost(content),
  }];
}

// ── Composition ─────────────────────────────────────────────────────────

export interface SalienceInput {
  memories:      MemoryNode[];
  facts:         UserFact[];
  theoryOfMind:  TheoryOfMindSnapshot | null;
  activeTask:    ConversationalTask | null;
  selectedGoal:  SelectedGoal | null;
  drives:        DriveState;
}

/**
 * Reduce every available signal source into one flat AttentionCandidate[]
 * ready for attention-router.ts. This is the function executive-controller.ts
 * (via attention-engine.ts) should call to fill the attentionCandidates
 * field that's currently hardcoded to [].
 */
export function computeSalientCandidates(input: SalienceInput): AttentionCandidate[] {
  return [
    ...scoreMemoryCandidates(input.memories),
    ...scoreFactCandidates(input.facts),
    ...(input.theoryOfMind ? scoreTheoryOfMindCandidates(input.theoryOfMind) : []),
    ...scoreTaskAndGoalCandidates(input.activeTask, input.selectedGoal),
    ...scoreDriveCandidate(input.drives),
  ];
}
