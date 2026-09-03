/**
 * src/lib/ai/romance-engine.ts
 *
 * Romantic-intensity and romanticism-flavor engine.
 *
 * Adapted from an uploaded standalone "human brain" cognitive-architecture
 * script. That script was written as a therapy-simulator (tracked a
 * "rapport/trust" score that increased whenever the user disclosed pain,
 * shame, or fear; offered unlicensed "trauma processing" and diagnostic-
 * sounding cognitive-distortion labels). None of that was ported — it's
 * a bad fit for a paid companion product: it rewards emotional
 * vulnerability with more perceived closeness, which is a dependency-
 * exploiting pattern, not a feature, and prompt.ts already owns real
 * crisis handling (see the 988 / Nigeria hotline break-character block).
 *
 * What *was* kept and adapted: the reusable "romanticism" flavor —
 * longing/devotion intensity curves, poetic gesture and reframe language,
 * courtship-arc pacing — recast as pure text-generation flavoring that
 * feeds buildPromptInstructions()/assembleFullPrompt(), the same way
 * emotion-engine.ts and surprise-engine.ts do. It never scores or reacts
 * to the user's real-world vulnerability, and it never overrides the
 * crisis break-character path in prompt.ts.
 */

import type { EmotionalState } from './emotion-engine';

// ── Romantic register — how intensely devotional the character's voice is ──

export type RomanceRegister =
  | 'playful_flirt'   // early-stage teasing, low commitment
  | 'warm_affection'  // established, comfortable warmth
  | 'yearning'         // longing, distance, anticipation
  | 'devoted'          // deep declared attachment
  | 'swept_up';        // peak-intensity, classically "romantic novel" register

export interface RomanceContext {
  relationshipStageScore: number; // 0–1, from existing evolution-stage system
  daysSinceLastMessage: number;
  emotion: EmotionalState;
}

/** Pick a romantic register from existing relationship signals only —
 *  never from vulnerability/disclosure content. */
export function selectRomanceRegister(ctx: RomanceContext): RomanceRegister {
  const { relationshipStageScore, daysSinceLastMessage, emotion } = ctx;

  if (daysSinceLastMessage >= 1 && relationshipStageScore > 0.35) return 'yearning';
  if (relationshipStageScore >= 0.85) return 'swept_up';
  if (relationshipStageScore >= 0.6) return 'devoted';
  if (relationshipStageScore >= 0.3 || emotion.primary === 'love') return 'warm_affection';
  return 'playful_flirt';
}

// ── Poetic device library — prompt-injected style guidance, not literal
//    lines. The LLM writes its own dialogue; these are instructions about
//    *how*, mirroring the style of emotion-engine's buildPromptInstructions. ──

const REGISTER_INSTRUCTIONS: Record<RomanceRegister, string> = {
  playful_flirt:
    'Voice: light, teasing, a little breathless. Use short comebacks, gentle innuendo without being explicit, and curiosity about the user. Avoid heavy declarations — this stage is about charm, not depth.',
  warm_affection:
    'Voice: settled and fond. Reference shared history naturally. Use small tender gestures in narration (a hand reaching, a quiet smile) rather than grand declarations.',
  yearning:
    'Voice: wistful, aware of distance or time apart. Reference missing the user specifically — something they said or did — rather than generic longing. Keep it grounded, not desperate.',
  devoted:
    'Voice: openly attached and sure of it. Can name the relationship directly ("you\'re mine," "I choose you"). Confidence, not anxiety — devotion reads as security, not fear of loss.',
  swept_up:
    'Voice: full classic-romantic register — sensory, a little poetic, unguarded. Use vivid imagery (weather, light, physical closeness) but stay a beat this side of purple prose. This is the peak-intensity register; use sparingly and only at high relationship-stage scores.',
};

export function romanceStyleInstruction(register: RomanceRegister): string {
  return REGISTER_INSTRUCTIONS[register];
}

// ── Gesture/detail library for narration flavor (non-therapeutic reframe
//    concept from the source script, repurposed as romantic imagery rather
//    than a clinical technique). Selection is random flavor, not state. ──

const ROMANTIC_GESTURES: Record<RomanceRegister, string[]> = {
  playful_flirt: [
    'a raised eyebrow and a slow smile',
    'leaning in like they\'re about to share a secret, then not',
    'a playful nudge that lingers half a second too long',
  ],
  warm_affection: [
    'reaching over to fix your collar, not because it needed it',
    'saving you the last bite without being asked',
    'a hand finding yours during a lull in conversation',
  ],
  yearning: [
    'rereading your last message before falling asleep',
    'catching a song that sounds like something you\'d send',
    'the empty side of the bed feeling more empty than usual',
  ],
  devoted: [
    'introducing you without hesitation, like it\'s obvious',
    'a hand at the small of your back in a crowded room',
    'making room in plans without needing to ask first',
  ],
  swept_up: [
    'forehead against yours, breathing the same air for a moment',
    'the kind of quiet where neither of you needs to fill it',
    'a slow dance to no music, just because',
  ],
};

export function pickRomanticGesture(register: RomanceRegister): string {
  const options = ROMANTIC_GESTURES[register];
  return options[Math.floor(Math.random() * options.length)];
}

// ── Public entry point ──────────────────────────────────────────────────

export interface RomancePromptFragment {
  register: RomanceRegister;
  styleInstruction: string;
  suggestedGesture: string;
}

/** Called from the chat route alongside emotionEngine — purely additive,
 *  never gates or replaces the crisis break-character path in prompt.ts. */
export function buildRomanceFragment(ctx: RomanceContext): RomancePromptFragment {
  const register = selectRomanceRegister(ctx);
  return {
    register,
    styleInstruction: romanceStyleInstruction(register),
    suggestedGesture: pickRomanticGesture(register),
  };
}
