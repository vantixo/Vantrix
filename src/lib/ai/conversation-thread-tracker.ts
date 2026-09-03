/**
 * Conversation Thread Tracker — Vantrix
 *
 * Closes two gaps left explicitly documented (not faked) in drive-engine.ts's
 * signal assembly in route.ts:
 *
 *   - curiosity.ts's unansweredQuestions / oldestUnansweredTurns — nothing
 *     previously tracked whether a question SHE asked ever got a real
 *     answer. (Not the same thing as agency-engine.ts's
 *     character_open_threads, which tracks topics SHE wants to raise, not
 *     questions she's already asked and is waiting on.)
 *   - status-drive.ts's recentTurnsCenteredOnUser — nothing previously
 *     tracked whose "airtime" a stretch of conversation has actually gone
 *     to.
 *
 * Both are cheap, heuristic, no-LLM signals — consistent with every other
 * drive/decision module in this directory. They are approximations, not
 * semantic understanding: a "did they answer?" check here is a length/
 * substance heuristic, not comprehension. That's an intentional match to
 * this codebase's existing bar (see e.g. decision-engine.ts's header on
 * why Intent selection is arithmetic, not a second LLM call).
 *
 * Two-phase per turn, same shape as repair-engine.ts's getRuptureState() +
 * evaluateRepair() pattern already used in route.ts:
 *
 *   1. getTurnSignals() — called BEFORE this turn's reply is generated,
 *      using the user's incoming message to (heuristically) resolve the
 *      oldest pending question and update the airtime streak. Feeds
 *      driveSignals for this turn's executive/decision pass.
 *   2. recordCharacterReply() — called AFTER this turn's reply is
 *      generated (via after()), to detect whether the character asked a
 *      new question and to record this reply's length for next turn's
 *      airtime comparison.
 */

import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';

// ── Config ──────────────────────────────────────────────────────────────

const STATE_TTL = 60 * 60 * 24 * 14; // 14 days — this is fast-moving turn state, not durable memory
const MAX_PENDING_QUESTIONS = 5;
const STALE_AFTER_INTERACTIONS = 20; // a question that old is abandoned, not "still open"
const SUBSTANTIVE_REPLY_MIN_CHARS = 12; // below this, treat as a deflection, not an answer

// ── Types ───────────────────────────────────────────────────────────────

interface PendingQuestion {
  text: string;
  askedAtInteraction: number;
}

interface ThreadTrackerState {
  pendingQuestions:   PendingQuestion[];
  userCenteredStreak: number; // consecutive turns airtime has skewed toward the user
  lastCharReplyChars: number; // length of her previous reply, for this turn's airtime comparison
  updatedAt:          number;
}

export interface QuestionAndAirtimeSignals {
  unansweredQuestions:      number;
  oldestUnansweredTurns:    number;
  recentTurnsCenteredOnUser: number;
}

function emptyState(): ThreadTrackerState {
  return { pendingQuestions: [], userCenteredStreak: 0, lastCharReplyChars: 0, updatedAt: Date.now() };
}

function stateKey(userId: string, characterId: string): string {
  return `vantrix:thread-tracker:${userId}:${characterId}`;
}

async function getState(userId: string, characterId: string): Promise<ThreadTrackerState> {
  try {
    const state = await redis.get<ThreadTrackerState>(stateKey(userId, characterId));
    return state ?? emptyState();
  } catch (err) {
    logger.warn('[conversation-thread-tracker] Redis get failed', { userId, characterId, error: String(err) });
    return emptyState();
  }
}

async function saveState(userId: string, characterId: string, state: ThreadTrackerState): Promise<void> {
  try {
    await redis.set(stateKey(userId, characterId), state, { ex: STATE_TTL });
  } catch (err) {
    logger.warn('[conversation-thread-tracker] save failed', { userId, characterId, error: String(err) });
  }
}

// ── Phase 1: read + resolve, before this turn's reply exists ────────────

