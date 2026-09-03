/**
 * Discovery Engine — Vantrix
 *
 * Top of the curiosity → exploration → discovery chain (see
 * curiosity-engine.ts's header) and its public facade — same role
 * learning-engine.ts plays for skill-engine.ts/knowledge-engine.ts/
 * practice-engine.ts: callers outside this group of three files should
 * import from here, not reach into curiosity-engine.ts /
 * exploration-engine.ts directly, so a discovery always goes through
 * the same close-the-loop path (record the attempt → judge the outcome
 * → resolve the curiosity if it's actually answered) rather than a call
 * site resolving a curiosity without ever recording what was found.
 *
 *   curiosity-engine.ts                — durable open curiosities
 *   exploration-engine.ts              — concrete attempts to pursue one
 *   discovery-engine.ts (this file)    — outcomes + closing the loop
 *
 * A Discovery is only produced from an 'answered' or 'partial'
 * ExplorationResult — a 'deflected' or 'no_response' attempt is still
 * worth recording (exploration-engine.ts does that regardless) but
 * produces nothing here, since nothing was actually found out.
 * novelty scoring below is deliberately simple (topic + how long the
 * curiosity had been open) rather than trying to assess content
 * novelty itself — this module has no view into what was actually
 * said, only the structured record handed to it, the same
 * caller-supplies-context boundary autobiography-engine.ts and
 * learning-engine.ts both already keep.
 */

import { logger } from '@/lib/logger';
import {
  resolveCuriosity,
  raiseCuriosity,
  type CuriosityTopic,
  type OpenCuriosity,
} from '@/lib/ai/curiosity-engine';
import {
  recordExplorationAttempt,
  pickExplorationTarget,
  type ExplorationMethod,
  type ExplorationResult,
} from '@/lib/ai/exploration-engine';

export type { OpenCuriosity, CuriosityTopic, CuriosityMaintenanceReport } from '@/lib/ai/curiosity-engine';
export { getOpenCuriosities, getMostPressingCuriosity, raiseCuriosity, formatCuriositiesForPrompt, runCuriosityMaintenance, resetCuriosities } from '@/lib/ai/curiosity-engine';
export type { ExplorationAttempt, ExplorationMethod, ExplorationResult } from '@/lib/ai/exploration-engine';
export { pickExplorationTarget, getAttemptsForCuriosity, formatExplorationForPrompt, resetExplorationLog } from '@/lib/ai/exploration-engine';

// ── Types ───────────────────────────────────────────────────────────────

export interface Discovery {
  id: string;
  curiosityId: string;
  topic: CuriosityTopic;
  /** Short, prompt-ready statement of what was found out. */
  finding: string;
  /** 0..1 — higher for longer-standing curiosities finally answered,
   *  since a discovery that closes a long-open question lands as more
   *  significant than one that resolves something just raised. */
  noveltyScore: number;
  turnsOpen: number;
  turn: number;
}

// ── Orchestration ─────────────────────────────────────────────────────────

/**
 * Attempt to pursue the best available curiosity this turn, then judge
 * the outcome. This is the single call site that ties the whole chain
 * together: it records the exploration attempt regardless of outcome,
 * and — only if the result actually answers the question — produces a
 * Discovery and resolves the source curiosity. Returns null if there
 * was nothing worth exploring right now (pickExplorationTarget()
 * returned null) or the attempt didn't pan out.
 */
export function pursueAndRecordDiscovery(
  userId: string,
  characterId: string,
  turn: number,
  method: ExplorationMethod,
  result: ExplorationResult,
  description: string,
  finding?: string,
): Discovery | null {
  const target = pickExplorationTarget(userId, characterId);
  if (!target) {
    logger.debug('[discovery-engine] nothing to pursue this turn', { userId, characterId });
    return null;
  }

  recordExplorationAttempt(userId, characterId, turn, target.id, method, result, description);

  if (result !== 'answered' && result !== 'partial') return null;
  if (!finding) return null;

  const turnsOpen = turn - target.openedAtTurn;
  const discovery: Discovery = {
    id: `discovery-${userId}-${characterId}-${target.id}-${turn}`,
    curiosityId: target.id,
    topic: target.topic,
    finding,
    noveltyScore: scoreNovelty(turnsOpen, result),
    turnsOpen,
    turn,
  };

  // A 'partial' result softens but doesn't fully close the curiosity —
  // it keeps it open at reduced intensity rather than resolving it
  // outright, since something was learned but the question isn't
  // actually settled yet.
  if (result === 'answered') {
    resolveCuriosity(userId, characterId, target.id);
  }

  logger.debug('[discovery-engine] discovery made', {
    userId, characterId, curiosityId: target.id, result, noveltyScore: discovery.noveltyScore,
  });

  return discovery;
}

