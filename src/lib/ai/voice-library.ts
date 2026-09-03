/**
 * Voice Library — Vantrix
 *
 * Single source of truth for "which real ElevenLabs voice does this
 * character actually sound like." Zero imports — safe in both server
 * (digital-person-bootstrap.ts, voice/tts route) and client (Studio's
 * voice picker) bundles.
 *
 * BEFORE THIS MODULE: /api/voice/tts had exactly 3 hardcoded voices
 * (Rachel/Adam/Bella) keyed only by a `gender` bucket, and the client
 * never even sent `gender` — so in practice every character in the app,
 * regardless of who they were, was voiced as "Rachel." voice_profile
 * (pitch/pace/warmth) only shaped stability/style on top of that one
 * shared voice; it never changed WHICH voice was speaking. This module
 * is what actually gives each character a distinct, real voice identity.
 *
 * IDs are ElevenLabs' classic premade-voice-library IDs — the same
 * family as the 3 already hardcoded elsewhere in this codebase before
 * this change, cross-checked against ElevenLabs' current voice docs as
 * of this writing. Voice availability can still vary by ElevenLabs
 * account/plan and IDs can be deprecated on their end — if a stored ID
 * ever 404s, /api/voice/tts already fails open to the Web Speech
 * fallback (see that route's circuit-breaker path), so a stale ID
 * degrades gracefully rather than breaking voice messages outright.
 * Sanity-check against GET https://api.elevenlabs.io/v1/voices for your
 * account before relying on this list in production.
 */

export interface VoiceLibraryEntry {
  id:          string;   // ElevenLabs voice_id
  name:        string;   // display name in the Studio picker
  gender:      'female' | 'male';
  description: string;   // one-line timbre/energy hint, shown next to the name
}

export const VOICE_LIBRARY: readonly VoiceLibraryEntry[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel',  gender: 'female', description: 'Calm, warm, even-paced — natural narrator' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',   gender: 'female', description: 'Soft, youthful, friendly' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi',    gender: 'female', description: 'Strong, confident, energetic' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli',    gender: 'female', description: 'Emotional, expressive, gentle' },
  { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', gender: 'female', description: 'Pleasant, precise, articulate' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',    gender: 'male',   description: 'Deep, rich, grounded' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni',  gender: 'male',   description: 'Well-rounded, warm, professional' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold',  gender: 'male',   description: 'Crisp, confident, assured' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh',    gender: 'male',   description: 'Deep, authoritative, steady' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam',     gender: 'male',   description: 'Raspy, casual, easygoing' },
] as const;

export function voiceLibraryEntry(id: string | null | undefined): VoiceLibraryEntry | undefined {
  if (!id) return undefined;
  return VOICE_LIBRARY.find(v => v.id === id);
}

export const VOICE_LIBRARY_BY_GENDER = {
  female: VOICE_LIBRARY.filter(v => v.gender === 'female'),
  male:   VOICE_LIBRARY.filter(v => v.gender === 'male'),
} as const;

/**
 * Gender-bucket fallback used only when a character has no
 * elevenlabs_voice_id of its own yet (pre-migration rows that haven't
 * been backfilled, or a request that arrives before bootstrap finishes).
 * 'anime' reuses Bella — brighter/younger read — same as the original
 * 3-voice default before this module existed.
 */
export const DEFAULT_ELEVENLABS_VOICE_IDS: Record<'female' | 'male' | 'anime', string> = {
  female: '21m00Tcm4TlvDq8ikWAM', // Rachel
  male:   'pNInz6obpgDQGcFmaJgB', // Adam
  anime:  'EXAVITQu4vr4xnSDxMaL', // Bella
};

/**
 * Deterministic per-archetype voice assignment — mirrors the exact same
 * 5 keyword-matched archetypes digital-person-bootstrap.ts already uses
 * for writing_style/voice_profile (see selectPreset() there and
 * WRITING_STYLE_PRESETS/VOICE_PRESETS in writing-style.ts), so a
 * character's voice, writing style, and personality preset are always
 * chosen from the same read of who they are — never three unrelated
 * dice rolls. Picked so no two archetypes share a voice within a gender.
 */
export const ARCHETYPE_VOICE_IDS: Record<string, { female: string; male: string }> = {
  poet:            { female: '21m00Tcm4TlvDq8ikWAM', male: 'ErXwobaYiN019PkySvjV' }, // Rachel / Antoni — calm, warm, low energy
  gamer:           { female: 'AZnzlk1XvdvUeBnXmlld', male: 'yoZ06aMxZJJ28mfd3POQ' }, // Domi / Sam — energetic, casual
  professor:       { female: 'ThT5KcBeYPX3keUQqHPh', male: 'VR6AewLTigWG4xSOukaG' }, // Dorothy / Arnold — precise, articulate
  girl_next_door:  { female: 'EXAVITQu4vr4xnSDxMaL', male: 'pNInz6obpgDQGcFmaJgB' }, // Bella / Adam — warm, approachable
  companion:       { female: 'MF3mGyEYCl7XYWbV9V6O', male: 'TxGEqnHWrfWFTfGW9XjX' }, // Elli / Josh — gentle, soothing
};

/**
 * Resolve the voice a character should get at creation time. `gender` is
 * the character's own `characters.gender` value ('female' | 'male' |
 * 'anime' | 'other' | anything else) — 'anime' and 'other' fall back to
 * the female slot, matching DEFAULT_ELEVENLABS_VOICE_IDS's existing
 * 'anime' → Bella behavior since 'anime' has no separate archetype track.
 */
export function resolveVoiceId(archetypeKey: string | null, gender: string | null | undefined): string {
  const slot: 'female' | 'male' = gender === 'male' ? 'male' : 'female';
  if (archetypeKey && archetypeKey in ARCHETYPE_VOICE_IDS) {
    return ARCHETYPE_VOICE_IDS[archetypeKey][slot];
  }
  return DEFAULT_ELEVENLABS_VOICE_IDS[slot];
}