/**
 * Call once per turn, before building this turn's driveSignals. Resolves
 * the oldest pending question against the user's incoming message (cheap
 * heuristic: a short, low-substance reply doesn't count as an answer —
 * this is deliberately generous, since false negatives here just mean a
 * lingering mild curiosity pull, not a broken feature), drops anything
 * abandoned past STALE_AFTER_INTERACTIONS, and updates the airtime streak
 * by comparing this message's length against her previous reply's length.
 * Fails open to the same neutral defaults route.ts used before this
 * module existed.
 */
export async function getTurnSignals(
  userId: string,
  characterId: string,
  userMessage: string,
  currentInteractionCount: number,
): Promise<QuestionAndAirtimeSignals> {
  try {
    const state = await getState(userId, characterId);
    const trimmed = userMessage.trim();

    // Resolve at most one pending question per turn — a single substantive
    // reply plausibly addresses the most recent thing she asked, not
    // everything she's ever asked.
    let pending = state.pendingQuestions.filter(
      q => currentInteractionCount - q.askedAtInteraction <= STALE_AFTER_INTERACTIONS,
    );
    if (pending.length && trimmed.length >= SUBSTANTIVE_REPLY_MIN_CHARS) {
      const [, ...rest] = pending;
      pending = rest;
    }

    // Airtime heuristic: her previous reply vs. this incoming message.
    // Consistently much-longer user messages (or a very short prior reply
    // from her) means the floor has been mostly his for a while.
    const userDominant = trimmed.length > 0 && (
      trimmed.length > state.lastCharReplyChars * 1.8 || state.lastCharReplyChars < 40
    );
    const userCenteredStreak = userDominant ? state.userCenteredStreak + 1 : 0;

    const updated: ThreadTrackerState = { ...state, pendingQuestions: pending, userCenteredStreak, updatedAt: Date.now() };
    await saveState(userId, characterId, updated);

    const oldest = pending.reduce<number>((max, q) => Math.max(max, currentInteractionCount - q.askedAtInteraction), 0);

    return {
      unansweredQuestions:       pending.length,
      oldestUnansweredTurns:     oldest,
      recentTurnsCenteredOnUser: userCenteredStreak,
    };
  } catch (err) {
    logger.warn('[conversation-thread-tracker] getTurnSignals failed, falling back to neutral defaults', {
      userId, characterId, error: String(err),
    });
    return { unansweredQuestions: 0, oldestUnansweredTurns: 0, recentTurnsCenteredOnUser: 0 };
  }
}

// ── Phase 2: record, after this turn's reply exists ──────────────────────

/**
 * Call via after() once the full reply text is available. Detects whether
 * she asked a new question this turn (cheap heuristic: a "?" in the final
 * sentence or two, not full parsing) and records this reply's length as
 * the baseline for next turn's airtime comparison. Never blocks the
 * response — same fail-open posture as every other after() hook in
 * route.ts.
 */
export async function recordCharacterReply(
  userId: string,
  characterId: string,
  replyText: string,
  currentInteractionCount: number,
): Promise<void> {
  try {
    const state = await getState(userId, characterId);

    const tailQuestion = extractTrailingQuestion(replyText);
    let pendingQuestions = state.pendingQuestions;
    if (tailQuestion) {
      pendingQuestions = [...pendingQuestions, { text: tailQuestion, askedAtInteraction: currentInteractionCount }];
      if (pendingQuestions.length > MAX_PENDING_QUESTIONS) {
        pendingQuestions = pendingQuestions.slice(pendingQuestions.length - MAX_PENDING_QUESTIONS);
      }
    }

    const updated: ThreadTrackerState = {
      ...state,
      pendingQuestions,
      lastCharReplyChars: replyText.trim().length,
      updatedAt: Date.now(),
    };
    await saveState(userId, characterId, updated);
  } catch (err) {
    logger.warn('[conversation-thread-tracker] recordCharacterReply failed', { userId, characterId, error: String(err) });
  }
}

/** Last sentence of the reply, if it's a genuine question — cheap heuristic, not full sentence parsing. */
function extractTrailingQuestion(replyText: string): string | null {
  const sentences = replyText.trim().split(/(?<=[.?!])\s+/).filter(Boolean);
  if (!sentences.length) return null;
  const last = sentences[sentences.length - 1]!;
  if (!last.trim().endsWith('?')) return null;
  return last.trim().slice(0, 200); // cap length — this is a signal, not a transcript
}
