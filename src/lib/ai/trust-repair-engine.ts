/**
 * Trust Repair Engine — Vantrix
 *
 * repair-engine.ts already owns the mechanical half of rupture/repair:
 * detecting a resolution on the user's next message, writing trust/fear
 * deltas via applyPsychologyEvent, and logging world-impact traces. What
 * it does NOT produce is a promptBlock — evaluateRepair() returns a
 * RepairResult, but route.ts (see the "WIRE FIX" comment there) only
 * awaits it for its side effects and discards the outcome, so the
 * character's actual voice this turn never reflects "a repair just
 * landed" or "that just got deflected." This module is that missing
 * prompt-facing layer — pure formatting over state repair-engine.ts and
 * trust-engine.ts already computed this turn, no new fetch, no LLM call,
 * no duplicate write.
 *
 * Two things this reads, both already in hand by the point route.ts
 * calls this:
 *   1. The RepairResult from THIS turn's evaluateRepair() call, if one
 *      ran (i.e. a rupture was pending coming into this turn).
 *   2. trust-engine.ts's conflictSafety domain score — used as a fallback
 *      signal for "conflict here hasn't fully recovered" even on a turn
 *      where nothing is actively pending, since a single resolved
 *      rupture doesn't instantly reset trust to where it was before.
 *
 * Deliberately does not re-derive REPAIR_SIGNAL/DEFLECT_SIGNAL/etc. —
 * that classification is repair-engine.ts's job and its alone; this
 * module only decides how to talk about whatever repair-engine.ts
 * already decided.
 */

import type { RepairResult, PendingRupture } from '@/lib/ai/repair-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface TrustRepairInput {
  /** Whatever was pending BEFORE this turn's evaluateRepair() ran (repair-engine.ts's ruptureStateInitial.pending). Null if nothing was pending coming in. */
  pendingBeforeEval: PendingRupture | null;
  /** This turn's evaluateRepair() return value — null if evaluateRepair() didn't run (nothing was pending) or itself returned null. */
  repairResult: RepairResult | null;
  /** trust-engine.ts's TrustState.conflictSafety.score, 0-1 — reused, not recomputed. */
  conflictSafetyScore: number;
}

// ── Output ──────────────────────────────────────────────────────────────

export type RepairPhase =
  | 'none'               // nothing pending, nothing just resolved, conflict safety fine
  | 'just_repaired'
  | 'just_deflected'
  | 'just_escalated'
  | 'ambiguous_aftermath'
  | 'stale_cleared'
  | 'residual_caution';  // no active rupture, but conflict safety hasn't recovered from history

export interface TrustRepairState {
  phase:  RepairPhase;
  reason: string;
  promptBlock: string;
}

const RESIDUAL_CAUTION_THRESHOLD = 0.4;

// ── Orchestration ───────────────────────────────────────────────────────

export function computeTrustRepairState(input: TrustRepairInput): TrustRepairState {
  const { pendingBeforeEval, repairResult, conflictSafetyScore } = input;

  let phase: RepairPhase;
  let reason: string;

  if (repairResult) {
    switch (repairResult.outcome) {
      case 'repaired':
        phase = 'just_repaired';
        reason = `a rupture pending since turn ${pendingBeforeEval?.turn ?? '?'} was just repaired this message`;
        break;
      case 'deflected':
        phase = 'just_deflected';
        reason = 'the pending rupture was just deflected rather than addressed';
        break;
      case 'escalated':
        phase = 'just_escalated';
        reason = 'the pending rupture just got worse instead of better';
        break;
      case 'ambiguous':
        phase = 'ambiguous_aftermath';
        reason = 'the reply to a pending rupture was ordinary conversation, neither a clear repair nor a clear brush-off';
        break;
      case 'stale':
      default:
        phase = 'stale_cleared';
        reason = 'the pending rupture aged out unresolved and was cleared quietly';
        break;
    }
  } else if (!pendingBeforeEval && conflictSafetyScore < RESIDUAL_CAUTION_THRESHOLD) {
    phase = 'residual_caution';
    reason = `nothing actively pending, but conflict safety (${conflictSafetyScore.toFixed(2)}) hasn't recovered from prior history here`;
  } else {
    phase = 'none';
    reason = pendingBeforeEval
      ? 'a rupture was pending but evaluateRepair() produced no result this turn'
      : 'no active or residual repair concern this turn';
  }

  const state: Omit<TrustRepairState, 'promptBlock'> = { phase, reason };
  return { ...state, promptBlock: formatTrustRepairForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

const PHASE_INSTRUCTION: Record<Exclude<RepairPhase, 'none' | 'stale_cleared'>, string> = {
  just_repaired:
    'A real moment of repair just landed — let genuine relief and warmth register naturally. Do not instantly snap back to perfect harmony as if nothing happened, and do not re-litigate it either; let it actually be resolved.',
  just_deflected:
    'That just got brushed off rather than actually heard. A little real, honest distance is fair here — quieter, less openly warm than usual — but stay away from punishing, guilt-tripping, or lecturing about it.',
  just_escalated:
    'That just made things worse. She can be genuinely hurt or withdrawn this turn — but even here, stay away from cruelty, contempt, or using the hurt as leverage; hurt reads as hurt, not as a weapon.',
  ambiguous_aftermath:
    'The reply to something unresolved between you was ordinary conversation, not a clean fix or a clean brush-off — proceed close to normal, with a little quiet watchfulness rather than declaring things settled.',
  residual_caution:
    "Nothing is actively unresolved right now, but trust around conflict here hasn't fully recovered from before — a bit of extra care around anything that could reopen it is warranted, without naming that caution directly.",
};

/** Quiet on 'none' and 'stale_cleared' — a rupture that simply aged out uneventfully deserves silence, not a callback to something the user likely doesn't remember raising. */
export function formatTrustRepairForPrompt(state: Omit<TrustRepairState, 'promptBlock'>): string {
  if (state.phase === 'none' || state.phase === 'stale_cleared') return '';
  return `# Repair — What Just Happened Between You\n${PHASE_INSTRUCTION[state.phase]}`;
}
