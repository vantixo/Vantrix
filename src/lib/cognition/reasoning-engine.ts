/**
 * Reasoning Engine — Vantrix Cognition Layer
 *
 * Every engine upstream of this one (drives, goals, confidence, attention)
 * produces its own independent read on the turn. Most of the time those
 * reads agree, or agree closely enough that executive-controller.ts's
 * straight composition is fine. This module exists for the minority of
 * turns where they don't: drives point one way and relationship stage
 * points another, a surfaced memory contradicts what the user just said,
 * or confidence is high on domains that don't actually matter this turn.
 * It is a small deliberative layer — not a new source of signal, a way
 * of weighing the signals that already exist against each other and
 * producing one explicit, inspectable conclusion plus the reasoning
 * trail that got there.
 *
 * This is deliberately *not* a general-purpose inference engine. It only
 * ever weighs claims that other modules in this codebase already produced
 * (drives, goal, confidence, working-memory items, surfaced memories) —
 * it does not accept free-text and does not call out to an LLM. Keeping
 * it arithmetic means it's cheap enough to run every turn a conflict is
 * even suspected, and its output is deterministic and testable.
 */

import { logger } from '@/lib/logger';
import type { WorkingMemoryItem } from '@/lib/cognition/working-memory';

// ── Types ───────────────────────────────────────────────────────────────

export type ClaimPolarity = 'supports' | 'opposes';

/**
 * One input to a reasoning pass. `source` is free-text provenance (e.g.
 * "drives.attachment", "relationship.stage", "memory:first_meeting") so
 * the trail stays legible in logs and prompt injection without needing a
 * closed enum every upstream engine would have to register into.
 */
export interface Claim {
  id: string;
  source: string;
  /** What this claim is about — claims are only weighed against other
   *  claims that share a subject; unrelated claims never compete. */
  subject: string;
  polarity: ClaimPolarity;
  /** 0–1. How strongly this source believes its own claim. */
  strength: number;
  /** 0–1. How much this source's claims should count in general — e.g.
   *  a watch_flag-derived claim should outweigh an open_thread one even
   *  at equal strength. Defaults to 1 if omitted. */
  weight?: number;
  note?: string;
}

export interface ReasoningStep {
  subject: string;
  supportScore: number;
  opposeScore: number;
  /** supportScore - opposeScore, normalized to -1..1. */
  net: number;
  leadingClaim: Claim | null;
  conflicting: boolean;
}

export interface ReasoningResult {
  steps: ReasoningStep[];
  /** Subjects where support and oppose were close enough that neither
   *  side should be treated as settled — surfaced separately so callers
   *  can choose to hedge, ask, or defer rather than pick a side blind. */
  unresolved: string[];
  /** Prompt-ready summary of anything worth a visible hedge. Empty when
   *  every subject resolved cleanly — most turns produce nothing here. */
  promptBlock: string;
}

// A gap this small between the two sides doesn't count as resolved —
// it's noise, not a decision. Below this margin the subject is flagged
// as unresolved instead of silently picking whichever side edged ahead.
const CONFLICT_MARGIN = 0.15;

// ── Core ────────────────────────────────────────────────────────────────

/**
 * Weigh a batch of claims against each other, grouped by subject. Safe to
 * call with claims about several unrelated subjects in one pass — each
 * subject is scored independently.
 */
export function reason(claims: Claim[]): ReasoningResult {
  const bySubject = new Map<string, Claim[]>();
  for (const claim of claims) {
    const bucket = bySubject.get(claim.subject) ?? [];
    bucket.push(claim);
    bySubject.set(claim.subject, bucket);
  }

  const steps: ReasoningStep[] = [];
  const unresolved: string[] = [];

  for (const [subject, subjectClaims] of bySubject) {
    let supportScore = 0;
    let opposeScore = 0;
    let leadingClaim: Claim | null = null;
    let leadingScore = -Infinity;

    for (const claim of subjectClaims) {
      const weighted = claim.strength * (claim.weight ?? 1);
      if (claim.polarity === 'supports') supportScore += weighted;
      else opposeScore += weighted;

      if (weighted > leadingScore) {
        leadingScore = weighted;
        leadingClaim = claim;
      }
    }

    const total = supportScore + opposeScore;
    const net = total === 0 ? 0 : (supportScore - opposeScore) / total;
    const conflicting = Math.abs(net) < CONFLICT_MARGIN && total > 0;

    if (conflicting) unresolved.push(subject);

    steps.push({ subject, supportScore, opposeScore, net, leadingClaim, conflicting });
  }

  if (unresolved.length > 0) {
    logger.debug('[cognition/reasoning-engine] unresolved conflicts this turn', { subjects: unresolved });
  }

  return { steps, unresolved, promptBlock: formatReasoningForPrompt(steps, unresolved) };
}

/**
 * Convenience for the common case: a working-memory item (e.g. a
 * surfaced_fact or watch_flag) potentially contradicts something the
 * current turn's signals imply. Returns true only when the conflict is
 * clean enough to be worth surfacing, not for near-ties.
 */
export function contradicts(item: WorkingMemoryItem, claim: Claim): boolean {
  if (item.id === claim.id) return false;
  const itemAsClaim: Claim = {
    id: item.id,
    source: `working_memory:${item.kind}`,
    subject: claim.subject,
    polarity: 'opposes',
    strength: item.activation,
  };
  const result = reason([claim, itemAsClaim]);
  const step = result.steps.find(s => s.subject === claim.subject);
  return !!step && !step.conflicting && step.net < 0;
}

function formatReasoningForPrompt(steps: ReasoningStep[], unresolved: string[]): string {
  if (unresolved.length === 0) return '';
  const lines = steps
    .filter(s => s.conflicting)
    .map(s => `- ${s.subject}: signals conflict (${s.leadingClaim?.source ?? 'unknown'} leads narrowly) — treat as unsettled, don't state it with confidence`);
  if (lines.length === 0) return '';
  return `Internal reasoning conflicts this turn:\n${lines.join('\n')}`;
}
