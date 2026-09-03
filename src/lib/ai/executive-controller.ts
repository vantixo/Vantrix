/**
 * Executive Controller — Vantrix
 *
 * "Choose before Speak."
 *
 * Every prior engine in this directory either decides *how* to say
 * something (writing-style.ts, conversational-technique.ts) or *what tone*
 * to take (decision-engine.ts's Intent). Nothing sat above all of it
 * deciding, first: given everything pulling at her right now (drives),
 * which goal actually matters this turn, what concrete task that implies,
 * and — critically — what limited slice of all the available context is
 * even worth attending to. This module is that executive layer, run once
 * per turn, before response-planner.ts or decision-engine.ts do their
 * work:
 *
 *   1. drive-engine.ts        → what's pulling at her (curiosity, attachment, status, security, novelty)
 *   2. goal-selector.ts       → which active goal wins given that pull
 *   3. task-manager.ts        → what concrete, trackable action that implies this turn
 *   4. attention-router.ts    → given a real budget, what context is worth attending to
 *   5. confidence-engine.ts / uncertainty-engine.ts → how sure she should
 *      act like she is about her own read this turn, per domain, and
 *      whether that should visibly change how she talks (added — see
 *      those files' headers for why this lives as a distinct layer
 *      rather than folded into drives or attention)
 *
 * Output is one ExecutiveDecision — response-planner.ts / decision-engine.ts
 * should treat this as upstream context (what she's oriented toward),
 * not as something that dictates the actual words.
 *
 * ATTENTION-WIRING FIX: goalRecency and attentionCandidates used to be
 * plain caller-supplied arrays, and the one live call site (chat/stream/
 * route.ts) passed [] for both with an inline comment explaining nothing
 * upstream produced them yet. focus-stack.ts (goal recency) and
 * salience-engine.ts (attention candidates) are that missing producer.
 * Both inputs below are now optional:
 *   - `goalRecency`, if omitted, is derived from focus-stack.ts — a
 *     Redis-backed, per-(user,character) counter of turns-since-goal-
 *     last-selected. Not to be confused with cognition/working-memory.ts,
 *     which tracks a different, broader kind of cross-turn state (see
 *     focus-stack.ts's own header for the exact boundary).
 *   - `salience`, if provided, is scored via salience-engine.ts and
 *     merged with any caller-supplied `attentionCandidates` (which stays
 *     supported so a caller with its own candidate sources isn't forced
 *     to route everything through salience-engine.ts).
 * A caller that supplies neither still works exactly as before —
 * attentionCandidates defaults to [] and goalRecency to focus-stack's
 * (possibly empty, for a first-ever turn) derivation. What actually won
 * attention/selection each turn is recorded back onto focus-stack.ts
 * (fire-and-forget) so the next turn's recency signal reflects it.
 */

import { logger } from '@/lib/logger';

import { computeDriveState, formatDriveStateForPrompt, type DriveEngineSignals, type DriveState } from '@/lib/ai/drive-engine';
import { selectGoal, formatSelectedGoalForPrompt, type SelectedGoal, type GoalRecency } from '@/lib/ai/goal-selector';
import {
  ensureTaskForGoal, nextActionableTask, recordAttempt, formatTaskForPrompt,
  type ConversationalTask, type TaskQueue,
} from '@/lib/ai/task-manager';
import { routeAttention, assembleRoutedPrompt, type AttentionCandidate, type RoutedAttention } from '@/lib/ai/attention-router';
import { computeSalientCandidates, type SalienceInput } from '@/lib/ai/salience-engine';
import { getFocusStack, deriveGoalRecency, recordFocusTurn } from '@/lib/ai/focus-stack';
import type { Goal } from '@/lib/ai/decision-engine';
import { computeConfidenceState, type ConfidenceState } from '@/lib/ai/confidence-engine';
import { computeUncertaintyState, type UncertaintyState } from '@/lib/ai/uncertainty-engine';
import type { EmotionalState } from '@/lib/ai/emotion-engine';
import type { RelationshipState } from '@/lib/ai/relationship-engine';
import type { MemoryNode } from '@/lib/ai/memory-graph';
import type { QuestionAndAirtimeSignals } from '@/lib/ai/conversation-thread-tracker';

