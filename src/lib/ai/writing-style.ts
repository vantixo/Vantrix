/**
 * Writing Style + Voice Profile — Vantrix Silicon Valley
 *
 * personality-evolution.ts already drifts WHAT a character says (interests,
 * warmth, confidence). This module governs HOW it's said and how it sounds
 * — stable per-character traits, not something that evolves session to
 * session. A poet and a gamer at the same relationship stage should never
 * read or sound the same.
 *
 * Stored once on the characters table (writing_style jsonb column) at
 * character-creation time, not recomputed per turn.
 */

export interface WritingStyleProfile {
  sentence_length:  'short' | 'medium' | 'long' | 'varied';
  vocabulary:       'plain' | 'casual' | 'articulate' | 'niche_slang';
  humor:            'none' | 'dry' | 'playful' | 'sarcastic';
  emoji_usage:      'none' | 'rare' | 'occasional' | 'frequent';
  curiosity_level:  number; // 0-100 — how often they ask unprompted questions
  quirks:           string[]; // e.g. ["never uses periods", "trails off with ...", "always lowercase"]
  color:            string;   // hex — this character's stream color for UI
}

export interface VoiceProfile {
  pitch:  number; // -20..20 semitone-ish offset from a neutral baseline
  pace:   number; // 0.7..1.3, multiplier on base speech rate
  warmth: number; // 0-100 — affects TTS provider's "warmth"/timbre param if supported
  pauses: 'minimal' | 'natural' | 'deliberate'; // maps to SSML break tuning
  energy: number; // 0-100 — affects pitch variance / emphasis
}

export const WRITING_STYLE_PRESETS: Record<string, WritingStyleProfile> = {
  poet: {
    sentence_length: 'varied', vocabulary: 'articulate', humor: 'dry',
    emoji_usage: 'none', curiosity_level: 70,
    quirks: ['occasionally trails off mid-thought with —', 'favors imagery over direct statement'],
    color: '#C9A9E9',
  },
  gamer: {
    sentence_length: 'short', vocabulary: 'niche_slang', humor: 'sarcastic',
    emoji_usage: 'frequent', curiosity_level: 55,
    quirks: ['lowercase most of the time', 'uses "lol" / "ngl" naturally'],
    color: '#4FD1C5',
  },
  professor: {
    sentence_length: 'long', vocabulary: 'articulate', humor: 'dry',
    emoji_usage: 'none', curiosity_level: 85,
    quirks: ['occasionally self-corrects mid-sentence', 'asks precise follow-up questions'],
    color: '#8FA6C9',
  },
  girl_next_door: {
    sentence_length: 'medium', vocabulary: 'casual', humor: 'playful',
    emoji_usage: 'occasional', curiosity_level: 65,
    quirks: ['uses "haha" and "omg" naturally', 'asks how your day went unprompted'],
    color: '#F4A6C1',
  },
  companion: {
    sentence_length: 'short', vocabulary: 'plain', humor: 'none',
    emoji_usage: 'rare', curiosity_level: 60,
    quirks: ['favors short, gentle sentences over long ones', 'checks in on how you\'re feeling'],
    color: '#F0B8C8',
  },
};

export const VOICE_PRESETS: Record<string, VoiceProfile> = {
  poet:           { pitch: -2, pace: 0.85, warmth: 70, pauses: 'deliberate', energy: 35 },
  gamer:          { pitch: 3,  pace: 1.15, warmth: 55, pauses: 'minimal',    energy: 75 },
  professor:      { pitch: -4, pace: 0.9,  warmth: 60, pauses: 'natural',    energy: 40 },
  girl_next_door: { pitch: 5,  pace: 1.05, warmth: 85, pauses: 'natural',    energy: 65 },
  // Soft, unhurried, low-energy — a calm presence rather than an entertainer.
  // Slower pace + longer pauses read as "listening" rather than "performing."
  companion:      { pitch: 1,  pace: 0.88, warmth: 92, pauses: 'deliberate', energy: 30 },
};

/** Format a style profile into the system-prompt instruction block. */
export function formatWritingStyleForPrompt(style: WritingStyleProfile): string {
  const lines = [
    '── Writing Style (how you write, distinct from what you say) ──',
    `Sentence length: ${style.sentence_length}`,
    `Vocabulary: ${style.vocabulary}`,
    `Humor: ${style.humor}`,
    `Emoji usage: ${style.emoji_usage}`,
  ];
  if (style.curiosity_level >= 60) lines.push('You ask unprompted questions often — genuine curiosity about them.');
  if (style.quirks.length) lines.push(`Quirks: ${style.quirks.join('; ')}`);
  return lines.join('\n');
}

/** Map a preset's VoiceProfile into TTS request params (route already accepts voiceId/gender — extend with these). */
export function toTtsParams(voice: VoiceProfile) {
  return {
    pitch_semitones: voice.pitch,
    speaking_rate:   voice.pace,
    warmth:          voice.warmth,
    pause_style:     voice.pauses,
    energy:          voice.energy,
  };
}
