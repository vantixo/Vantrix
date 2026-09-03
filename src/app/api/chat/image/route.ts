/**
 * POST /api/chat/image — In-Chat Photo Generation (v2 — Visual Consistency)
 *
 * Called by the chat window when the user asks the character to "send a photo"
 * or taps the camera button. Generates a contextually accurate image using the
 * character's locked visual seed for consistent appearance across every photo.
 *
 * Visual seed system:
 *   - First call: getOrCreateSeed() generates a canonical descriptor from the
 *     character's appearance fields and signals it should be persisted.
 *   - Subsequent calls: the seed is fetched from characters.visual_seed and
 *     reused verbatim, guaranteeing same face/hair/eyes every time.
 *   - The seed is fire-and-forget persisted after generation (non-blocking).
 *
 * Prompt structure (v2):
 *   style → visual_seed → scene_setting → outfit → mood → angle → lighting → quality
 *
 * Token cost: 4 per image. Rate limit: tier-based.
 */

import { NextRequest, NextResponse, after }  from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { isAdminProfile } from '@/lib/auth/admin';
import { z }                           from 'zod';
import { supabaseAdmin }               from '@/lib/supabase/admin';
import { checkImageLimit, checkDailyImageCap, resolveEffectiveTier } from '@/lib/rate-limit';
import { toErrorBody, errorLogFields }                 from '@/lib/errors';
import { logger }                      from '@/lib/logger';
import { CircuitBreaker }              from '@/lib/circuit-breaker';
import { moderateCharacter }           from '@/lib/moderation';
import { checkMatureContentAccess }    from '@/lib/access/character-gate';
import {
  getOrCreateSeed,
  buildImagePrompt,
  buildAppearancePrompt,
  extractSceneFromMessages,
} from '@/lib/image/in-chat-image';
import type { CharacterAppearance } from '@/lib/image/in-chat-image';
import { generateScene, uploadToR2 } from '@/lib/fal/lora-pipeline';
import { generatePrimaryImage } from '@/lib/media/primary-image';

export const dynamic = 'force-dynamic';

// Circuit breaker — opens after 3 failures, recovers after 30s.
// Prevents Fal.ai downtime from causing hanging requests that consume
// user tokens and clog the function pool.
const imageBreaker = new CircuitBreaker('fal-ai', {
  failureThreshold: 3,
  timeout:          30_000,
});
export const runtime = 'nodejs';

const TOKEN_COST = 4;