// ── Types ───────────────────────────────────────────────────────────────

export interface ExecutiveInput {
  userId:      string;
  characterId: string;
  goals:       Goal[];
  /** Optional — omit to have focus-stack.ts derive it instead. */
  goalRecency?: GoalRecency[];
  driveSignals: DriveEngineSignals;
  /** Optional — merged with `salience`-derived candidates, if provided. Defaults to []. */
  attentionCandidates?: AttentionCandidate[];
  /**
   * Optional — real per-turn signals (memories, facts, theory-of-mind)
   * to score via salience-engine.ts. Omit if the caller doesn't have
   * these assembled yet; attentionCandidates/[] is used as-is in that
   * case, same behavior as before this field existed.
   */
  salience?: Omit<SalienceInput, 'activeTask' | 'selectedGoal' | 'drives'>;
  attentionBudget: number;
  /**
   * confidence-engine.ts's inputs. Deliberately its own bundle rather
   * than reusing driveSignals' shape — drives and epistemic confidence
   * answer different questions (see confidence-engine.ts's header) and
   * conflating their inputs would make it too easy to accidentally feed
   * one engine's number to the other. hoursSinceLastInteraction is
   * deliberately NOT duplicated here — reused below from
   * driveSignals.attachment.hoursSinceLastInteraction, since route.ts
   * already computes it once (hoursSinceLastMsgForDrives) and it means
   * the same thing in both places.
   */
  emotion:           EmotionalState;
  relationship:      RelationshipState;
  threadSignals:     QuestionAndAirtimeSignals;
  surfacedMemories:  MemoryNode[];
  totalInteractions: number;
  daysKnown:         number;
}

export interface ExecutiveDecision {
  drives:        DriveState;
  selectedGoal:  SelectedGoal | null;
  taskQueue:     TaskQueue;
  activeTask:    ConversationalTask | null;
  attention:     RoutedAttention;
  confidence:    ConfidenceState;
  uncertainty:   UncertaintyState;
  promptBlock:   string;
}

// ── Orchestration ────────────────────────────────────────────────────────

/**
 * Run the full choose-before-speak pipeline for a turn. Cheap and mostly
 * synchronous except for task-manager.ts's Redis round-trip; safe to
 * always run before response planning.
 */
