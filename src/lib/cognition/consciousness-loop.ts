/**
 * Consciousness Loop — Vantrix Cognition Layer
 *
 * The one place that actually advances the cognition layer turn over
 * turn. Everything else in this directory is a component (working
 * memory, attention scoring, executive decision); this module is the
 * cycle that calls them in order and is the only thing route.ts /
 * orchestrator.ts need to import to get the full effect:
 *
 *   1. attend()   — attention-engine.ts scores this turn's signals,
 *                    decays last turn's working memory, writes what's
 *                    salient enough to survive.
 *   2. decide()    — executive-controller.ts (this directory) runs
 *                    ai/executive-controller.ts's full pipeline and
 *                    folds in whatever's still live in working memory.
 *   3. (caller)    — response-planner.ts / decision-engine.ts consume
 *                    the CognitiveDecision to actually generate a reply.
 *                    Deliberately NOT called from here — this module
 *                    stays about *orienting*, not *speaking*, matching
 *                    ai/executive-controller.ts's own boundary.
 *   4. resolve()   — after the reply is generated/sent, the caller
 *                    reports back anything worth writing into working
 *                    memory as a result (a new commitment made, a task
 *                    completed) so the next tick() sees it.
 *
 * This is deliberately a thin sequencing shim, not a new engine — the
 * actual cognitive work all happens in the modules it calls.
 */

import { logger } from '@/lib/logger';
import { attend, type AttentionSignal, type AttentionResult } from '@/lib/cognition/attention-engine';
import {
  runCognitiveController,
  type CognitiveInput,
  type CognitiveDecision,
} from '@/lib/cognition/executive-controller';
import { commit, type WorkingMemoryKind } from '@/lib/cognition/working-memory';

export interface ConsciousnessCycleInput {
  userId: string;
  characterId: string;
  /** Signals worth judging for admission into working memory this turn
   *  — e.g. a moderation flag, a newly-made commitment, a dangling
   *  question the user just asked. Can be empty on a quiet turn. */
  signals: AttentionSignal[];
  /** Everything ai/executive-controller.ts needs to run its pipeline. */
  cognitive: CognitiveInput;
}

export interface ConsciousnessCycleResult {
  attention: AttentionResult;
  decision: CognitiveDecision;
}

/**
 * Run one full perceive → attend → decide cycle. Safe to call once per
 * inbound user message, before response generation.
 */
export async function runConsciousnessCycle(
  input: ConsciousnessCycleInput,
): Promise<ConsciousnessCycleResult> {
  const attention = attend(input.userId, input.characterId, input.signals);

  const decision = await runCognitiveController({
    ...input.cognitive,
    workingMemoryOverride: undefined, // let the controller re-peek post-attend state
  });

  logger.debug('[consciousness-loop] cycle complete', {
    userId: input.userId,
    characterId: input.characterId,
    admitted: attention.admitted.length,
    dropped: attention.dropped.length,
    carriedForward: decision.carriedForward.length,
    activeWatchFlags: decision.activeWatchFlags.length,
  });

  return { attention, decision };
}

export interface ResolutionNote {
  id: string;
  kind: WorkingMemoryKind;
  summary: string;
  /** 0–1. Use a low value (or just call forget() via working-memory.ts
   *  directly) for something that's now fully resolved and shouldn't
   *  linger even briefly. */
  activation: number;
  data?: Record<string, unknown>;
}

/**
 * After a reply has actually been generated and sent, report back
 * anything that should persist into the next turn's working memory —
 * a promise the character just made, a task marked in-progress, a
 * thread that got resolved (commit with low activation, or call
 * forget() directly from working-memory.ts). Optional: a quiet turn
 * with nothing new to carry forward can skip this entirely.
 */
export function resolveCycle(
  userId: string,
  characterId: string,
  notes: ResolutionNote[],
): void {
  for (const note of notes) {
    commit(userId, characterId, {
      id: note.id,
      kind: note.kind,
      summary: note.summary,
      activation: note.activation,
      data: note.data,
    });
  }
}
