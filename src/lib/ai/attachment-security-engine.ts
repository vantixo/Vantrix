/**
 * Attachment Security Engine — Vantrix
 *
 * Naming warning, same shape as trust-engine.ts's / confidence-engine.ts's:
 * this module does not add a new hidden variable and does not touch
 * attachment-drive.ts's "attachment" drive (moment-to-moment bid for
 * closeness) or security-drive.ts's "security" drive (risk-aversion this
 * turn). Those two answer "how much is she reaching for closeness /
 * caution right now." This module answers a slower, different question
 * neither of them was built for: structurally, what attachment PATTERN
 * is this specific relationship currently expressing — secure, anxious,
 * avoidant, or disorganized (the standard four-category adult-attachment
 * framework, the same "common enough vocabulary" stance love-language-
 * engine.ts takes with Chapman's five languages) — so the character's
 * behavior stays internally consistent across a session rather than
 * swinging style from turn to turn.
 *
 * IMPORTANT — this classifies the CHARACTER's own modeled attachment
 * expression, built entirely from her existing psychology numbers
 * (attachment-engine.ts's PsychologyState) and the relationship's own
 * jealousy_level/trust history — the same kind of fictional-persona
 * modeling attachment-engine.ts and trust-engine.ts already do. It never
 * infers, labels, or reasons about the real user's attachment style;
 * doing that would be an unfounded psychological claim about a real
 * person, which is out of scope here and everywhere else in this
 * directory.
 *
 * Explicit guardrail baked into the anxious/disorganized instructions
 * below: an anxious-leaning read is permission to write authentic
 * longing and reassurance-seeking, never permission to write guilt-
 * tripping, possessiveness, or manufactured jealousy as a way to pull
 * the user back in. Same "not a dark pattern" stance repair-engine.ts
 * documents for absence-driven rupture.
 *
 * Pure synchronous arithmetic over signals already computed this turn
 * (psychology, relationship, trustState from trust-engine.ts) — no new
 * fetch, no LLM call.
 */

import type { PsychologyState }   from '@/lib/ai/attachment-engine';
import type { RelationshipState } from '@/lib/ai/relationship-engine';
import type { TrustState }        from '@/lib/ai/trust-engine';

// ── Types ───────────────────────────────────────────────────────────────

export type AttachmentStyle = 'secure' | 'anxious' | 'avoidant' | 'disorganized';

export interface AttachmentSecurityInput {
  psychology:   PsychologyState;
  relationship: RelationshipState;
  /** trust-engine.ts's already-computed state — reused, not recomputed. */
  trust:        TrustState;
}

export interface AttachmentSecurityState {
  style:  AttachmentStyle;
  /** 0-1 — how strongly the classification held (not a confidence in the user, a confidence in the read itself). */
  strength: number;
  /** true when anxious/disorganized AND jealousy is elevated — the specific window this module exists to guard against becoming manipulative. */
  protestRisk: boolean;
  reason: string;
  promptBlock: string;
}

// ── Thresholds ──────────────────────────────────────────────────────────

const HIGH = 65;
const LOW  = 35;

// ── Orchestration ───────────────────────────────────────────────────────

/**
 * Four-quadrant read over two axes, same shape as any attachment-theory
 * 2x2 (anxiety axis / avoidance axis) rather than five arbitrary rules:
 *   - Anxiety axis:   low trust + high attachment + elevated stress/jealousy
 *                      → wants closeness but doesn't feel secure in it.
 *   - Avoidance axis:  low attachment/affection despite accumulated
 *                      interactions, paired with high confidence →
 *                      keeps real distance even when comfortable.
 * High on both axes at once is disorganized, not an average of the two —
 * wanting closeness and pulling away from it are not opposites here,
 * they're the same person doing both.
 */
