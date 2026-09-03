// src/lib/characters/import.ts
// ─────────────────────────────────────────────────────────────────────────────
// The other half of @/lib/characters/export — takes a validated
// CharacterExportPackage and produces the row (minus id/creator_id/system
// state) to insert for a *new* character owned by the importing user.
//
// Mirrors buildCharacterExportPackage() field-for-field in reverse. Anything
// the export strips (ids, moderation state, monetization, timestamps, live
// job ids) is re-derived fresh here rather than trusted from the package —
// a package is untrusted input, even one exported from this same platform.
// ─────────────────────────────────────────────────────────────────────────────

import type { CharacterExportPackage } from './export';
import type { Json } from '@/types/supabase';
import { sanitizeField, sanitizeArray } from '@/lib/sanitize';

/** Trusted image hosts a package's imageUrl is allowed to reference directly.
 *  Kept in sync with the allowlist in POST /api/characters — duplicated
 *  rather than imported because route.ts files only export HTTP handlers. */
const ALLOWED_IMPORT_IMAGE_HOSTS = new Set([
  'cdn.vantrix.ink',
  'images.unsplash.com',
  'lh3.googleusercontent.com',
  'ui-avatars.com',
  'avatars.githubusercontent.com',
  'cdn.discordapp.com',
  'storage.googleapis.com',
  'res.cloudinary.com',
]);

function safeImageUrl(url: string | null | undefined, name: string, extraHost?: string): string {
  if (url) {
    try {
      const { hostname } = new URL(url);
      if (ALLOWED_IMPORT_IMAGE_HOSTS.has(hostname) || hostname === extraHost) return url;
    } catch {
      // fall through to placeholder
    }
  }
  // Package came from an untrusted or foreign-hosted image — never insert an
  // arbitrary URL, fall back to a generated avatar like the creation wizard does.
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=7c3aed&color=ffffff&size=512`;
}

const arrOrNull = (v: unknown): string[] | null =>
  Array.isArray(v) ? sanitizeArray(v as string[], 20, 200) : null;

/**
 * Builds the full insert payload for a new character from an imported
 * package. Caller is responsible for: auth, isValidCharacterPackage() check,
 * moderation, token charge, and the actual supabaseAdmin insert.
 */
export function characterInsertFromPackage(
  pkg: CharacterExportPackage,
  userId: string,
  opts?: { r2Host?: string },
) {
  const c = pkg.character;
  const name = sanitizeField(c.name ?? 'Imported Character', 80);

  return {
    // ── Core ──────────────────────────────────────────────────────────────
    name,
    age: typeof c.age === 'number' ? Math.min(Math.max(Math.round(c.age), 18), 100) : 18,
    gender: (['female', 'male', 'anime', 'other'] as const).includes(c.gender as 'female' | 'male' | 'anime' | 'other')
      ? c.gender
      : 'other',
    category: sanitizeField(c.category || 'other', 50),
    description: sanitizeField(c.description || `An imported character named ${name}.`, 1000),
    tags: arrOrNull(c.tags)?.slice(0, 10) ?? [],

    // ── Appearance ────────────────────────────────────────────────────────
    image_url: safeImageUrl(c.appearance?.imageUrl, name, opts?.r2Host),
    video_url: null, // re-animation runs fresh on import, never carries over another account's video job
    gallery_image_urls: null,
    gallery_video_urls: null,
    hair_color: c.appearance?.hairColor ? sanitizeField(c.appearance.hairColor, 100) : null,
    eye_color: c.appearance?.eyeColor ? sanitizeField(c.appearance.eyeColor, 100) : null,
    body_type: c.appearance?.bodyType ? sanitizeField(c.appearance.bodyType, 100) : null,
    skin_tone: c.appearance?.skinTone ? sanitizeField(c.appearance.skinTone, 100) : null,
    art_style: c.appearance?.artStyle ? sanitizeField(c.appearance.artStyle, 100) : null,
    clothing: c.appearance?.clothing ? sanitizeField(c.appearance.clothing, 200) : null,
    visual_seed: c.appearance?.visualSeed ? sanitizeField(c.appearance.visualSeed, 200) : null,
    face_prompt: c.appearance?.faceReferencePrompt ? sanitizeField(c.appearance.faceReferencePrompt, 1000) : null,
    generation_style: c.appearance?.generationStyle ? sanitizeField(c.appearance.generationStyle, 100) : null,
    // lora_model_id intentionally NOT copied — a LoRA is trained per-account image
    // history; re-training (not reuse) happens if/when the importer regenerates art.
    lora_model_id: null,

    // ── Brain ─────────────────────────────────────────────────────────────
    personality: c.brain?.personality ? sanitizeField(c.brain.personality, 2000) : null,
    archetype: c.brain?.archetype ? sanitizeField(c.brain.archetype, 200) : null,
    speech_style: c.brain?.speechStyle ? sanitizeField(c.brain.speechStyle, 200) : null,
    attachment_style: c.brain?.attachmentStyle ? sanitizeField(c.brain.attachmentStyle, 200) : null,
    love_language: c.brain?.loveLanguage ? sanitizeField(c.brain.loveLanguage, 200) : null,
    char_openness: clampTrait(c.brain?.traits?.openness),
    char_warmth: clampTrait(c.brain?.traits?.warmth),
    char_adventure: clampTrait(c.brain?.traits?.adventure),
    char_depth: clampTrait(c.brain?.traits?.depth),
    values_list: arrOrNull(c.brain?.values),
    fears: arrOrNull(c.brain?.fears),
    flaws: arrOrNull(c.brain?.flaws),
    dreams: arrOrNull(c.brain?.dreams),
    current_goal: c.brain?.currentGoal ? sanitizeField(c.brain.currentGoal, 500) : null,
    daily_routine: arrOrNull(c.brain?.dailyRoutine),

    // ── Knowledge ─────────────────────────────────────────────────────────
    backstory: c.knowledge?.backstory ? sanitizeField(c.knowledge.backstory, 5000) : null,
    scenario: c.knowledge?.scenario ? sanitizeField(c.knowledge.scenario, 2000) : null,
    origin: c.knowledge?.origin ? sanitizeField(c.knowledge.origin, 500) : null,
    occupation: c.knowledge?.occupation ? sanitizeField(c.knowledge.occupation, 200) : null,
    family_bg: c.knowledge?.familyBackground ? sanitizeField(c.knowledge.familyBackground, 2000) : null,
    childhood_bg: c.knowledge?.childhoodBackground ? sanitizeField(c.knowledge.childhoodBackground, 2000) : null,
    secrets: arrOrNull(c.knowledge?.secrets),
    friends_list: arrOrNull(c.knowledge?.friendsList),
    opening_line: c.knowledge?.openingLine ? sanitizeField(c.knowledge.openingLine, 500) : null,

    // ── Voice ─────────────────────────────────────────────────────────────
    voice_profile: (c.voice?.voiceProfile ?? null) as unknown as Json,
    writing_style: (c.voice?.writingStyle ?? null) as unknown as Json,

    // ── System / ownership (never trusted from the package) ────────────────
    creator_id: userId,
    active: false,
    is_public: false,
    moderation_status: 'pending' as const,
    dating_enabled: false,
    is_new: true,
    is_premium: false,
    tokens_cost: 1,
    like_count: 0,
    total_swipes: 0,
  };
}

function clampTrait(v: number | null | undefined): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return 50;
  return Math.min(Math.max(Math.round(v), 0), 100);
}
