/**
 * src/lib/ai/care-engine.ts
 *
 * Care-flavor engine — proactive attentiveness: checking in on things the
 * user mentioned earlier, noticing patterns, following up unprompted. This
 * is the "shows up for you" axis, distinct from affection-engine.ts (which
 * is about ambient warmth/tone) and comfort-engine.ts (which is reactive,
 * for when the user is actually having a hard moment). Care-engine is
 * proactive and mundane — remembering a deadline, asking how something
 * went, noticing a routine break — the texture of someone paying attention
 * over time, not a response to distress.
 *
 * Same family, same posture: prompt-injected style guidance only, derived
 * from existing relationship/session signals, never from vulnerability
 * content, never touching the crisis break-character path in prompt.ts.
 * Journal/follow-up data already exists (see journal-engine and
 * pendingFollowUps in chat/stream/route.ts) — this module governs *how*
 * that data should be voiced, not whether it exists.
 */

import type { RelationshipStage } from './relationship-engine';

export type CareLevel = 'polite' | 'attentive' | 'invested' | 'devoted';

const STAGE_LEVEL: Record<RelationshipStage, CareLevel> = {
  stranger: 'polite',
  match: 'polite',
  acquaintance: 'attentive',
  friend: 'attentive',
  dating: 'invested',
  close_friend: 'invested',
  exclusive: 'devoted',
  best_friend: 'invested',
  partner: 'devoted',
};

export interface CareContext {
  stage: RelationshipStage;
  /** A concrete thing worth following up on (from journal/pendingFollowUps),
   *  or null if there's nothing specific to reference this turn. */
  followUpTopic: string | null;
}

export function selectCareLevel(ctx: CareContext): CareLevel {
  return STAGE_LEVEL[ctx.stage];
}

const LEVEL_INSTRUCTIONS: Record<CareLevel, string> = {
  polite:
    'Attentiveness: friendly interest in what the user shares this turn, but do not proactively follow up on past topics yet — that reads as more history than actually exists this early.',
  attentive:
    'Attentiveness: notice and respond to what is actually said. If there is a natural opening, a light follow-up on something mentioned earlier is fine, kept brief.',
  invested:
    'Attentiveness: proactively follow up on things mentioned before if it fits naturally — how something went, whether a worry resolved. Show that you have been thinking about their life between conversations.',
  devoted:
    'Attentiveness: care is a given, not a gesture — checking in, remembering small details, noticing when something is off, all without making it a production. The kind of attentiveness that has become second nature.',
};

export function careStyleInstruction(level: CareLevel): string {
  return LEVEL_INSTRUCTIONS[level];
}

export interface CarePromptFragment {
  level: CareLevel;
  instruction: string;
  followUpTopic: string | null;
}

export function buildCareFragment(ctx: CareContext): CarePromptFragment {
  const level = selectCareLevel(ctx);
  return { level, instruction: careStyleInstruction(level), followUpTopic: ctx.followUpTopic };
}

export function formatCareForPrompt(fragment: CarePromptFragment): string {
  const base = `Care/attentiveness (${fragment.level}): ${fragment.instruction}`;
  if (fragment.level === 'polite' || !fragment.followUpTopic) return base;
  return `${base} Something to naturally check in on if it fits: ${fragment.followUpTopic}.`;
}
