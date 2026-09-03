import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { CharacterBibleRow } from "./character-bible";
import { generateChatLines } from "./generate-chat-lines";
import { generateCharacterImage, DEFAULT_SCENE_PROMPTS } from "./generate-image";
import { generateCharacterVideo, DEFAULT_VIDEO_SCENE_PROMPTS } from "./generate-video";

export type ContentType = "image" | "chat_line" | "video";

const CHARACTER_FIELDS =
  "id,name,gender,age,ethnicity,height,body_type,face_shape,eye_color,hair_color,hair_style," +
  "skin_tone,signature_items,art_style,clothing,description,personality,archetype,speech_style," +
  "char_openness,char_warmth,char_adventure,char_depth,canon_sheet_url,visual_seed,lora_model_id," +
  "lora_trained_at,is_nsfw,style_guide_notes";

async function loadCharacter(characterId: string): Promise<CharacterBibleRow | null> {
  const { data } = await supabaseAdmin
    .from("characters")
    .select(CHARACTER_FIELDS)
    .eq("id", characterId)
    .maybeSingle();
  return (data as unknown as CharacterBibleRow) ?? null;
}

export interface EnqueueInput {
  characterId: string;
  contentType: ContentType;
  triggeredBy: "admin" | "cron";
  createdBy?: string; // profile id of the triggering admin, if any
  promptInput?: string;
  /** Video only — bounds generateCharacterVideo's poll. See that function's
   *  doc comment. Ignored for image/chat_line. */
  maxWaitMs?: number;
}

/**
 * Creates a queue row and immediately processes it inline. Generation for a
 * single item (one image, one batch of chat lines) is fast enough — a few
 * seconds — that a real background worker isn't needed yet. If this ever
 * needs to scale to bulk overnight runs across hundreds of characters,
 * split `processQueueItem` out into a proper queue worker at that point.
 */
export async function enqueueAndGenerate(input: EnqueueInput) {
  const { data: row, error } = await supabaseAdmin
    .from("character_content_queue")
    .insert({
      character_id: input.characterId,
      content_type: input.contentType,
      status: "generating",
      prompt_input: input.promptInput ?? null,
      triggered_by: input.triggeredBy,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();

  if (error || !row) {
    logger.error("content-engine: failed to create queue row", { error, input });
    return { success: false, error: error?.message ?? "failed to enqueue" };
  }

  return processQueueItem(row.id, input.maxWaitMs);
}

export async function processQueueItem(queueItemId: string, videoMaxWaitMs?: number) {
  const { data: item } = await supabaseAdmin
    .from("character_content_queue")
    .select("id,character_id,content_type,prompt_input")
    .eq("id", queueItemId)
    .maybeSingle();

  if (!item) return { success: false, error: "queue item not found" };

  const character = await loadCharacter(item.character_id);
  if (!character) {
    await markFailed(queueItemId, "character not found");
    return { success: false, error: "character not found" };
  }

  try {
    if (item.content_type === "chat_line") {
      const result = await generateChatLines(character, {
        kind: (item.prompt_input as "opening_line" | "reply_variety" | null) ?? "opening_line",
        count: 5,
      });
      if (!result.success || result.lines.length === 0) {
        await markFailed(queueItemId, result.error ?? "no lines passed moderation");
        return { success: false, error: result.error ?? "no lines passed moderation" };
      }
      await markPendingReview(queueItemId, { result_text: result.lines.join("\n") });
      return { success: true, lines: result.lines };
    }

    if (item.content_type === "image") {
      const scenePrompt =
        item.prompt_input || DEFAULT_SCENE_PROMPTS[Math.floor(Math.random() * DEFAULT_SCENE_PROMPTS.length)];
      const result = await generateCharacterImage(character, scenePrompt);
      if (!result.success || !result.imageUrl) {
        await markFailed(queueItemId, result.error ?? "generation failed");
        return { success: false, error: result.error ?? "generation failed" };
      }
      await markPendingReview(queueItemId, { result_url: result.imageUrl, cost_usd: result.costUsd });
      return { success: true, imageUrl: result.imageUrl };
    }

    if (item.content_type === "video") {
      const scenePrompt =
        item.prompt_input || DEFAULT_VIDEO_SCENE_PROMPTS[Math.floor(Math.random() * DEFAULT_VIDEO_SCENE_PROMPTS.length)];
      const result = await generateCharacterVideo(character, scenePrompt, videoMaxWaitMs);
      if (!result.success || !result.videoUrl) {
        await markFailed(queueItemId, result.error ?? "video generation failed");
        return { success: false, error: result.error };
      }
      await markPendingReview(queueItemId, { result_url: result.videoUrl });
      return { success: true, videoUrl: result.videoUrl };
    }

    await markFailed(queueItemId, `unknown content type: ${item.content_type}`);
    return { success: false, error: "unknown content type" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unexpected error";
    await markFailed(queueItemId, message);
    return { success: false, error: message };
  }
}

async function markPendingReview(id: string, fields: { result_text?: string; result_url?: string; cost_usd?: number }) {
  await supabaseAdmin
    .from("character_content_queue")
    .update({ status: "pending_review", completed_at: new Date().toISOString(), ...fields })
    .eq("id", id);
}

async function markFailed(id: string, error: string) {
  await supabaseAdmin
    .from("character_content_queue")
    .update({ status: "failed", error, completed_at: new Date().toISOString() })
    .eq("id", id);
}
