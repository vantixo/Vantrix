// src/lib/characters/export.ts
// ─────────────────────────────────────────────────────────────────────────────
// Builds a portable "character package" — everything a creator authored,
// nothing that's internal/system state. Used by the export API route and,
// later, an import path so packages can be re-created on another account or
// shared as a file outside the platform.
// ─────────────────────────────────────────────────────────────────────────────

import type { Database } from '@/types/supabase';

export type CharacterRow = Database['public']['Tables']['characters']['Row'];

export const CHARACTER_PACKAGE_FORMAT = 'vantrix-character-package';
export const CHARACTER_PACKAGE_VERSION = 1;

export interface CharacterExportPackage {
  format: typeof CHARACTER_PACKAGE_FORMAT;
  version: number;
  exportedAt: string;
  character: {
    name: string;
    age: number;
    gender: string;
    category: string;
    description: string;
    tags: string[];

    // Appearance
    appearance: {
      imageUrl: string;
      videoUrl: string | null;
      galleryImageUrls: string[] | null;
      galleryVideoUrls: string[] | null;
      hairColor: string | null;
      eyeColor: string | null;
      bodyType: string | null;
      skinTone: string | null;
      artStyle: string | null;
      clothing: string | null;
      visualSeed: string | null;
      faceReferencePrompt: string | null;
      generationStyle: string | null;
      loraModelId: string | null;       // reference only — re-training happens on import, not copied
    };

    // Brain / personality
    brain: {
      personality: string | null;
      archetype: string | null;
      speechStyle: string | null;
      attachmentStyle: string | null;
      loveLanguage: string | null;
      traits: { openness: number; warmth: number; adventure: number; depth: number };
      values: string[] | null;
      fears: string[] | null;
      flaws: string[] | null;
      dreams: string[] | null;
      currentGoal: string | null;
      dailyRoutine: string[] | null;
    };

    // Knowledge / backstory
    knowledge: {
      backstory: string | null;
      scenario: string | null;
      origin: string | null;
      occupation: string | null;
      familyBackground: string | null;
      childhoodBackground: string | null;
      secrets: string[] | null;
      friendsList: string[] | null;
      openingLine: string | null;
    };

    // Voice
    voice: {
      voiceProfile: Record<string, unknown> | null;
      writingStyle: Record<string, unknown> | null;
    };
  };
}

/**
 * Strips internal/system fields (ids, moderation state, monetization
 * settings, timestamps, live generation job ids) — a package should be
 * re-importable without carrying another account's ownership or in-flight
 * job references.
 */
export function buildCharacterExportPackage(character: CharacterRow): CharacterExportPackage {
  return {
    format: CHARACTER_PACKAGE_FORMAT,
    version: CHARACTER_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    character: {
      name: character.name,
      age: character.age,
      gender: character.gender,
      category: character.category ?? '',
      description: character.description,
      tags: character.tags ?? [],

      appearance: {
        imageUrl: character.image_url,
        videoUrl: character.video_url,
        galleryImageUrls: character.gallery_image_urls,
        galleryVideoUrls: character.gallery_video_urls,
        hairColor: character.hair_color,
        eyeColor: character.eye_color,
        bodyType: character.body_type,
        skinTone: character.skin_tone,
        artStyle: character.art_style,
        clothing: character.clothing,
        visualSeed: character.visual_seed,
        faceReferencePrompt: character.face_prompt,
        generationStyle: character.generation_style,
        loraModelId: character.lora_model_id,
      },

      brain: {
        personality: character.personality,
        archetype: character.archetype,
        speechStyle: character.speech_style,
        attachmentStyle: character.attachment_style,
        loveLanguage: character.love_language,
        traits: {
          openness: character.char_openness,
          warmth: character.char_warmth,
          adventure: character.char_adventure,
          depth: character.char_depth,
        },
        values: character.values_list,
        fears: character.fears,
        flaws: character.flaws,
        dreams: character.dreams,
        currentGoal: character.current_goal,
        dailyRoutine: character.daily_routine,
      },

      knowledge: {
        backstory: character.backstory,
        scenario: character.scenario,
        origin: character.origin,
        occupation: character.occupation,
        familyBackground: character.family_bg,
        childhoodBackground: character.childhood_bg,
        secrets: character.secrets,
        friendsList: character.friends_list,
        openingLine: character.opening_line,
      },

      voice: {
        voiceProfile: (character.voice_profile as Record<string, unknown> | null) ?? null,
        writingStyle: (character.writing_style as Record<string, unknown> | null) ?? null,
      },
    },
  };
}

export function packageFilename(character: Pick<CharacterRow, 'name' | 'id'>): string {
  const slug = character.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `${slug || 'character'}-${character.id.slice(0, 8)}.vantrix-character.json`;
}

/** Basic shape validation for a package on import — full field validation happens at insert time. */
export function isValidCharacterPackage(data: unknown): data is CharacterExportPackage {
  if (!data || typeof data !== 'object') return false;
  const pkg = data as Record<string, unknown>;
  return pkg.format === CHARACTER_PACKAGE_FORMAT && typeof pkg.version === 'number' && typeof pkg.character === 'object';
}