export async function runExecutiveController(input: ExecutiveInput): Promise<ExecutiveDecision> {
  // confidence-engine.ts / uncertainty-engine.ts are pure, synchronous
  // arithmetic over inputs the caller already computed this turn (no
  // Redis, no network) — same "can't meaningfully fail" category as
  // computeDriveState below, so these run unconditionally rather than
  // inside the try/catch: there's no fallback state for them that would
  // mean anything different from just running them again in the catch
  // block, and duplicating that call would only risk the two branches
  // drifting apart.
  const confidence = computeConfidenceState({
    emotion:                   input.emotion,
    relationship:              input.relationship,
    threadSignals:             input.threadSignals,
    surfacedMemories:          input.surfacedMemories,
    totalInteractions:         input.totalInteractions,
    daysKnown:                 input.daysKnown,
    hoursSinceLastInteraction: input.driveSignals.attachment.hoursSinceLastInteraction,
  });
  const uncertainty = computeUncertaintyState(confidence);

  try {
    const drives = computeDriveState(input.driveSignals);

    // Goal recency: prefer an explicit caller value (back-compat); fall
    // back to focus-stack.ts's derivation otherwise. getFocusStack() and
    // deriveGoalRecency() never throw (see focus-stack.ts) — a first-ever
    // turn for a relationship legitimately has no stack yet and just
    // derives an empty recency list, same as before this wiring existed.
    const goalRecency = input.goalRecency
      ?? deriveGoalRecency(await getFocusStack(input.userId, input.characterId), input.goals.map(g => g.id));

    const selectedGoal = selectGoal(input.goals, drives, goalRecency);

    const taskQueue = await ensureTaskForGoal(input.userId, input.characterId, selectedGoal);
    const activeTask = nextActionableTask(taskQueue);

    // Attention candidates: caller-supplied list, plus whatever
    // salience-engine.ts derives from real signals if the caller provided
    // them. Merged before routing so the two sources compete fairly for
    // budget together, in one pass — computeSalientCandidates is pure/
    // synchronous, no additional failure surface.
    const salienceCandidates = input.salience
      ? computeSalientCandidates({ ...input.salience, activeTask, selectedGoal, drives })
      : [];
    const mergedCandidates = [...(input.attentionCandidates ?? []), ...salienceCandidates];

    const attention = routeAttention(mergedCandidates, { total: input.attentionBudget }, drives);

    // Record what won onto focus-stack.ts so next turn's goalRecency
    // reflects it. Fire-and-forget: recordFocusTurn already fails open
    // internally (see focus-stack.ts), and the function stays alive
    // through the rest of this turn's response generation, so there's no
    // risk of the process exiting before this settles.
    recordFocusTurn(input.userId, input.characterId, selectedGoal?.goal.id ?? null, attention).catch((err) => {
      logger.warn('[executive-controller] recordFocusTurn failed', {
        userId: input.userId, characterId: input.characterId, error: String(err),
      });
    });

    const promptBlock = formatExecutiveDecisionForPrompt({
      drives, selectedGoal, taskQueue, activeTask, attention, confidence, uncertainty,
    });

    return { drives, selectedGoal, taskQueue, activeTask, attention, confidence, uncertainty, promptBlock };
  } catch (err) {
    logger.warn('[executive-controller] pipeline failed, falling back to attention-only', {
      userId: input.userId, characterId: input.characterId, error: String(err),
    });
    // Fail safe: attention routing alone (no goal/drive layer) is still
    // far better than injecting everything unfiltered, and doesn't
    // depend on anything that could itself have failed above (Redis).
    // confidence/uncertainty already succeeded above (they can't have
    // caused this catch — see comment above), so they're carried through
    // unchanged rather than dropped; a turn where task-manager.ts's Redis
    // call fails is not a turn where her read on the conversation itself
    // became any less known.
    const fallbackDrives = computeDriveState(input.driveSignals);
    const attention = routeAttention(input.attentionCandidates ?? [], { total: input.attentionBudget }, fallbackDrives);
    const fallbackPromptBlock = [assembleRoutedPrompt(attention), uncertainty.promptBlock].filter(Boolean).join('\n\n');
    return {
      drives: fallbackDrives,
      selectedGoal: null,
      taskQueue: { tasks: [], updatedAt: Date.now() },
      activeTask: null,
      attention,
      confidence,
      uncertainty,
      promptBlock: fallbackPromptBlock,
    };
  }
}

// Re-exported so callers only need to import this file for the full
// turn lifecycle: run the pipeline, then report back what happened with
// the active task once the response is actually generated.
export { completeTask } from '@/lib/ai/task-manager';

/** Call if the active task didn't get a natural opening this turn — tracks attempts, drops it after enough misses. */
export async function recordTaskOutcomeNotYet(userId: string, characterId: string, taskId: string): Promise<TaskQueue> {
  return recordAttempt(userId, characterId, taskId);
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatExecutiveDecisionForPrompt(decision: Omit<ExecutiveDecision, 'promptBlock'>): string {
  const sections: string[] = [];

  const driveBlock = formatDriveStateForPrompt(decision.drives);
  if (driveBlock) sections.push(driveBlock);

  const goalBlock = formatSelectedGoalForPrompt(decision.selectedGoal);
  if (goalBlock) sections.push(goalBlock);

  const taskBlock = formatTaskForPrompt(decision.activeTask);
  if (taskBlock) sections.push(taskBlock);

  const attentionBlock = assembleRoutedPrompt(decision.attention);
  if (attentionBlock) sections.push(attentionBlock);

  // confidence.overall is deliberately never injected as a raw number —
  // see uncertainty-engine.ts's header on why that's not a line she'd
  // say. Only its already-converted, per-domain hedge guidance goes in.
  if (decision.uncertainty.promptBlock) sections.push(decision.uncertainty.promptBlock);

  return sections.join('\n\n');
}
