/**
 * POST /api/dating/scene
 *
 * Generates a mood-room scene image for a matched character — the missing
 * wiring for MoodRoomSelector (@/components/scenes/MoodRoom.tsx) and
 * generateCharacterScene (@/lib/characters/scene-generator.ts), both of
 * which were fully built but had zero callers. Mirrors /api/chat/image's
 * auth/rate-limit/token-deduct pattern; generation itself is delegated to
 * generateCharacterScene, which already handles the Fal.ai call, R2 upload,
 * and generated_images persistence.
 *
 * Token cost: 15 per scene (mirrors the "premium_image" cost noted in the
 * archived coins.ts draft — see docs/economy-drafts — a mood-room scene is
 * a single generated image, same tier of cost as chat/image's photo request
 * would be for a non-seed-locked generation).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { isAdminProfile } from '@/lib/auth/admin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkImageLimit, checkDailyImageCap, resolveEffectiveTier } from '@/lib/rate-limit';
import { generateCharacterScene, getMoodRoom, getMoodRoomsForTier } from '@/lib/characters/scene-generator';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { sanitizeField } from '@/lib/sanitize';
import { moderateCharacter } from '@/lib/moderation';
import { checkMatureContentAccess } from '@/lib/access/character-gate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOKEN_COST = 15;

const schema = z.object({
  matchId:      z.string().uuid(),
  moodRoomId:   z.string().optional(),
  customPrompt: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });


    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 });
    }
    const { matchId, moodRoomId, customPrompt } = parsed.data;
    if (!moodRoomId && !customPrompt) {
      return NextResponse.json({ error: 'moodRoomId or customPrompt required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles').select('tier,tokens,role,is_admin').eq('id', user.id).single();
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

    const tier = resolveEffectiveTier(profile);

    const rateLimit = await checkImageLimit(user.id, tier);
    if (!rateLimit.allowed) {
      return NextResponse.json({
        error: `Image limit reached (${rateLimit.limit}/min on ${tier} plan)`,
        code:  'RATE_LIMIT_EXCEEDED', rateLimit,
      }, { status: 429 });
    }

    // H-03: burst limiter above only guards per-minute abuse — this enforces
    // the actual daily figure promised on the pricing page.
    const dailyImageCap = await checkDailyImageCap(user.id, tier);
    if (!dailyImageCap.allowed) {
      return NextResponse.json({
        error: `Daily image limit reached (${dailyImageCap.limit}/day on ${tier} plan)`,
        code:  'DAILY_LIMIT_EXCEEDED', dailyImageCap,
      }, { status: 429 });
    }

    // Mood rooms are tier-gated (MoodRoom.minTier) — enforce server-side too,
    // not just the client's disabled-state styling.
    if (moodRoomId) {
      const room = getMoodRoom(moodRoomId);
      if (!room) return NextResponse.json({ error: 'Unknown mood room', code: 'NOT_FOUND' }, { status: 404 });
      const allowedForTier = getMoodRoomsForTier(tier).some(r => r.id === room.id);
      if (!allowedForTier) {
        return NextResponse.json({
          error: `The ${room.label} room requires ${room.minTier} tier or higher`,
          code:  'TIER_LOCKED',
        }, { status: 403 });
      }
    }

    if (!isAdminProfile(profile) && profile.tokens < TOKEN_COST) {
      return NextResponse.json({
        error:           'Not enough Vantrix Coin — top up to generate a scene',
        code:            'INSUFFICIENT_TOKENS',
        tokensRequired:  TOKEN_COST,
        tokensAvailable: profile.tokens,
      }, { status: 402 });
    }

    // Match must belong to this user — scopes character lookup safely.
    const { data: match } = await supabaseAdmin
      .from('dating_matches')
      .select('id, character_id, user_id')
      .eq('id', matchId)
      .eq('user_id', user.id)
      .single();
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

    const { data: character } = await supabaseAdmin
      .from('characters')
      .select('id, lora_model_id, face_prompt, is_nsfw')
      .eq('id', match.character_id)
      .single();
    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    if (!character.lora_model_id || !character.face_prompt) {
      return NextResponse.json({
        error: 'This character isn\'t set up for scene generation yet',
        code:  'NO_LORA_MODEL',
      }, { status: 422 });
    }

    // SEC: mood-room scene generation is a full image-producing surface —
    // same gate as /api/chat/image. A user with a match id could otherwise
    // generate an NSFW character's scene without ever passing
    // age-verification / nsfw_enabled.
    const matureGate = await checkMatureContentAccess(user.id, !!character.is_nsfw, tier);
    if (!matureGate.allowed) {
      return NextResponse.json({
        error: matureGate.reason ?? 'This character has mature content and is currently unavailable',
        code: 'MATURE_CONTENT_BLOCKED',
      }, { status: 403 });
    }

    // ── Conversation to attach the generated image to (best-effort) ──────────
    const { data: convo } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('user_id', user.id)
      .eq('character_id', match.character_id)
      .maybeSingle();

    // SEC FIX (Phase B audit, 2026-08-06): customPrompt is free-text user
    // input (up to 500 chars) that went straight into the image-generation
    // prompt sent to Fal.ai with zero sanitization or moderation — same
    // bug class already fixed in characters/generate-image and
    // chat/video. Sanitized and moderated here before it reaches
    // generateCharacterScene.
    const safeCustomPrompt = customPrompt ? sanitizeField(customPrompt, 500) : undefined;
    if (safeCustomPrompt) {
      const modResult = await moderateCharacter({ name: 'scene', description: safeCustomPrompt });
      if (!modResult.allowed) {
        return NextResponse.json({
          error: modResult.reason ?? 'Scene prompt rejected by content moderation',
          code: 'CONTENT_POLICY_VIOLATION',
        }, { status: 422 });
      }
    }

    const result = await generateCharacterScene({
      userId:         user.id,
      characterId:    character.id,
      characterSlug:  character.id,
      loraModelId:    character.lora_model_id,
      facePrompt:     character.face_prompt,
      moodRoomId,
      customScene:    safeCustomPrompt,
      conversationId: convo?.id,
    });

    if (!result.success || !result.imageUrl) {
      return NextResponse.json({
        error: result.error === 'no_scene_specified' || result.error === 'unknown_mood_room'
          ? result.error
          : 'Scene generation is temporarily unavailable — please try again in a moment',
        code: result.error ?? 'GENERATION_FAILED',
      }, { status: result.error === 'no_scene_specified' || result.error === 'unknown_mood_room' ? 400 : 503 });
    }

    // ADMIN-FREE-TIER: skip deduction for admins, mirrors chat/image.
    if (!isAdminProfile(profile)) {
      const { error: deductErr } = await supabaseAdmin.rpc('deduct_tokens', {
        p_user_id: user.id,
        p_amount:  TOKEN_COST,
      });
      if (deductErr) {
        logger.error('dating-scene:token-deduct-failed', { userId: user.id, error: deductErr.message });
      }
    }

    logger.info('dating-scene:generated', { userId: user.id, matchId, moodRoomId, tokenCost: TOKEN_COST });

    return NextResponse.json({ url: result.imageUrl, tokenCost: TOKEN_COST, rateLimit });
  } catch (err) {
    logger.error('dating-scene:error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
