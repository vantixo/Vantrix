import "server-only";
import { fetchInternal } from "./api";

/**
 * Mirrors GET /api/characters/:id's response exactly (see that route's
 * own comment: backs "the 5 Creator Studio builders — Brain / Knowledge
 * / Voice / Appearance — Memory has its own route"). That route does a
 * real ownership check (canEdit) and strips admin-only private gallery
 * fields before responding, so per §10 this goes through fetchInternal
 * rather than a direct table query.
 */
export interface EditableCharacter {
  id: string;
  name: string;
  image_url: string;
  is_public: boolean;
  moderation_status: string;
  lora_training_status: string | null;
  lora_training_error: string | null;
  video_status: string;
  video_error: string | null;
  gallery_image_urls: string[] | null;

  // Brain
  personality: string | null;
  archetype: string | null;
  attachment_style: string | null;
  love_language: string | null;
  char_openness: number;
  char_warmth: number;
  char_adventure: number;
  char_depth: number;
  values_list: string[] | null;
  fears: string[] | null;
  flaws: string[] | null;
  dreams: string[] | null;
  current_goal: string | null;
  daily_routine: string[] | null;

  // Knowledge
  backstory: string | null;
  scenario: string | null;
  origin: string | null;
  occupation: string | null;
  family_bg: string | null;
  childhood_bg: string | null;
  secrets: string[] | null;
  friends_list: string[] | null;
  opening_line: string | null;

  // Voice
  speech_style: string | null;
  voice_profile: Record<string, unknown> | null;
  writing_style: Record<string, unknown> | null;
  // Real ElevenLabs voice id — see src/lib/ai/voice-library.ts. null means
  // "no manual override," so /api/voice/tts falls back to the character's
  // gender-bucket default.
  elevenlabs_voice_id: string | null;

  // Appearance
  hair_color: string | null;
  eye_color: string | null;
  body_type: string | null;
  skin_tone: string | null;
  art_style: string | null;
  clothing: string | null;
  face_prompt: string | null;
  generation_style: string | null;
}

export async function getEditableCharacter(
  id: string
): Promise<EditableCharacter | null> {
  try {
    const body = await fetchInternal<{ character: EditableCharacter }>(
      `/api/characters/${id}`
    );
    return body.character;
  } catch {
    return null;
  }
}

export interface SeedMemoryRow {
  id: string;
  category: string;
  headline: string;
  content: string;
  importance: number;
  position: number;
}

export async function getCharacterMemories(id: string): Promise<SeedMemoryRow[]> {
  try {
    const body = await fetchInternal<{ memories: SeedMemoryRow[] }>(
      `/api/characters/${id}/memories`
    );
    return body.memories ?? [];
  } catch {
    return [];
  }
}
