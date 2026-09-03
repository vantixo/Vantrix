/**
 * Theory of Mind — Vantrix Cognition Layer
 *
 * emotion-engine.ts, confidence-engine.ts, and relationship-engine.ts all
 * describe *her* state — what she's feeling, how sure she is, where the
 * relationship stands. None of them model the user as a separate mind
 * with their own beliefs, which is a different thing than her emotional
 * reaction to the user. Two people can be in the same conversation with
 * completely different pictures of what's going on — the user thinks a
 * topic from three days ago is resolved, she still has it flagged as an
 * open_thread; the user believes she remembers something that was never
 * actually surfaced this session. This module tracks that gap explicitly:
 * a small model of what the user currently seems to believe/want/expect,
 * checked against what's actually true in working-memory.ts and
 * relationship-engine.ts, so mismatches can be caught before they turn
 * into her confidently saying something the user's model disagrees with.
 *
 * Like reasoning-engine.ts, this is not a free-text inference layer — it
 * takes structured `MindSignal`s that callers derive from the turn (a
 * detected assumption in the user's message, an explicit statement of
 * want) and reconciles them against ground truth the codebase already
 * tracks. It doesn't do the NLP itself.
 */

import { logger } from '@/lib/logger';
import type { WorkingMemoryItem } from '@/lib/cognition/working-memory';

// ── Types ───────────────────────────────────────────────────────────────

export type MindSignalKind =
  | 'assumed_known'     // user is talking as if she already knows something
  | 'assumed_resolved'  // user is treating an open thread/commitment as settled
  | 'stated_want'        // user explicitly said what they want from her right now
  | 'stated_belief';      // user explicitly stated what they think is true

export interface MindSignal {
  id: string;
  kind: MindSignalKind;
  /** What the user's message implies, in short prompt-ready form. */
  content: string;
  /** id of the working-memory item / fact this signal is about, if any —
   *  used to check the assumption against what's actually tracked. */
  referentId?: string;
  confidence: number; // 0-1, how clearly the message signals this
}

export interface UserModel {
  userId: string;
  characterId: string;
  turn: number;
  /** Current best guess at what the user believes/wants, most recent
   *  per referent (a later signal about the same referent replaces the
   *  earlier one — models get corrected, not accumulated). */
  beliefs: MindSignal[];
}

export interface Mismatch {
  signal: MindSignal;
  /** Why this doesn't line up with tracked ground truth. */
  reason: string;
  /** How much this matters — an assumed_resolved mismatch on a
   *  commitment matters more than one on a throwaway open_thread. */
  severity: number; // 0-1
}

export interface ReconcileResult {
  model: UserModel;
  mismatches: Mismatch[];
  promptBlock: string;
}

const store = new Map<string, UserModel>();

function key(userId: string, characterId: string): string {
  return `${userId}::${characterId}`;
}

// ── Reads ───────────────────────────────────────────────────────────────

export function getUserModel(userId: string, characterId: string): UserModel {
  const k = key(userId, characterId);
  let model = store.get(k);
  if (!model) {
    model = { userId, characterId, turn: 0, beliefs: [] };
    store.set(k, model);
  }
  return model;
}

// ── Core ────────────────────────────────────────────────────────────────

/**
 * Fold this turn's signals into the running user model, then check any
 * assumed_known / assumed_resolved signals against what's actually still
 * live in working memory. Returns the mismatches worth reacting to —
 * callers decide what to do with them (gently correct, ask a clarifying
 * question, or just avoid confidently contradicting the user outright).
 */
export function reconcile(
  userId: string,
  characterId: string,
  signals: MindSignal[],
  workingMemory: WorkingMemoryItem[],
  turn: number,
): ReconcileResult {
  const model = getUserModel(userId, characterId);
  model.turn = turn;

  for (const signal of signals) {
    const idx = signal.referentId
      ? model.beliefs.findIndex(b => b.referentId === signal.referentId)
      : -1;
    if (idx >= 0) model.beliefs[idx] = signal;
    else model.beliefs.push(signal);
  }

  const mismatches: Mismatch[] = [];

  for (const signal of signals) {
    if (!signal.referentId) continue;
    const referent = workingMemory.find(i => i.id === signal.referentId);

    if (signal.kind === 'assumed_resolved' && referent) {
      // Still live in working memory, but the user is treating it as
      // done — that's the mismatch worth flagging.
      mismatches.push({
        signal,
        reason: `user seems to think "${referent.summary}" is resolved, but it's still open`,
        severity: referent.kind === 'commitment' ? 0.8 : 0.4,
      });
    }

    if (signal.kind === 'assumed_known' && !referent) {
      // User is talking as if she already knows something that isn't
      // (or is no longer) in working memory — she may need to ask
      // rather than bluff familiarity.
      mismatches.push({
        signal,
        reason: `user assumes she already knows this; nothing matching is currently in mind`,
        severity: 0.5,
      });
    }
  }

  if (mismatches.length > 0) {
    logger.debug('[cognition/theory-of-mind] belief mismatches this turn', {
      userId, characterId, count: mismatches.length,
    });
  }

  return { model, mismatches, promptBlock: formatMismatchesForPrompt(mismatches) };
}

function formatMismatchesForPrompt(mismatches: Mismatch[]): string {
  if (mismatches.length === 0) return '';
  const sorted = [...mismatches].sort((a, b) => b.severity - a.severity);
  const lines = sorted.map(m => `- ${m.reason} — don't confidently contradict; ask or hedge instead`);
  return `Possible mismatch with what the user believes:\n${lines.join('\n')}`;
}

/** Prompt-ready rendering of what the user seems to currently want, if
 *  anything was explicitly stated this turn or recently. */
export function formatWantsForPrompt(model: UserModel): string {
  const wants = model.beliefs.filter(b => b.kind === 'stated_want');
  if (wants.length === 0) return '';
  const lines = wants.map(w => `- ${w.content}`);
  return `What the user has said they want:\n${lines.join('\n')}`;
}

/** Test/reset hook. */
export function resetUserModel(userId: string, characterId: string): void {
  store.delete(key(userId, characterId));
}