function scoreNovelty(turnsOpen: number, result: ExplorationResult): number {
  const base = Math.min(1, turnsOpen / 40); // longer-open questions score higher
  return result === 'answered' ? Math.max(0.3, base) : Math.max(0.15, base * 0.5);
}

// ── Read helpers ──────────────────────────────────────────────────────────

export function formatDiscoveryForPrompt(discovery: Discovery): string {
  return `Finally found out: ${discovery.finding}`;
}

// ── WIRE-FIX (discovery audit, 2026-07-22) ─────────────────────────────────
// curiosity-engine.ts / exploration-engine.ts / discovery-engine.ts had a
// complete, working chain — bounded storage, decay, prompt formatting, the
// works — but nothing outside this trio ever called into it. No caller
// raised a curiosity, so getOpenCuriosities() always returned an empty
// array for every real conversation; the whole chain was reachable only
// from its own tests. The two functions below are the deterministic (no
// extra LLM call, same house style as bidirectional-evolution.ts's
// detectEvolutionSignal/detectHabitSignal) hook points chat/stream/route.ts
// now actually calls: one raises a curiosity when the character's own
// reply asks the user something, the other judges whether the user's next
// message actually answered a previously open one.

const TRIVIAL_TAG_QUESTIONS = /\b(right|okay|ok|yeah|huh|you know)\?$/i;
const MIN_QUESTION_LEN = 12;

/**
 * Scan an assistant reply for a genuine question directed at the user and,
 * if found, open a durable curiosity so a later turn can follow up on it.
 * Deliberately conservative: this only ever raises 'about_user' curiosities
 * from what the character herself just asked (not from world/self topics,
 * which have no single deterministic trigger worth guessing at here) — a
 * false negative just means one fewer thread gets tracked, which is a much
 * safer failure mode than raising noisy curiosities from small talk.
 */
export function detectAndRaiseCuriosity(
  userId: string,
  characterId: string,
  turn: number,
  assistantReply: string,
): OpenCuriosity | null {
  if (!assistantReply) return null;

  // Strip [thought]...[/thought] blocks first — an internal thought posed
  // as a rhetorical question ("[thought]Why does he always do this?[/thought]")
  // is never something actually asked of the user.
  const spoken = assistantReply.replace(/\[thought\][\s\S]*?\[\/thought\]/gi, ' ');

  const sentences = spoken.match(/[^.!?]*\?/g) ?? [];
  for (const raw of sentences) {
    const q = raw.trim();
    if (q.length < MIN_QUESTION_LEN) continue;
    if (TRIVIAL_TAG_QUESTIONS.test(q)) continue;
    return raiseCuriosity(userId, characterId, turn, 'about_user', q);
  }
  return null;
}

// Deflection patterns: the user explicitly declining to answer, as opposed
// to just not addressing it. Kept intentionally short/high-precision —
// this only downgrades a result from 'answered' to 'deflected', it never
// blocks the message from being processed normally either way.
const DEFLECTION_RE =
  /\b(i('d| would)? rather not|not (going to|gonna) (talk|get into|discuss)|none of your business|can we (talk about|change the) (something else|subject|topic)|let'?s not (talk|get into)|don'?t (want to|wanna) (talk|discuss|get into)|drop it)\b/i;

/**
 * Judge whether the user's latest message resolves the most pressing open
 * curiosity, if any, and close the loop through discovery-engine.ts's own
 * pursueAndRecordDiscovery(). No-op (returns null) when there's nothing
 * open to resolve — the common case for most turns.
 */
export function detectAndResolveCuriosity(
  userId: string,
  characterId: string,
  turn: number,
  userMessage: string,
): Discovery | null {
  const target = pickExplorationTarget(userId, characterId);
  if (!target) return null;

  const trimmed = userMessage.trim();
  let result: ExplorationResult;
  let finding: string | undefined;

  if (DEFLECTION_RE.test(trimmed)) {
    result = 'deflected';
  } else if (trimmed.length < 4) {
    // Blank/near-blank turn (e.g. just an emoji or "ok") — nothing to learn.
    result = 'no_response';
  } else if (trimmed.length < 20) {
    // Short but non-trivial reply — counts as partial: something came back,
    // but not enough to confidently call the question closed.
    result = 'partial';
    finding = trimmed.slice(0, 200);
  } else {
    result = 'answered';
    finding = trimmed.slice(0, 200);
  }

  return pursueAndRecordDiscovery(
    userId, characterId, turn, 'direct_question', result,
    `asked "${target.question}"`, finding,
  );
}
