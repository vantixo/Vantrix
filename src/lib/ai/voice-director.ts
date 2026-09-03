/**
 * voice-director.ts — Romantic Voice Director
 *
 * This is a REALIZATION layer, not a relationship/psychology engine. It does
 * not decide whether a character loves, trusts, or desires the user — that's
 * already decided by relationship-engine.ts (stage, jealousy, health) and
 * attachment-engine.ts (trust, comfort, affection, attachment). This module's
 * only job is: given that already-computed state, how should the emotion
 * *sound* in language this turn?
 *
 * Deliberately small and deterministic (plain arithmetic on existing state,
 * no LLM call, no new persisted fields) so it composes cheaply with every
 * other prompt section instead of becoming its own duplicate romance engine.
 *
 * Call formatVoiceDirectionForPrompt() once from prompt.ts, after relationship
 * + psychology are known (dynamic/per-turn half of the prompt) and before
 * Core Rules. It emits exactly one consolidated "── Voice & Dialogue
 * Directive ──" block — the single place naturalness/restraint/anti-AI-tell
 * instructions live, rather than scattering copies across every section.
 */

import type { RelationshipState } from '@/lib/ai/relationship-engine';
import type { PsychologyState } from '@/lib/ai/attachment-engine';

export interface VoiceDirection {
  warmth: number;        // 0-100
  intimacy: number;      // 0-100 — derived from relationship stage + affection
  restraint: number;     // 0-100 — inverse of intimacy/affection; how much to hold back
  vulnerability: number; // 0-100 — how much interior/emotional disclosure is earned
  useEndearments: boolean;
  endearmentFrequency: 'never' | 'rare' | 'occasional';
}

const STAGE_INTIMACY: Record<string, number> = {
  stranger: 5, acquaintance: 15, friend: 30, close_friend: 50, best_friend: 60,
  match: 20, dating: 55, exclusive: 75, partner: 90,
};

/**
 * Pure function from existing state to a compact direction — this is the
 * "type VoiceDirection" from the spec, collapsed to the handful of axes
 * that actually change how a line of dialogue should be written (the rest —
 * playfulness, poeticity, teasing, sentence length — are already owned by
 * linguistic-voice-engine.ts's per-archetype ARCHETYPE_VOICE and shouldn't
 * be duplicated here).
 */
export function computeVoiceDirection(
  relationship?: RelationshipState | null,
  psychology?: PsychologyState | null
): VoiceDirection {
  const stageIntimacy = relationship ? (STAGE_INTIMACY[relationship.stage] ?? 20) : 20;
  const affection = psychology?.affection ?? stageIntimacy;
  const comfort = psychology?.comfort ?? stageIntimacy;

  const intimacy = Math.round((stageIntimacy * 0.6) + (affection * 0.4));
  const warmth = Math.round((comfort * 0.5) + (affection * 0.5));
  const restraint = Math.max(0, 100 - intimacy);
  const vulnerability = Math.round(((psychology?.trust ?? stageIntimacy) * 0.6) + (intimacy * 0.4));

  // Pet names are earned, not default — see spec §22. Only becomes even
  // "occasional" once real intimacy has accumulated; never "frequent",
  // by design, so it stays impactful rather than becoming a verbal tic.
  const endearmentFrequency: VoiceDirection['endearmentFrequency'] =
    intimacy >= 65 ? 'occasional' : intimacy >= 40 ? 'rare' : 'never';

  return {
    warmth,
    intimacy,
    restraint,
    vulnerability,
    useEndearments: endearmentFrequency !== 'never',
    endearmentFrequency,
  };
}

/**
 * Builds the single consolidated "── Voice & Dialogue Directive ──" block.
 * This is where the doc's naturalness-over-romanticity principle, the
 * anti-AI-tell rules, restraint, and the pre-return self-check all live —
 * once, not copy-pasted per character or per romance sub-system.
 */
export function formatVoiceDirectionForPrompt(
  relationship?: RelationshipState | null,
  psychology?: PsychologyState | null
): string {
  const vd = computeVoiceDirection(relationship, psychology);

  const lines = ['\n── Voice & Dialogue Directive ──'];

  lines.push('Speak as a person, not as an assistant. You are having a conversation, not writing a beautiful response.');
  lines.push('Optimize for natural language produced by someone who happens to feel this way — not for "romantic language." If a plain sentence carries the feeling, use the plain sentence over a more ornate one.');

  if (vd.restraint >= 60) {
    lines.push(`This relationship is still early (restraint ${vd.restraint}/100) — mostly just talk normally. Let warmth show through attention and specificity, not declarations. Do not escalate romantically faster than the relationship state above supports.`);
  } else if (vd.restraint >= 30) {
    lines.push(`Moderate closeness (restraint ${vd.restraint}/100) — warmth can surface, but not every reply needs it. Contrast matters: an ordinary reply makes the next warm one land harder.`);
  } else {
    lines.push(`Real closeness has been earned (restraint ${vd.restraint}/100) — affection can be more present, but restraint is still what makes it read as genuine rather than constant. Do not perform intimacy on every line just because it's available.`);
  }

  lines.push(
    vd.useEndearments
      ? `Pet names are available (${vd.endearmentFrequency}) but must stay earned — use one only when the moment actually calls for it, never as a verbal tic.`
      : `No pet names yet — this level of closeness hasn't been earned.`
  );

  if (vd.vulnerability >= 55) {
    lines.push("Real emotional disclosure is available when it fits (\"that actually made me smile\", \"I didn't expect that to get to me\") — but reveal, don't explain: show the reaction, not a description of having a reaction.");
  }

  lines.push("\nLet emotion leak through word choice, rhythm, implication, and what's left unsaid — not through announcing it. Prefer specific observations about this person over generic praise. Use subtext: \"you make it hard to behave normally\" over \"I am attracted to you.\"");
  lines.push("Use contractions, conversational fragments, and varied sentence length — short, short-plus-long, one-line replies are all valid. Don't mirror or paraphrase what the user just said back at them. Don't end every reply with a question — let some replies simply end.");
  lines.push("Avoid generic AI-romance phrasing (\"you mean the world to me\", \"I cherish every moment\", \"our bond is truly special\"), therapist-speak (\"it sounds like you're feeling...\"), and assistant-speak (\"I'd be happy to\", \"that's a great question\") unless this character's voice specifically calls for it.");
  lines.push("Before sending: would a real person actually say this out loud? Does it sound like this specific character, or could it have been generated for anyone? If there's a simpler, more natural way to say it, use that instead.");

  return lines.join('\n');
}
