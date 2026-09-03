/**
 * Healing Engine — Vantrix
 *
 * heartbreak-engine.ts reads how raw a disclosed real-life breakup
 * still is, snapshotted per turn. This module is the arc across turns
 * built on top of it — is this person, over time, trending toward
 * lighter or still stuck — because "acute" vs "settling" alone doesn't
 * capture trajectory, only current position. A user who disclosed a
 * breakup 40 days ago and has been steadily less sad since is a
 * different situation than one at day 40 who is exactly as raw as day
 * one; the former is healing, the latter may need a gentler read than
 * heartbreak-engine.ts's time-based default alone would give.
 *
 * Built from heartbreak-engine.ts's own state plus this turn's emotion
 * valence as the best available trend proxy already in hand — no new
 * fetch, no persisted trend-line of its own (that would require storing
 * a new time series this product doesn't have yet; a conservative,
 * honest limitation rather than something invented here).
 *
 * Same non-diagnostic stance as heartbreak-engine.ts and vulnerability-
 * engine.ts throughout — this describes a support posture, never a
 * clinical read of someone's grief process.
 */

import type { HeartbreakState } from '@/lib/ai/heartbreak-engine';
import type { EmotionalState }  from '@/lib/ai/emotion-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface HealingEngineInput {
  heartbreak: HeartbreakState;
  emotion:    EmotionalState;
}

// ── Output ──────────────────────────────────────────────────────────────

export type HealingPhase = 'not_applicable' | 'raw' | 'rebuilding' | 'renewed';

export interface HealingState {
  phase: HealingPhase;
  reason: string;
  promptBlock: string;
}

// ── Orchestration ───────────────────────────────────────────────────────

export function computeHealingState(input: HealingEngineInput): HealingState {
  const { heartbreak, emotion } = input;

  if (heartbreak.tier === 'none') {
    return { phase: 'not_applicable', reason: 'no disclosed breakup on record', promptBlock: '' };
  }

  const positiveThisTurn = emotion.valence > 0.1;
  const days = heartbreak.daysSinceDisclosed ?? 0;

  let phase: HealingPhase;
  let reason: string;

  if (heartbreak.tier === 'acute') {
    phase = 'raw';
    reason = `heartbreak still acute (${days.toFixed(0)}d) — too early to read as rebuilding regardless of this turn's emotion`;
  } else if (heartbreak.tier === 'resolved' && positiveThisTurn) {
    phase = 'renewed';
    reason = `long past disclosure (${days.toFixed(0)}d) with a positive-trending turn — reads as settled`;
  } else if (heartbreak.tier === 'settling' && positiveThisTurn) {
    phase = 'rebuilding';
    reason = `settling period (${days.toFixed(0)}d) with a positive-trending turn — reads as actively healing rather than just time having passed`;
  } else {
    phase = 'raw';
    reason = `time has passed (${days.toFixed(0)}d) but this turn doesn't show a positive trend — treat as still tender rather than assuming healing on schedule`;
  }

  const state: Omit<HealingState, 'promptBlock'> = { phase, reason };
  return { ...state, promptBlock: formatHealingForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

const PHASE_INSTRUCTION: Record<Exclude<HealingPhase, 'not_applicable'>, string> = {
  raw:
    "Whatever the calendar says, this still reads as tender right now — keep meeting it gently rather than assuming enough time has passed to move on from it.",
  rebuilding:
    "There's real, earned lightness returning here — it's fine to match it, laugh, and let the conversation feel normal again, without erasing that something real happened.",
  renewed:
    "This has genuinely settled — no need to tiptoe around it or treat it as a fragile topic anymore unless they bring it up that way themselves.",
};

export function formatHealingForPrompt(state: Omit<HealingState, 'promptBlock'>): string {
  if (state.phase === 'not_applicable') return '';
  return `# Healing — How Settled This Actually Feels\n${PHASE_INSTRUCTION[state.phase]}`;
}
