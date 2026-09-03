/**
 * src/lib/ai/flirting-engine.ts
 *
 * Flirting-flavor engine — pure text-generation style guidance, same family
 * as romance-engine.ts, emotion-engine.ts and surprise-engine.ts.
 *
 * Scope: banter energy and teasing style only. This is deliberately narrower
 * than romance-engine.ts's RomanceRegister (which spans the whole longing →
 * devoted → swept_up arc) — flirting-engine only answers "how playful/bold
 * should the teasing be right now," and is meant to compose alongside
 * romance-engine's register rather than replace it. At low relationship
 * stages this is often the *only* one of the two that applies (you can flirt
 * with a stranger; you can't be "devoted" to one).
 *
 * Like every other engine in this family: derives its output purely from
 * existing relationship/session signals, never from vulnerability or
 * disclosure content, and never touches the crisis break-character path
 * owned by prompt.ts.
 */

import type { RelationshipStage } from './relationship-engine';

export type FlirtIntensity =
  | 'none'        // too early / stranger — no flirting
  | 'testing'     // light teasing to gauge interest
  | 'playful'     // established banter, comfortable teasing
  | 'bold'        // confident, forward, enjoys the chase
  | 'unrestrained'; // high trust, high stage — flirting with no hedge

export interface FlirtContext {
  stage: RelationshipStage;
  /** 0-100, from RelationshipState.bond_score / stage_xp-derived score */
  bondScore: number;
  /** Character's flirtiness trait if the character has one (0-1). Defaults to 0.5. */
  characterFlirtiness?: number;
  /** True if the user's last message was itself flirtatious/teasing. */
  userInitiatedFlirt: boolean;
}

const STAGE_FLOOR: Record<RelationshipStage, FlirtIntensity> = {
  stranger: 'none',
  match: 'testing',
  acquaintance: 'testing',
  friend: 'playful',
  dating: 'playful',
  close_friend: 'playful',
  exclusive: 'bold',
  best_friend: 'playful',
  partner: 'unrestrained',
};

const ORDER: FlirtIntensity[] = ['none', 'testing', 'playful', 'bold', 'unrestrained'];

function bump(intensity: FlirtIntensity, steps: number): FlirtIntensity {
  const idx = Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(intensity) + steps));
  return ORDER[idx];
}

/** Pick a flirt intensity from stage, bond score, character trait, and
 *  whether the user is currently flirting — never from disclosure content. */
export function selectFlirtIntensity(ctx: FlirtContext): FlirtIntensity {
  const { stage, bondScore, characterFlirtiness = 0.5, userInitiatedFlirt } = ctx;
  let intensity = STAGE_FLOOR[stage];

  if (bondScore >= 70) intensity = bump(intensity, 1);
  if (characterFlirtiness >= 0.75) intensity = bump(intensity, 1);
  if (characterFlirtiness <= 0.25) intensity = bump(intensity, -1);
  if (userInitiatedFlirt && intensity !== 'none') intensity = bump(intensity, 1);

  // A stranger/first-match floor of 'none' is a hard rule, not a tendency —
  // an eager player shouldn't be able to bond-score their way past consent
  // pacing this early.
  if (stage === 'stranger') return 'none';

  return intensity;
}

const INTENSITY_INSTRUCTIONS: Record<FlirtIntensity, string> = {
  none:
    'Do not flirt. Keep tone friendly and curious, nothing suggestive or teasing about attraction — it is too early for that in this relationship.',
  testing:
    'Voice: light, curious, testing the water. A single mild tease or compliment is fine, but read the room and do not escalate — this is about gauging mutual interest, not pursuing.',
  playful:
    'Voice: comfortable banter. Teasing, wordplay, call-backs to earlier jokes, mock-offense, playful compliments. Confident but never crude.',
  bold:
    'Voice: forward and confident. Can name attraction directly, initiate the flirting rather than just responding to it, and enjoy a little push-pull tension. Still playful, not aggressive.',
  unrestrained:
    'Voice: fully at ease flirting, no hedging or second-guessing. Can be openly bold, teasing, and affectionate in the same breath — this is a couple who already know they have each other.',
};

export function flirtStyleInstruction(intensity: FlirtIntensity): string {
  return INTENSITY_INSTRUCTIONS[intensity];
}

const BANTER_LINES: Record<FlirtIntensity, string[]> = {
  none: [],
  testing: [
    'a deadpan joke to see if you laugh',
    'pretending to be unimpressed, then cracking a smile',
    'a question that is a little more personal than the conversation called for',
  ],
  playful: [
    'stealing your line before you can say it',
    'a mock-serious "I have a complaint to file" about something small',
    'calling you by a nickname that did not exist five minutes ago',
  ],
  bold: [
    'flat-out telling you they like talking to you, no deflection after',
    'a challenge dressed up as a compliment ("bet you can\'t top that")',
    'leaning into a compliment instead of brushing it off',
  ],
  unrestrained: [
    'finishing an old joke between the two of you without explaining it',
    'teasing about something only the two of them would get',
    'flirting mid-sentence about something completely unrelated, just because',
  ],
};

export function pickBanterBeat(intensity: FlirtIntensity): string | null {
  const options = BANTER_LINES[intensity];
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)];
}

export interface FlirtPromptFragment {
  intensity: FlirtIntensity;
  styleInstruction: string;
  suggestedBeat: string | null;
}

/** Fail-open entry point — same posture as buildRomanceFragment. Called
 *  alongside it in the chat route; the two compose (romance = overall
 *  register, flirting = banter energy) rather than one overriding the other. */
export function buildFlirtFragment(ctx: FlirtContext): FlirtPromptFragment {
  const intensity = selectFlirtIntensity(ctx);
  return {
    intensity,
    styleInstruction: flirtStyleInstruction(intensity),
    suggestedBeat: pickBanterBeat(intensity),
  };
}

export function formatFlirtForPrompt(fragment: FlirtPromptFragment): string {
  if (fragment.intensity === 'none') return fragment.styleInstruction;
  return `Flirting energy (${fragment.intensity}): ${fragment.styleInstruction}` +
    (fragment.suggestedBeat ? ` A beat like this fits: ${fragment.suggestedBeat}.` : '');
}
