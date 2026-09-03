/**
 * Character Bible — the single source of truth the content engine reads
 * from to keep generated images, chat lines, and video consistent with a
 * character's existing canon. Deliberately does NOT introduce a new place
 * to define personality/appearance — it composes from fields that already
 * exist on `characters` (set during character creation) plus the optional
 * `style_guide_notes` admins can layer on top. This means editing a
 * character's canon in the normal creator flow automatically updates what
 * the content engine generates next — there's no second copy to fall out
 * of sync.
 */

export interface CharacterBibleRow {
  id: string;
  name: string;
  gender: string;
  age: number | null;
  ethnicity: string | null;
  height: string | null;
  body_type: string | null;
  face_shape: string | null;
  eye_color: string | null;
  hair_color: string | null;
  hair_style: string | null;
  skin_tone: string | null;
  signature_items: string[] | null;
  art_style: string | null;
  clothing: string | null;
  description: string;
  personality: string | null;
  archetype: string | null;
  speech_style: string | null;
  char_openness: number;
  char_warmth: number;
  char_adventure: number;
  char_depth: number;
  canon_sheet_url: string | null;
  visual_seed: string | null;
  lora_model_id: string | null;
  lora_trained_at: string | null;
  is_nsfw: boolean;
  style_guide_notes: string | null;
}

/** Trait axis (0-100) -> short descriptor, used in text generation prompts. */
function traitWord(value: number, low: string, high: string): string {
  if (value >= 70) return high;
  if (value <= 30) return low;
  return "balanced";
}

/**
 * Canonical appearance description — the "face prompt" fed to image/video
 * generation so every piece of content depicts the same person. This is
 * what generateScene() expects as `facePrompt`.
 */
export function buildAppearancePrompt(c: CharacterBibleRow): string {
  const parts = [
    c.age ? `${c.age}-year-old` : undefined,
    c.ethnicity ?? undefined,
    c.gender,
    c.body_type ? `${c.body_type} build` : undefined,
    c.face_shape ? `${c.face_shape} face` : undefined,
    c.eye_color ? `${c.eye_color} eyes` : undefined,
    c.hair_color && c.hair_style ? `${c.hair_color} ${c.hair_style} hair` : c.hair_color ?? undefined,
    c.skin_tone ? `${c.skin_tone} skin` : undefined,
    c.signature_items?.length ? `signature items: ${c.signature_items.join(", ")}` : undefined,
    c.clothing ? `wearing ${c.clothing}` : undefined,
    c.art_style ? `${c.art_style} art style` : undefined,
  ].filter(Boolean);

  return parts.join(", ");
}

/**
 * Personality/voice summary for text generation (chat line variety) —
 * keeps generated lines sounding like the same character rather than a
 * generic assistant.
 */
export function buildVoiceProfile(c: CharacterBibleRow): string {
  const traits = [
    traitWord(c.char_openness, "guarded", "open"),
    traitWord(c.char_warmth, "reserved", "warm"),
    traitWord(c.char_adventure, "cautious", "adventurous"),
    traitWord(c.char_depth, "playful/light", "introspective"),
  ];

  return [
    `${c.name}, ${c.archetype ?? "a companion character"}.`,
    c.personality ? `Personality: ${c.personality}` : undefined,
    `Speech style: ${c.speech_style ?? "warm"}.`,
    `Trait mix: ${traits.join(", ")}.`,
    c.description,
    c.style_guide_notes ? `Additional style guidance: ${c.style_guide_notes}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

/** True if this character has a trained LoRA — required for on-model image/video generation. */
export function hasTrainedLora(c: Pick<CharacterBibleRow, "lora_model_id">): boolean {
  return !!c.lora_model_id;
}
