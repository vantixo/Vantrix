/**
 * Universe Scene Composer
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds one composite scene that puts a cast of characters into a specific
 * location (city/district/town), optionally tied to a faction, styled to a
 * chosen genre — and generates both an image and (optionally) a short video
 * for it. Persisted to `universe_scenes` so the same scene isn't rebuilt on
 * every page view.
 *
 * Why this is a different pipeline from generateCharacterImage/generateScene:
 * those are LoRA-locked single-character portraits, and their default
 * negative prompt actively suppresses "multiple people" to protect
 * per-character identity lock. A city/faction scene is the opposite goal —
 * several named characters together in one environment — so this composes a
 * plain text-to-image prompt (no LoRA) from each character's locked
 * appearance description instead of stacking LoRAs, which no provider this
 * app uses has support for. Documented tradeoff: likeness is best-effort
 * from text description, not LoRA-exact.
 *
 * IMAGE-PROVIDER FIX: this used to call generateBaseImage() (lib/fal/lora-pipeline.ts)
 * directly — the old, pre-REROUTE path straight to Fal.ai with no fallback.
 * See primary-image.ts's own REROUTE comment: HotAPI is now the app-wide
 * primary image provider (Atlas backup, Fal only as a last-resort safety
 * net), and "batch scenes without a trained LoRA yet" — exactly what this
 * file generates — is explicitly listed as a path that should go through
 * generatePrimaryImage() instead of hitting Fal directly. This call site
 * was missed in that migration: every `universe_scenes` row before this fix
 * was stuck in `status: 'failed'` (Fal rejecting the request outright,
 * `error: "Forbidden"`, no fallback to fail over to), which is why Home's
 * "Legendary Scenes" row (getFeaturedUniverseScenes only returns
 * `status: 'complete'` rows) and every location's Scene Gallery were empty.
 * generateScene() (the LoRA identity-locked path, used elsewhere for
 * per-character portraits) intentionally still calls Fal directly — that's
 * unrelated and correct per primary-image.ts's own doc comment.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { generatePrimaryImage } from "@/lib/media/primary-image";
import { uploadUrlToR2 } from "@/lib/storage/r2";
import { submitVideo, pollVideoUntilDone } from "@/lib/video/video-router";
import { buildAppearancePrompt, type CharacterBibleRow } from "@/lib/content-engine/character-bible";
import { logger } from "@/lib/logger";
import type { WorldLocation } from "@/types/world-expansion";

export const SCENE_GENRES = [
  "noir-thriller",
  "high-fantasy",
  "cyberpunk",
  "romance",
  "slice-of-life",
  "horror",
  "heist",
  "political-drama",
  "festival-celebration",
  "war-and-conflict",
] as const;
export type SceneGenre = (typeof SCENE_GENRES)[number];

const GENRE_STYLE: Record<SceneGenre, string> = {
  "noir-thriller": "moody noir lighting, high contrast shadows, rain-slicked streets, tense atmosphere",
  "high-fantasy": "epic fantasy lighting, painterly detail, sense of wonder and scale",
  "cyberpunk": "neon-lit, dense signage, rain-reflective streets, high-tech-low-life aesthetic",
  "romance": "warm golden-hour lighting, soft focus edges, intimate framing",
  "slice-of-life": "natural everyday lighting, candid unposed composition, warm and grounded",
  "horror": "low-key lighting, deep shadow, unsettling composition, dread in the atmosphere",
  "heist": "sleek controlled lighting, sharp shadows, tense coordinated body language",
  "political-drama": "formal interior lighting, composed symmetrical framing, weight and gravity",
  "festival-celebration": "vibrant string lights, crowd energy, warm saturated color, joyful motion",
  "war-and-conflict": "dramatic overcast lighting, smoke and dust in the air, kinetic composition",
};

const NEGATIVE_PROMPT_GROUP_SCENE = [
  "ugly, deformed, disfigured, bad anatomy, bad hands,",
  "blurry, out of focus, watermark, signature, text,",
  "low quality, noise, grain, artifacts,",
  "overexposed, underexposed",
].join(" ");

export interface ComposeSceneInput {
  locationSlug: string;
  factionSlug?: string;
  characterIds: string[];
  genre: SceneGenre;
  customDirection?: string;
  generateVideo?: boolean;
  createdBy?: string;
}

export interface ComposeSceneResult {
  success: boolean;
  sceneId?: string;
  imageUrl?: string;
  videoUrl?: string;
  error?: string;
}

async function loadLocation(slug: string) {
  const { data, error } = await supabaseAdmin.from("world_locations").select("*").eq("slug", slug).maybeSingle();
  if (error || !data) return null;
  return data as WorldLocation & { image_url: string | null };
}

async function loadFaction(slug: string) {
  const { data, error } = await supabaseAdmin.from("factions").select("*").eq("slug", slug).maybeSingle();
  if (error || !data) return null;
  return data as { id: string; name: string; ideology: string; description: string | null; sigil_description: string | null; culture: string; image_url: string | null };
}

async function loadCharacters(ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin.from("characters").select("*").in("id", ids);
  if (error || !data) return [];
  return data as CharacterBibleRow[];
}

// Server-side enforcement that a scene's cast actually belongs to the
// location it's being staged in — home location is
// companion_occupations.location_id (seeded by provisioning.ts, editable
// per-character). Without this, the API would trust whatever characterIds
// the client sent, which is how every world ended up able to render every
// character instead of each having its own unique cast.
// Sub-districts (Wings, via parent_location_id) inherit their parent's
// residents here too — matches the same fallback getLocationResidents
// uses for the Residents section / Scene Builder cast picker in
// world-atlas.ts. Without this, a character correctly shown as available
// cast for a Wing (because they're inherited from The Archive) would get
// rejected by this check, since it only looked at the Wing's own directly
// assigned residents.
async function residentIdsForLocation(locationId: string, parentLocationId?: string | null): Promise<Set<string>> {
  const locationIds = parentLocationId ? [locationId, parentLocationId] : [locationId];
  const { data, error } = await supabaseAdmin
    .from("companion_occupations")
    .select("character_id")
    .in("location_id", locationIds);
  if (error || !data) return new Set();
  return new Set(data.map((r) => r.character_id as string));
}

function buildScenePrompt(opts: {
  location: WorldLocation;
  faction: { name: string; ideology: string } | null;
  characters: CharacterBibleRow[];
  genre: SceneGenre;
  customDirection?: string;
}): string {
  const { location, faction, characters, genre, customDirection } = opts;

  const castLines = characters.map((c, i) => {
    const appearance = buildAppearancePrompt(c);
    return `Character ${i + 1} — ${c.name}: ${appearance}${c.clothing ? "" : ""}`;
  });

  const parts = [
    `Full cinematic scene set in ${location.name}, a ${location.archetype} (${location.culture} culture): ${location.description}`,
    faction ? `Tied to the faction "${faction.name}" (${faction.ideology})` : undefined,
    castLines.length ? `Cast present in the scene, each rendered distinctly and simultaneously: ${castLines.join(" | ")}` : undefined,
    `Genre: ${genre.replace(/-/g, " ")} — ${GENRE_STYLE[genre]}`,
    customDirection ? `Additional direction: ${customDirection}` : undefined,
    "wide cinematic composition, every named character visible and distinguishable, coherent single environment",
    "cinematic digital painting, richly detailed, no text, no watermark, no logo",
  ].filter(Boolean);

  return parts.join(". ");
}

export async function composeUniverseScene(input: ComposeSceneInput): Promise<ComposeSceneResult> {
  // OPTIMIZATION: location/faction/character lookups are three independent
  // reads (different tables, no dependency between them) — they were
  // previously awaited one at a time, paying three sequential network
  // round-trips before generation even started. Running them concurrently
  // cuts that to the slowest single query instead of the sum of all three.
  const [location, faction, characters] = await Promise.all([
    loadLocation(input.locationSlug),
    input.factionSlug ? loadFaction(input.factionSlug) : Promise.resolve(null),
    loadCharacters(input.characterIds),
  ]);

  if (!location) return { success: false, error: "location_not_found" };
  if (input.factionSlug && !faction) return { success: false, error: "faction_not_found" };
  if (input.characterIds.length && characters.length !== input.characterIds.length) {
    return { success: false, error: "one_or_more_characters_not_found" };
  }

  // Cast must actually live/work here — see residentIdsForLocation above.
  // This is what keeps each city's scenes populated by its own people
  // instead of any character on the platform.
  const residentIds = await residentIdsForLocation(location.id, location.parent_location_id ?? null);
  const outsiders = input.characterIds.filter((id) => !residentIds.has(id));
  if (outsiders.length) {
    return { success: false, error: `characters_not_resident_here:${outsiders.join(",")}` };
  }

  const scenePrompt = buildScenePrompt({
    location,
    faction: faction ? { name: faction.name, ideology: faction.ideology } : null,
    characters,
    genre: input.genre,
    customDirection: input.customDirection,
  });

  const { data: row, error: insertError } = await supabaseAdmin
    .from("universe_scenes")
    .insert({
      location_id: location.id,
      faction_id: faction?.id ?? null,
      character_ids: input.characterIds,
      genre: input.genre,
      scene_prompt: scenePrompt,
      status: "generating_image",
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();

  if (insertError || !row) {
    return { success: false, error: insertError?.message ?? "failed_to_create_scene_row" };
  }
  const sceneId = row.id as string;

  try {
    const imageResult = await generatePrimaryImage({
      prompt: scenePrompt,
      negativePrompt: NEGATIVE_PROMPT_GROUP_SCENE,
      imageSize: "landscape_16_9",
    });

    if (!imageResult.success || !imageResult.imageUrl) {
      await supabaseAdmin.from("universe_scenes").update({ status: "failed", error: imageResult.error ?? "image generation failed" }).eq("id", sceneId);
      return { success: false, sceneId, error: imageResult.error ?? "image generation failed" };
    }

    const uploadedImage = await uploadUrlToR2(imageResult.imageUrl, `universe/scenes/${sceneId}.jpg`, "image/jpeg");
    if (!uploadedImage.success || !uploadedImage.r2Url) {
      await supabaseAdmin.from("universe_scenes").update({ status: "failed", error: uploadedImage.error ?? "R2 upload failed" }).eq("id", sceneId);
      return { success: false, sceneId, error: uploadedImage.error ?? "R2 upload failed" };
    }

    let videoUrl: string | undefined;
    if (input.generateVideo) {
      await supabaseAdmin.from("universe_scenes").update({ status: "generating_video", image_url: uploadedImage.r2Url }).eq("id", sceneId);

      const submitted = await submitVideo({
        imageUrl: uploadedImage.r2Url,
        prompt: `${GENRE_STYLE[input.genre]}, subtle environmental motion, characters shifting naturally, no camera cuts`,
        durationSeconds: "5",
        mode: "pro",
      });

      if (submitted.success && submitted.taskId) {
        const videoResult = await pollVideoUntilDone(submitted.taskId);
        if (videoResult.status === "succeed" && videoResult.videoUrl) {
          const uploadedVideo = await uploadUrlToR2(videoResult.videoUrl, `universe/scenes/${sceneId}.mp4`, "video/mp4");
          if (uploadedVideo.success && uploadedVideo.r2Url) {
            videoUrl = uploadedVideo.r2Url;
          }
        }
      }
      // A failed/skipped video is non-fatal — the scene still has its image.
      // Not treated as an overall failure; logged for visibility only.
      if (!videoUrl) {
        logger.error("scene-composer: video generation did not complete, scene keeps image only", { sceneId });
      }
    }

    await supabaseAdmin
      .from("universe_scenes")
      .update({ status: "complete", image_url: uploadedImage.r2Url, video_url: videoUrl ?? null, error: null })
      .eq("id", sceneId);

    // Backfill: if this location or faction has no image of its own yet,
    // this scene's image is a reasonable placeholder until a dedicated one
    // is generated via generateLocationImage/generateFactionImage.
    if (!location.image_url) {
      await supabaseAdmin.from("world_locations").update({ image_url: uploadedImage.r2Url, image_generated_at: new Date().toISOString() }).eq("id", location.id);
    }
    if (faction && !faction.image_url) {
      await supabaseAdmin.from("factions").update({ image_url: uploadedImage.r2Url, image_generated_at: new Date().toISOString() }).eq("id", faction.id);
    }

    return { success: true, sceneId, imageUrl: uploadedImage.r2Url, videoUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("scene-composer: composeUniverseScene failed", { error: msg, sceneId });
    await supabaseAdmin.from("universe_scenes").update({ status: "failed", error: msg }).eq("id", sceneId);
    return { success: false, sceneId, error: msg };
  }
}
