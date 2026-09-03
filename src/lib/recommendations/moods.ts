// src/lib/recommendations/moods.ts
// ─────────────────────────────────────────────────────────────────────────────
// User-facing "how are you feeling right now?" moods for the Discover mood
// picker — distinct from a character's own evolving character_mood in
// dating_matches (see lib/dating/engine.ts). Split into this tiny file
// (rather than living in recommendations/engine.ts) specifically so
// client components can import the type/list without pulling in
// engine.ts's supabaseAdmin/server-only dependencies into the client
// bundle.
// ─────────────────────────────────────────────────────────────────────────────

export const USER_MOODS = [
  'playful', 'romantic', 'comforted', 'adventurous', 'intellectual', 'relaxed',
] as const;

export type UserMood = (typeof USER_MOODS)[number];

export function isUserMood(v: unknown): v is UserMood {
  return typeof v === 'string' && (USER_MOODS as readonly string[]).includes(v);
}

/** Short label + emoji for the mood picker UI. */
export const MOOD_LABELS: Record<UserMood, { label: string; emoji: string }> = {
  playful:      { label: 'Playful',      emoji: '😄' },
  romantic:     { label: 'Romantic',     emoji: '💕' },
  comforted:    { label: 'Comforted',    emoji: '🫂' },
  adventurous:  { label: 'Adventurous',  emoji: '🔥' },
  intellectual: { label: 'Intellectual', emoji: '🧠' },
  relaxed:      { label: 'Relaxed',      emoji: '😌' },
};
