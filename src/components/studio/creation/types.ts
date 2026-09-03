/**
 * Character Creation Studio — shared draft state.
 *
 * Deliberately mirrors the real `characters` columns 1:1 (see
 * character-builder-form.tsx's toFormState() and characters/route.ts's
 * characterCreateSchema) rather than inventing a parallel shape — nothing
 * in this draft needs remapping when it's finally sent to
 * POST /api/characters + PATCH /api/characters/:id. The only fields here
 * that AREN'T real columns are `imageStyle` (the generate-image style
 * param, not stored) and `usedAI` (local UI state only).
 */

export interface VoiceTone {
  tone: number;
  energy: number;
  formality: number;
  humor: number;
}

export interface DraftMemory {
  key: string; // client-only id for list rendering, not sent to the API
  headline: string;
  content: string;
  category: string;
  importance: number;
}

export type Gender = "female" | "male" | "anime" | "other";
export type ImageStyle = "realistic" | "anime" | "artistic";
export type Visibility = "private" | "public";

export interface CharacterDraft {
  // ── Identity ──────────────────────────────────────────────
  name: string;
  age: number;
  gender: Gender;
  pronouns: string;
  occupation: string;
  origin: string;
  category: string;
  description: string;

  // ── Personality ───────────────────────────────────────────
  personality: string;
  archetype: string;
  attachment_style: string;
  love_language: string;
  char_openness: number;
  char_warmth: number;
  char_adventure: number;
  char_depth: number;
  values_list: string[];
  fears: string[];
  flaws: string[];
  dreams: string[];
  current_goal: string;
  daily_routine: string[];

  // ── Psychology & backstory ────────────────────────────────
  backstory: string;
  scenario: string;
  family_bg: string;
  childhood_bg: string;
  secrets: string[];
  friends_list: string[];
  opening_line: string;

  // ── Voice ─────────────────────────────────────────────────
  speech_style: string;
  voice: VoiceTone;
  speech_uses: string[];
  speech_avoids: string[];
  elevenlabs_voice_id: string;

  // ── Appearance ────────────────────────────────────────────
  hair_color: string;
  eye_color: string;
  body_type: string;
  skin_tone: string;
  imageStyle: ImageStyle;
  art_style: string;
  clothing: string;
  imageUrl: string | null;
  face_prompt: string;
  generation_style: string;
  identity_locked: boolean;

  // ── Memory ────────────────────────────────────────────────
  memories: DraftMemory[];

  // ── Publish ───────────────────────────────────────────────
  tags: string[];
  is_nsfw: boolean;
  dating_enabled: boolean;
  visibility: Visibility;

  // ── Provenance (local only until submit) ─────────────────
  creation_prompt: string;
  usedAI: boolean;
}

export function emptyDraft(): CharacterDraft {
  return {
    name: "",
    age: 24,
    gender: "female",
    pronouns: "",
    occupation: "",
    origin: "",
    category: "romance",
    description: "",

    personality: "",
    archetype: "",
    attachment_style: "",
    love_language: "",
    char_openness: 50,
    char_warmth: 50,
    char_adventure: 50,
    char_depth: 50,
    values_list: [],
    fears: [],
    flaws: [],
    dreams: [],
    current_goal: "",
    daily_routine: [],

    backstory: "",
    scenario: "",
    family_bg: "",
    childhood_bg: "",
    secrets: [],
    friends_list: [],
    opening_line: "",

    speech_style: "",
    voice: { tone: 50, energy: 50, formality: 50, humor: 50 },
    speech_uses: [],
    speech_avoids: [],
    elevenlabs_voice_id: "",

    hair_color: "",
    eye_color: "",
    body_type: "",
    skin_tone: "",
    imageStyle: "realistic",
    art_style: "",
    clothing: "",
    imageUrl: null,
    face_prompt: "",
    generation_style: "",
    identity_locked: false,

    memories: [],

    tags: [],
    is_nsfw: false,
    dating_enabled: false,
    visibility: "private",

    creation_prompt: "",
    usedAI: false,
  };
}

export const STAGES = [
  { id: "concept", label: "Concept" },
  { id: "identity", label: "Identity" },
  { id: "personality", label: "Personality" },
  { id: "psychology", label: "Psychology" },
  { id: "voice", label: "Voice" },
  { id: "appearance", label: "Appearance" },
  { id: "memory", label: "Memory" },
  { id: "preview", label: "Preview" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];
