/**
 * Executive Controller (Cognition Layer) — Vantrix
 *
 * ai/executive-controller.ts already runs the full "choose before speak"
 * pipeline (drives → goal → task → attention-router → confidence /
 * uncertainty) for a single turn, in isolation. What it doesn't do is
 * know about anything outside that turn — it has no view of what's
 * still active in working-memory.ts from a few turns back (an unresolved
 * open thread, a commitment she made, a watch_flag from moderation).
 *
 * This module is the thin layer that closes that gap: it calls the ai/
 * executive controller for the turn's fresh decision, folds in whatever
 * is still live in working memory, and produces one CognitiveDecision —
 * the thing consciousness-loop.ts actually hands downstream to response
 * planning. It does not re-implement any of the drive/goal/task/attention
 * logic itself; it is purely a composition + carry-forward layer.
 */

import { logger } from '@/lib/logger';
import {
  runExecutiveController,
  type ExecutiveInput,
  type ExecutiveDecision,
} from '@/lib/ai/executive-controller';
import { peek, formatWorkingMemoryItemsForPrompt, type WorkingMemoryItem } from '@/lib/cognition/working-memory';

export interface CognitiveInput extends ExecutiveInput {
  /** Optional override — if a caller already fetched working-memory
   *  items this turn (e.g. attention-engine.ts's `attend()` result),
   *  pass them through instead of re-peeking the store. */
  workingMemoryOverride?: WorkingMemoryItem[];
}

export interface CognitiveDecision {
  executive: ExecutiveDecision;
  /** Unresolved items carried in from prior turns, most salient first. */
  carriedForward: WorkingMemoryItem[];
  /** Any watch_flag items still live — surfaced separately so callers
   *  that gate on safety (e.g. reply-guard, moderation) don't have to
   *  filter carriedForward themselves. */
  activeWatchFlags: WorkingMemoryItem[];
  /** Combined prompt block: the turn's fresh executive summary plus
   *  whatever's still live in working memory. */
  promptBlock: string;
}

export async function runCognitiveController(input: CognitiveInput): Promise<CognitiveDecision> {
  const executive = await runExecutiveController(input);

  const carriedForward = input.workingMemoryOverride
    ?? peek(input.userId, input.characterId);

  const activeWatchFlags = carriedForward.filter(i => i.kind === 'watch_flag');

  if (activeWatchFlags.length > 0) {
    logger.info('[cognition/executive-controller] active watch flags carried into turn', {
      userId: input.userId,
      characterId: input.characterId,
      count: activeWatchFlags.length,
    });
  }

  const carriedBlock = formatWorkingMemoryItemsForPrompt(carriedForward);
  const promptBlock = [executive.promptBlock, carriedBlock].filter(Boolean).join('\n\n');

  return { executive, carriedForward, activeWatchFlags, promptBlock };
}