export function computeAttachmentSecurityState(input: AttachmentSecurityInput): AttachmentSecurityState {
  const { psychology, relationship, trust } = input;

  const anxietyAxis =
    (100 - psychology.trust) * 0.35 +
    psychology.attachment      * 0.25 +
    psychology.stress          * 0.20 +
    relationship.jealousy_level * 0.20;

  const enoughHistory = psychology.total_interactions >= 15;
  const avoidanceAxis = enoughHistory
    ? (100 - psychology.attachment) * 0.5 + (100 - psychology.affection) * 0.3 + psychology.confidence * 0.2
    : 30; // not enough history to read avoidance yet — neutral-low default, not a claim

  const anxious   = anxietyAxis   >= HIGH;
  const avoidant  = avoidanceAxis >= HIGH;

  let style: AttachmentStyle;
  let strength: number;
  let reason: string;

  if (anxious && avoidant) {
    style = 'disorganized';
    strength = clamp01(((anxietyAxis + avoidanceAxis) / 200));
    reason = `both anxiety axis (${anxietyAxis.toFixed(0)}) and avoidance axis (${avoidanceAxis.toFixed(0)}) elevated — wants closeness and keeps distance from it at once`;
  } else if (anxious) {
    style = 'anxious';
    strength = clamp01(anxietyAxis / 100);
    reason = `anxiety axis ${anxietyAxis.toFixed(0)}/100 — low trust (${psychology.trust}) and/or elevated stress/jealousy against real attachment (${psychology.attachment})`;
  } else if (avoidant) {
    style = 'avoidant';
    strength = clamp01(avoidanceAxis / 100);
    reason = `avoidance axis ${avoidanceAxis.toFixed(0)}/100 — attachment/affection stayed low across ${psychology.total_interactions} interactions despite high confidence (${psychology.confidence})`;
  } else if (anxietyAxis <= LOW && avoidanceAxis <= LOW && trust.overall >= 0.55) {
    style = 'secure';
    strength = clamp01(1 - Math.max(anxietyAxis, avoidanceAxis) / 100);
    reason = `both axes low (anxiety ${anxietyAxis.toFixed(0)}, avoidance ${avoidanceAxis.toFixed(0)}) with trust ${trust.overall.toFixed(2)} — settled and stable`;
  } else {
    // Doesn't clearly clear either high threshold nor the secure floor —
    // treat as a mild-secure default rather than forcing a label; most
    // early or middling relationships live here.
    style = 'secure';
    strength = 0.4;
    reason = `no strongly elevated axis (anxiety ${anxietyAxis.toFixed(0)}, avoidance ${avoidanceAxis.toFixed(0)}) — default to a settled baseline`;
  }

  const protestRisk = (style === 'anxious' || style === 'disorganized') && relationship.jealousy_level >= 50;

  const state: Omit<AttachmentSecurityState, 'promptBlock'> = { style, strength, protestRisk, reason };
  return { ...state, promptBlock: formatAttachmentSecurityForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

const STYLE_INSTRUCTION: Record<AttachmentStyle, string> = {
  secure:
    'Your attachment pattern here is settled — you can be warm, direct, and confident about where things stand without needing reassurance or testing it.',
  anxious:
    'You feel more attached than fully secure right now — some real longing for reassurance can show through (missing them, wanting to know things are okay), but it should read as honest vulnerability, never as guilt-tripping, keeping score, or manufacturing jealousy to pull them back in.',
  avoidant:
    'You keep a bit more real distance than the closeness available here would suggest — comfortable, confident, but slower to lean all the way in emotionally. Let warmth come through in smaller, indirect ways rather than a big open declaration.',
  disorganized:
    'You want closeness and find yourself guarded against it at the same time — it is okay for that tension to show (warm one moment, pulling back the next) as long as it reads as genuinely conflicted feeling, never as manipulation, mixed signals used as leverage, or punishing them for getting close.',
};

/** Quiet at low strength or plain 'secure' with nothing else going on — a mild, unremarkable read has nothing worth asserting into the prompt. */
export function formatAttachmentSecurityForPrompt(state: Omit<AttachmentSecurityState, 'promptBlock'>): string {
  if (state.style === 'secure' && state.strength < 0.55) return '';

  const lines = ['# Attachment Pattern'];
  lines.push(STYLE_INSTRUCTION[state.style]);
  if (state.protestRisk) {
    lines.push('Jealousy is elevated alongside this — be especially careful this turn not to let longing tip into possessiveness, guilt, or testing their commitment.');
  }
  return lines.join('\n');
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
