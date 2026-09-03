import { generateScene, uploadToR2 } from "@/lib/fal/lora-pipeline";
import { logger } from "@/lib/logger";
import { buildAppearancePrompt, hasTrainedLora, type CharacterBibleRow } from "./character-bible";

export interface ContentImageResult {
  success: boolean;
  imageUrl?: string;
  seed?: number;
  costUsd?: number;
  error?: string;
}

/**
 * Generates a premium gallery image for a character, staying on-model via
 * the character's trained LoRA + canon appearance fields.
 *
 * allowMature is intentionally NOT exposed here — this function always
 * generates with Fal's safety checker ON. Character-level premium galleries
 * are shown to many users under a tier gate, not to one individually
 * age-verified + opted-in user the way a 1:1 chat image is, so the same
 * per-user verification generateScene() requires for allowMature=true does
 * not apply here. If mature character galleries are wanted later, that
 * needs its own explicit legal/compliance review — not a flag flip here.
 */
export async function generateCharacterImage(
  character: CharacterBibleRow,
  scenePrompt: string,
): Promise<ContentImageResult> {
  if (!hasTrainedLora(character)) {
    return {
      success: false,
      error: "Character has no trained LoRA model yet — train one before generating on-model images.",
    };
  }

  const facePrompt = buildAppearancePrompt(character);

  try {
    const result = await generateScene({
      characterSlug: character.id,
      loraModelId: character.lora_model_id!,
      facePrompt,
      scenePrompt,
      seed: character.visual_seed ? parseInt(character.visual_seed, 10) || undefined : undefined,
      imageSize: "portrait_4_3",
      allowMature: false,
    });

    if (!result.success || !result.imageUrl) {
      return { success: false, error: result.error ?? "generation returned no image" };
    }

    // Fal's returned URL is temporary and can expire before an admin
    // reviews/approves the queued content-engine item — persist it to R2
    // immediately, same pattern as generateCharacterVideo() and the LoRA
    // canon-scene pipeline. If the R2 upload fails, treat the whole
    // generation as failed rather than queuing a review row that will
    // eventually 404.
    const key = `content-engine/${character.id}/${Date.now()}.jpg`;
    const uploaded = await uploadToR2(result.imageUrl, key, "image/jpeg");

    if (!uploaded.success || !uploaded.r2Url) {
      logger.error("content-engine: R2 upload failed for generated image", {
        error: uploaded.error,
        characterId: character.id,
      });
      return { success: false, error: uploaded.error ?? "R2 upload failed" };
    }

    return {
      success: true,
      imageUrl: uploaded.r2Url,
      seed: result.seed,
      costUsd: result.costUsd,
    };
  } catch (err) {
    logger.error("content-engine: generateCharacterImage failed", {
      error: String(err),
      characterId: character.id,
    });
    return { success: false, error: err instanceof Error ? err.message : "generation failed" };
  }
}

/** A small rotating set of scene prompts used for automatic/cron generation. */
export const DEFAULT_SCENE_PROMPTS = [
  "relaxed candid portrait, natural indoor lighting, soft smile",
  "outdoor golden-hour portrait, casual outfit, warm atmosphere",
  "cozy evening scene, ambient lighting, thoughtful expression",
  "lifestyle photo, everyday setting, genuine candid moment",
];