const schema = z.object({
  characterId:    z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  userMessage:    z.string().min(1).max(4000),
  recentMessages: z.array(z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string().max(1000),
  })).max(6).optional().default([]),
  style:     z.enum(['realistic', 'anime', 'artistic']).optional(),
  mood:      z.string().max(50).optional(),
  angle:     z.enum(['portrait', 'full_body', 'close_up', 'over_shoulder', 'selfie']).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const raw    = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid request', code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      }, { status: 400 });
    }

    const { characterId, conversationId, userMessage, recentMessages, style, mood, angle } = parsed.data;

    // ── Profile + rate limit ──────────────────────────────────────────────────
    const { data: profile } = await supabase
      .from('profiles').select('tier,tokens,role,is_admin').eq('id', user.id).single();
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const tier      = resolveEffectiveTier(profile);
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

    // ADMIN-FREE-TIER: admins bypass the token wallet entirely, not just
    // the tier-based rate limit above — staff shouldn't need a funded
    // wallet to test/use image generation.
    if (!isAdminProfile(profile) && profile.tokens < TOKEN_COST) {
      return NextResponse.json({
        error:           'Not enough Vantrix Coin — top up to generate photos',
        code:            'INSUFFICIENT_TOKENS',
        tokensRequired:  TOKEN_COST,
        tokensAvailable: profile.tokens,
      }, { status: 402 });
    }

    // ── Fetch character — include visual_seed ─────────────────────────────────
    const { data: character } = await supabase
      .from('characters')
      .select('id,name,gender,age,description,personality,image_url,speech_style,occupation,visual_seed,hair_color,eye_color,body_type,skin_tone,lora_model_id,face_prompt,generation_style,is_nsfw')
      .eq('id', characterId)
      .single();

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    // SEC: image generation is a full mature-content-producing surface, no
    // different from a chat reply — a user who already knows an NSFW
    // character's id (an old URL, a cached match, browser history) could
    // otherwise call this route directly and bypass age-verification /
    // nsfw_enabled entirely, since neither was ever checked here. Same
    // gate /api/chat/stream and /api/queue/enqueue already use.
    const matureGate = await checkMatureContentAccess(user.id, !!character.is_nsfw, tier);
    if (!matureGate.allowed) {
      return NextResponse.json({
        error: matureGate.reason ?? 'This character has mature content and is currently unavailable',
        code:  'MATURE_CONTENT_BLOCKED',
      }, { status: 403 });
    }

    // ── Moderation ────────────────────────────────────────────────────────────
    const modResult = await moderateCharacter({
      name:        character.name,
      description: userMessage,
    });
    if (!modResult.allowed) {
      return NextResponse.json({
        error:    modResult.reason ?? 'Image request blocked by content policy',
        code:     'CONTENT_POLICY_VIOLATION',
        category: modResult.category,
      }, { status: 422 });
    }

    // ── Visual seed — get existing or generate new ────────────────────────────
    const charAppearance: CharacterAppearance = {
      id:          character.id,
      name:        character.name,
      gender:      character.gender,
      age:         character.age,
      description: character.description,
      personality: character.personality,
      occupation:  character.occupation,
      art_style:   (style ?? (character.gender === 'anime' ? 'anime' : 'realistic')) as CharacterAppearance['art_style'],
      visual_seed: character.visual_seed,
      // Appearance fields from wizard (may be null for legacy characters)
      hair_color:  (character as Record<string, unknown>).hair_color as string | null,
      eye_color:   (character as Record<string, unknown>).eye_color  as string | null,
      body_type:   (character as Record<string, unknown>).body_type  as string | null,
      skin_tone:   (character as Record<string, unknown>).skin_tone  as string | null,
    };

    const { seed, shouldPersist } = getOrCreateSeed(charAppearance);

    // ── Extract scene context from recent messages ────────────────────────────
    const scene = extractSceneFromMessages(recentMessages, mood);
    if (angle) scene.angle = angle;

    // ── Build prompt using v2 seed-based system ───────────────────────────────
    const { positive, negative, newSeed } = buildImagePrompt(
      { ...charAppearance, visual_seed: seed },
      scene,
    );

    // ── Generate image via Fal.ai (circuit-breaker protected) ─────────────────
    // Circuit opens after 3 consecutive failures. When open, returns immediate 503
    // instead of hanging on each request. Users see "Images temporarily
    // unavailable" rather than a spinner that never resolves.
    //
    // Uses the character's trained LoRA when one exists (lora_model_id set by
    // the training pipeline in lib/fal/lora-pipeline.ts) for genuine face/
    // identity consistency — the same generator Image Studio and scene
    // generation already use. Falls back to a base Fal generation (no LoRA)
    // for characters that haven't been through training, so every character
    // still gets photos, just without the identity-lock guarantee.
    //
    // Fal's result URLs are temporary and expire — unlike the Pollinations
    // URLs this replaced, which were stable — so the result is uploaded to
    // R2 for permanent storage before being returned to the client.
    const numericSeed = seed.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);

    let imageUrl: string;
    try {
      imageUrl = await imageBreaker.execute(async () => {
        // Prefer the locked canonical face_prompt (LoRA-training identity
        // string) when the character has one — this is what the LoRA was
        // actually trained against. Fall back to the on-the-fly appearance
        // prompt for characters seeded before face_prompt existed.
        const lockedFacePrompt = (character as { face_prompt?: string | null }).face_prompt;
        const genStyle = (character as { generation_style?: string | null }).generation_style;
        // generation_style is a scene-only quality layer (lens/lighting/grain)
        // — appended after the scene prompt, never merged into face_prompt.
        const scenePromptWithStyle = genStyle ? `${positive}, ${genStyle}` : positive;

        const generated = character.lora_model_id
          ? await generateScene({
              characterSlug: character.id,
              loraModelId:   character.lora_model_id,
              facePrompt:    lockedFacePrompt || buildAppearancePrompt(charAppearance),
              scenePrompt:   scenePromptWithStyle,
              negativePrompt: negative,
              seed:          numericSeed,
            })
          : await generatePrimaryImage({
              prompt:         positive,
              negativePrompt: negative,
              seed:           numericSeed,
            });

        if (!generated.success || !generated.imageUrl) {
          throw new Error(generated.error ?? 'fal_generation_failed');
        }

        const r2Key = `chat-photos/${user.id}/${character.id}/${Date.now()}.jpg`;
        const uploaded = await uploadToR2(generated.imageUrl, r2Key);
        if (!uploaded.success || !uploaded.r2Url) {
          throw new Error(uploaded.error ?? 'r2_upload_failed');
        }
        return uploaded.r2Url;
      });
    } catch (breakerErr) {
      logger.warn('image-generation:circuit-open-or-provider-down', { error: String(breakerErr) });
      return NextResponse.json({
        error: 'Image generation is temporarily unavailable — please try again in a moment',
        code: 'IMAGE_PROVIDER_DOWN',
      }, { status: 503 });
    }

    // ── Persist seed if newly generated (fire-and-forget, but after()-protected) ──
    if (shouldPersist || newSeed) {
      after(() => {
        Promise.resolve(
          supabaseAdmin
            .from('characters')
            .update({ visual_seed: seed })
            .eq('id', character.id),
        )
          .then(() => {})
          .catch(err => {
            logger.warn('in-chat-image:seed-persist-failed', { characterId: character.id, error: String(err) });
          });
      });
    }

    // ── Deduct tokens ─────────────────────────────────────────────────────────
    // ADMIN-FREE-TIER: skip the deduction entirely for admins rather than
    // letting deduct_tokens run and drive their balance negative — access
    // was already free above, this keeps their wallet honest too.
    if (!isAdminProfile(profile)) {
      const { error: deductErr } = await supabaseAdmin.rpc('deduct_tokens', {
        p_user_id: user.id,
        p_amount:  TOKEN_COST,
      });
      if (deductErr) {
        logger.error('in-chat-image:token-deduct-failed', { userId: user.id, error: deductErr.message });
      }
    }

    logger.info('in-chat-image:generated', {
      userId:      user.id,
      characterId: character.id,
      tokenCost:   TOKEN_COST,
      newSeed,
      promptLen:   positive.length,
    });

    // ── Persist to conversation history ─────────────────────────────────────
    // Without this, the generated photo only ever lived in the requesting
    // client's React state — it would vanish on refresh, on scrolling past
    // it (pagination re-fetches from the DB), or on any other device. Best-
    // effort: a persistence failure shouldn't turn a successful, already-
    // paid-for generation into an error response — the client still gets
    // the image, it just won't survive a reload if this insert fails.
    let messageId: string | undefined;
    let messageCreatedAt: string | undefined;
    if (conversationId) {
      const { data: savedMsg, error: saveErr } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          role:            'assistant',
          content:         '',
          image_url:       imageUrl,
          tokens_used:     TOKEN_COST,
        })
        .select('id,created_at')
        .single();
      if (saveErr) {
        logger.warn('in-chat-image:message-persist-failed', { conversationId, error: saveErr.message });
      } else if (savedMsg) {
        messageId = savedMsg.id;
        messageCreatedAt = savedMsg.created_at ?? undefined;
      }
    }

    return NextResponse.json({
      url:       imageUrl,
      tokenCost: TOKEN_COST,
      rateLimit,
      seedLocked: !newSeed, // true = used existing seed (consistent)
      messageId,
      createdAt: messageCreatedAt,
    });

  } catch (err) {
    logger.error('in-chat-image:error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
