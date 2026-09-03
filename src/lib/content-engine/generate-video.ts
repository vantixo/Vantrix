import { submitVideo, pollVideoUntilDone } from "@/lib/video/video-router";
import { uploadToR2 } from "@/lib/fal/lora-pipeline";
import { logger } from "@/lib/logger";
import { buildAppearancePrompt, type CharacterBibleRow } from "./character-bible";

export interface ContentVideoResult {
  success: boolean;
  videoUrl?: string;
  error?: string;
}

/**
 * Generates a short scene video for a character via the video-router
 * (HotAPI primary, Atlas backup — see src/lib/video/video-router.ts),
 * animating the character's canon reference sheet with a scene-specific
 * motion prompt.
 *
 * Requires canon_sheet_url — image-to-video needs a source still. A
 * character with no reference sheet yet (hasn't been through the
 * appearance-lock step) can't generate video, same reasoning as
 * generateCharacterImage requiring a trained LoRA.
 *
 * Runs synchronously from the caller's point of view (polls inline, up to
 * 5 minutes by default) to match the existing content-engine queue's
 * processing model in queue.ts, which awaits each generator directly
 * rather than using a webhook. This mirrors how animate-portrait.ts's Grok
 * path already polls inline for the same reason.
 *
 * maxWaitMs lets a caller with a tighter time budget than the 5-minute
 * default (e.g. a cron route with its own maxDuration ceiling — see
 * api/cron/content-engine-video/route.ts) bound the poll so it can fail
 * cleanly instead of risking the whole invocation hard-timing-out mid-poll,
 * which would leave the queue row stuck in "generating" with no error
 * recorded. Omit it to keep the original 5-minute behavior unchanged.
 */
export async function generateCharacterVideo(
  character: CharacterBibleRow,
  scenePrompt: string,
  maxWaitMs?: number,
): Promise<ContentVideoResult> {
  if (!character.canon_sheet_url) {
    return {
      success: false,
      error: "Character has no canon reference sheet yet — generate one before requesting video.",
    };
  }

  const facePrompt = buildAppearancePrompt(character);
  const motionPrompt = scenePrompt.trim().length > 0
    ? `${facePrompt}, ${scenePrompt}`
    : `${facePrompt}, subtle natural motion, photorealistic, no distortion`;

  try {
    const submitted = await submitVideo({
      imageUrl: character.canon_sheet_url,
      prompt: motionPrompt,
      durationSeconds: "5",
      mode: "pro", // higher-quality tier — see src/lib/video/providers (std vs pro)
    });

    if (!submitted.success || !submitted.taskId) {
      return { success: false, error: submitted.error ?? "video submit failed" };
    }

    const result = maxWaitMs
      ? await pollVideoUntilDone(submitted.taskId, maxWaitMs)
      : await pollVideoUntilDone(submitted.taskId);

    if (result.status !== "succeed" || !result.videoUrl) {
      return { success: false, error: result.error ?? "video generation failed" };
    }

    const key = `character-videos/${character.id}/${Date.now()}.mp4`;
    const uploaded = await uploadToR2(result.videoUrl, key, "video/mp4");

    if (!uploaded.success || !uploaded.r2Url) {
      return { success: false, error: uploaded.error ?? "R2 upload failed" };
    }

    return { success: true, videoUrl: uploaded.r2Url };
  } catch (err) {
    logger.error("content-engine: generateCharacterVideo failed", {
      error: String(err),
      characterId: character.id,
    });
    return { success: false, error: err instanceof Error ? err.message : "generation failed" };
  }
}

/** A small rotating set of scene motion prompts, mirroring DEFAULT_SCENE_PROMPTS in generate-image.ts. */
export const DEFAULT_VIDEO_SCENE_PROMPTS = [
  "gentle turn toward camera, soft smile, natural indoor lighting",
  "walking slowly through frame, outdoor golden-hour light, casual outfit",
  "laughing softly, cozy evening ambient lighting",
];
