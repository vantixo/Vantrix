/**
 * Entity Image Generator — locations and factions.
 *
 * generateCharacterImage (generate-image.ts) requires a trained LoRA
 * because a character's face has to stay identical across every image.
 * Locations and factions have no "identity" to lock — a city just needs to
 * look like a coherent place, and a faction just needs a symbol/scene that
 * reads as its ideology — so this uses generateBaseImage() (plain Fal
 * text-to-image, no LoRA) instead of generateScene().
 *
 * This is the fix for "every single thing must have an image in all
 * references": world_locations and factions had zero image columns before
 * this file existed (see the accompanying migration) — every card/detail
 * page referencing a city or faction was text-only.
 */

import { generateBaseImage } from "@/lib/fal/lora-pipeline";
import { uploadUrlToR2 } from "@/lib/storage/r2";
import { logger } from "@/lib/logger";
import type { WorldLocation } from "@/types/world-expansion";

export interface EntityImageResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

const ART_STYLE =
  "cinematic digital painting, richly detailed, atmospheric lighting, consistent fantasy-noir Vantrix visual identity, no text, no watermark, no logo";

/** Minimal shape generateFactionImage needs — avoids importing the full FactionSummary type here. */
export interface FactionForImage {
  id: string;
  name: string;
  ideology: string;
  description: string | null;
  sigil_description: string | null;
  culture: string;
}

function buildLocationPrompt(loc: Pick<WorldLocation, "name" | "archetype" | "description" | "culture" | "government_type" | "is_capital">): string {
  const parts = [
    `establishing shot of "${loc.name}", a ${loc.is_capital ? "capital " : ""}${loc.archetype}`,
    loc.description,
    `${loc.culture} culture, governed as a ${loc.government_type}`,
    "wide environmental establishing shot, no people in focus, sense of scale and place",
    ART_STYLE,
  ].filter(Boolean);
  return parts.join(", ");
}

function buildFactionPrompt(f: FactionForImage): string {
  const parts = [
    `symbolic emblem/banner scene representing the faction "${f.name}"`,
    f.sigil_description ? `sigil: ${f.sigil_description}` : undefined,
    `ideology: ${f.ideology}`,
    f.description ?? undefined,
    `${f.culture} aesthetic`,
    "heraldic symbolism, dramatic lighting, no readable text, no watermark",
    ART_STYLE,
  ].filter(Boolean);
  return parts.join(", ");
}

async function persist(imageUrl: string, key: string): Promise<EntityImageResult> {
  const uploaded = await uploadUrlToR2(imageUrl, key, "image/jpeg");
  if (!uploaded.success || !uploaded.r2Url) {
    return { success: false, error: uploaded.error ?? "R2 upload failed" };
  }
  return { success: true, imageUrl: uploaded.r2Url };
}

export async function generateLocationImage(
  loc: Pick<WorldLocation, "id" | "name" | "archetype" | "description" | "culture" | "government_type" | "is_capital">,
): Promise<EntityImageResult> {
  try {
    const result = await generateBaseImage({
      prompt: buildLocationPrompt(loc),
      imageSize: "landscape_16_9",
      steps: 32,
    });
    if (!result.success || !result.imageUrl) {
      return { success: false, error: result.error ?? "generation returned no image" };
    }
    return persist(result.imageUrl, `universe/locations/${loc.id}/${Date.now()}.jpg`);
  } catch (err) {
    logger.error("content-engine: generateLocationImage failed", { error: String(err), locationId: loc.id });
    return { success: false, error: err instanceof Error ? err.message : "generation failed" };
  }
}

export async function generateFactionImage(f: FactionForImage): Promise<EntityImageResult> {
  try {
    const result = await generateBaseImage({
      prompt: buildFactionPrompt(f),
      imageSize: "landscape_16_9",
      steps: 32,
    });
    if (!result.success || !result.imageUrl) {
      return { success: false, error: result.error ?? "generation returned no image" };
    }
    return persist(result.imageUrl, `universe/factions/${f.id}/${Date.now()}.jpg`);
  } catch (err) {
    logger.error("content-engine: generateFactionImage failed", { error: String(err), factionId: f.id });
    return { success: false, error: err instanceof Error ? err.message : "generation failed" };
  }
}
