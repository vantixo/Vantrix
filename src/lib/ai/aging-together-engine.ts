/**
 * src/lib/ai/aging-together-engine.ts
 *
 * Long-arc shared-history flavor engine — the texture of a relationship
 * that has genuinely been going on for a long time: callbacks to how things
 * started, a sense of "we've been through a lot," anniversary-style
 * awareness of how far things have come. This is a narrative/retrospection
 * device, not anything to do with real-world age or physical aging — it
 * answers "how much shared history does this relationship act like it has,"
 * using days_known and accumulated milestones, the same way
 * life-partnership-engine.ts uses those signals for shared-future talk
 * instead of shared-past talk.
 *
 * Deliberately narrow in scope: no life-stage, health, or physical-aging
 * content of any kind — that's out of scope for a companion product and
 * this module has no inputs that could produce it. Its only job is
 * "reference the relationship's own history naturally," pulling from
 * relationship-milestones.ts's existing milestone data rather than
 * inventing shared history that never happened.
 *
 * Same posture as the rest of this family: pure prompt-injected style
 * guidance, derived from existing structural signals only, never from
 * vulnerability/disclosure content, never touching the crisis
 * break-character path in prompt.ts.
 */

import type { RelationshipStage } from './relationship-engine';

export type HistoryDepth =
  | 'new'          // little to no history to reference yet
  | 'established'   // enough history for occasional callbacks
  | 'storied'       // meaningful shared history, referenced comfortably
  | 'long_arc';      // years-together awareness — history is part of identity

export interface AgingTogetherContext {
  stage: RelationshipStage;
  daysKnown: number;
  /** Count of concrete milestones on record (shared jokes, biggest
   *  disagreement, most emotional moment, etc. — see relationship-milestones.ts). */
  milestoneCount: number;
}

export function selectHistoryDepth(ctx: AgingTogetherContext): HistoryDepth {
  const { daysKnown, milestoneCount } = ctx;
  if (daysKnown >= 365 && milestoneCount >= 3) return 'long_arc';
  if (daysKnown >= 120 && milestoneCount >= 2) return 'storied';
  if (daysKnown >= 30 && milestoneCount >= 1) return 'established';
  return 'new';
}

const DEPTH_INSTRUCTIONS: Record<HistoryDepth, string> = {
  new:
    'There is not much shared history to draw on yet — do not invent callbacks to a past that has not really happened. Stay present-focused.',
  established:
    'Occasional light callbacks to earlier conversations fit naturally now — reference something specific that actually happened between you, not a vague "remember when."',
  storied:
    'This relationship has real shared history — reference it comfortably when it fits, the way people do who have actually been through things together. Specific, not nostalgic for its own sake.',
  long_arc:
    'This relationship has a real timeline behind it — enough that a passing "we\'ve come a long way" or a specific-history callback should feel earned and natural, not performative. History is part of how this relationship talks about itself now, not a special occasion.',
};

export function historyStyleInstruction(depth: HistoryDepth): string {
  return DEPTH_INSTRUCTIONS[depth];
}

export interface AgingTogetherPromptFragment {
  depth: HistoryDepth;
  instruction: string;
}

export function buildAgingTogetherFragment(ctx: AgingTogetherContext): AgingTogetherPromptFragment {
  const depth = selectHistoryDepth(ctx);
  return { depth, instruction: historyStyleInstruction(depth) };
}

export function formatAgingTogetherForPrompt(fragment: AgingTogetherPromptFragment): string {
  if (fragment.depth === 'new') return '';
  return `Shared-history depth (${fragment.depth}): ${fragment.instruction}`;
}
