// src/lib/characters/scene-generator.ts
// ─────────────────────────────────────────────────────────────────────────────
// Scene Generator — SERVER ONLY.
//
// SPLIT (env-leak fix): mood-room/milestone constants and pure lookup helpers
// live in scene-data.ts, which has zero server-secret imports and is safe to
// import from client components (e.g. MoodRoom.tsx). This file re-exports
// those for existing server-side callers, and keeps generateCharacterScene
// (which needs Fal.ai + R2 + the Supabase service-role client) here, since
// that pulls in @/env's full secret schema and must never reach a client
// bundle. If a client component only needs MOOD_ROOMS/RELATIONSHIP_MILESTONES/
// getMoodRoom*, import from '@/lib/characters/scene-data' directly instead of
// this file.
// ─────────────────────────────────────────────────────────────────────────────

import { generateScene, uploadToR2 } from '@/lib/fal/lora-pipeline';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import {
  MOOD_ROOMS,
  RELATIONSHIP_MILESTONES,
  checkNewMilestones,
  getMoodRoom,
  getMoodRoomsForTier,
  type MoodRoom,
  type RelationshipMilestone,
} from './scene-data';

export {
  MOOD_ROOMS,
  RELATIONSHIP_MILESTONES,
  checkNewMilestones,
  getMoodRoom,
  getMoodRoomsForTier,
  type MoodRoom,
  type RelationshipMilestone,
};

// ── Core Scene Generator ──────────────────────────────────────────────────────

export interface GenerateSceneOptions {
  userId:        string;
  characterId:   string;
  characterSlug: string;
  loraModelId:   string;
  facePrompt:    string;
  moodRoomId?:   string;       // use a preset mood room
  customScene?:  string;       // or a custom scene description
  conversationId?: string;
}

export interface GenerateSceneResult {
  success:   boolean;
  imageUrl?: string;
  r2Url?:    string;
  error?:    string;
}

export async function generateCharacterScene(
  options: GenerateSceneOptions,
): Promise<GenerateSceneResult> {
  const {
    userId,
    characterId,
    characterSlug,
    loraModelId,
    facePrompt,
    moodRoomId,
    customScene,
    conversationId,
  } = options;

  // Resolve scene prompt
  let scenePrompt = customScene ?? '';
  let moodRoom    = moodRoomId ?? 'default';

  if (moodRoomId && !customScene) {
    const room = MOOD_ROOMS.find(r => r.id === moodRoomId);
    if (!room) return { success: false, error: 'unknown_mood_room' };
    scenePrompt = `${room.baseScene}, ${room.lighting}, ${room.atmosphere}`;
    moodRoom    = room.id;
  }

  if (!scenePrompt) {
    return { success: false, error: 'no_scene_specified' };
  }

  // Generate via Fal.ai
  const generated = await generateScene({
    characterSlug,
    loraModelId,
    facePrompt,
    scenePrompt,
    imageSize: 'portrait_4_3',
    steps:     28,
  });

  if (!generated.success || !generated.imageUrl) {
    return { success: false, error: generated.error };
  }

  // Upload to R2 for permanent storage
  const r2Key = `scenes/${userId}/${characterSlug}/${Date.now()}.jpg`;
  const r2Result = await uploadToR2(generated.imageUrl, r2Key);

  const finalUrl = r2Result.r2Url ?? generated.imageUrl;

  // Persist to DB
  try {
    await supabaseAdmin.from('generated_images').insert({
      user_id:         userId,
      character_id:    characterId,
      conversation_id: conversationId ?? null,
      scene_prompt:    scenePrompt,
      mood_room:       moodRoom,
      image_url:       finalUrl,
      r2_key:          r2Result.success ? r2Key : null,
      cost_usd:        generated.costUsd ?? null,
    });
  } catch (err) {
    // Non-fatal — image was generated successfully
    logger.error('scene-generator: DB persist failed', { error: err instanceof Error ? err.message : String(err) });
  }

  return { success: true, imageUrl: finalUrl, r2Url: r2Result.r2Url };
}
