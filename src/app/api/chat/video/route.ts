/**
 * POST /api/chat/video — In-Chat Video Generation
 *
 * Called by the chat window when the user asks the character to "send a
 * video" / taps the video button. Unlike /api/chat/image (which returns the
 * finished image synchronously — Fal.ai's generation is fast), Kling video
 * generation takes 30s to several minutes, far too long to hold an HTTP
 * request open. This route submits the job and returns a jobId immediately;
 * the client polls GET /api/chat/video/status?jobId=... until it completes.
 *
 * Token cost is charged on successful completion (in the status route), not
 * here on submit — charging on submit would take tokens for jobs that fail
 * or time out with nothing to show for it.
 *
 * Job state lives in Redis (not a DB table) — short-lived (15 min TTL),
 * single-reader (the submitting user polling their own job), not something
 * that needs to survive a Redis restart or be queryable later.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { isAdminProfile } from '@/lib/auth/admin';
import { checkVideoLimit, checkDailyVideoCap, resolveEffectiveTier } from '@/lib/rate-limit';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { moderateCharacter } from '@/lib/moderation';
import { checkMatureContentAccess } from '@/lib/access/character-gate';
import { sanitizeField } from '@/lib/sanitize';
import { submitVideo } from '@/lib/video/video-router';
import { isFeatureEnabled } from '@/lib/flags';
import { redis } from '@/lib/redis';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const JOB_TTL_SECONDS = 15 * 60;

const schema = z.object({
  characterId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  userMessage: z.string().min(1).max(4000),
  mood: z.string().max(50).optional(),
});

export interface ChatVideoJob {
  userId: string;
  characterId: string;
  // Optional — video can be requested before a conversation row exists.
  // Carried through so the status route can persist the completed video
  // to chat history; without it the result would only ever live in the
  // requesting client's React state (see status/route.ts).
  conversationId?: string;
  videoTaskId: string; // composite "<provider>:<taskId>" — see lib/video/video-router.ts
  status: 'processing';
  createdAt: number;
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    if (!(await isFeatureEnabled('chat_video_generation_enabled', { userId: user.id }))) {
      return NextResponse.json({
        error: 'Video generation is temporarily unavailable — please try again later',
        code: 'FEATURE_DISABLED',
      }, { status: 503 });
    }

    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid request', code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      }, { status: 400 });
    }

    const { characterId, conversationId, userMessage, mood } = parsed.data;

    const { data: profile } = await supabase
      .from('profiles').select('tier,tokens,role,is_admin').eq('id', user.id).single();
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const tier = resolveEffectiveTier(profile);

    const rateLimit = await checkVideoLimit(user.id, tier);
    if (!rateLimit.allowed) {
      return NextResponse.json({
        error: tier === 'free'
          ? 'Video generation requires a paid plan — upgrade to unlock'
          : `Video limit reached (${rateLimit.limit}/min on ${tier} plan)`,
        code: 'RATE_LIMIT_EXCEEDED', rateLimit,
      }, { status: tier === 'free' ? 402 : 429 });
    }

    const dailyVideoCap = await checkDailyVideoCap(user.id, tier);
    if (!dailyVideoCap.allowed) {
      return NextResponse.json({
        error: `Daily video limit reached (${dailyVideoCap.limit}/day on ${tier} plan)`,
        code: 'DAILY_LIMIT_EXCEEDED', dailyVideoCap,
      }, { status: 429 });
    }

    const TOKEN_COST = 20; // video is far more expensive per-generation than images (4 tokens) — see .env.example / Kling pricing
    if (!isAdminProfile(profile) && profile.tokens < TOKEN_COST) {
      return NextResponse.json({
        error: 'Not enough Vantrix Coin — top up to generate videos',
        code: 'INSUFFICIENT_TOKENS',
        tokensRequired: TOKEN_COST,
        tokensAvailable: profile.tokens,
      }, { status: 402 });
    }

    const { data: character } = await supabase
      .from('characters')
      .select('id,name,description,canon_sheet_url,image_url,is_nsfw')
      .eq('id', characterId)
      .single();

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    // SEC: video generation is a full mature-content-producing surface —
    // see the identical fix in /api/chat/image. Without this, a user who
    // knows an NSFW character's id could bypass age-verification /
    // nsfw_enabled entirely by calling this route directly.
    const matureGate = await checkMatureContentAccess(user.id, !!character.is_nsfw, tier);
    if (!matureGate.allowed) {
      return NextResponse.json({
        error: matureGate.reason ?? 'This character has mature content and is currently unavailable',
        code: 'MATURE_CONTENT_BLOCKED',
      }, { status: 403 });
    }

    const sourceImage = character.canon_sheet_url || character.image_url;
    if (!sourceImage) {
      return NextResponse.json({
        error: 'This character has no reference image yet — video is unavailable',
        code: 'NO_SOURCE_IMAGE',
      }, { status: 422 });
    }

    const modResult = await moderateCharacter({
      name: character.name,
      description: userMessage,
    });
    if (!modResult.allowed) {
      return NextResponse.json({
        error: modResult.reason ?? 'Video request blocked by content policy',
        code: 'CONTENT_POLICY_VIOLATION',
        category: modResult.category,
      }, { status: 422 });
    }

    // SEC FIX (Phase B audit, 2026-08-06): `mood` is free-text user input
    // (up to 50 chars) that was concatenated straight into motionPrompt
    // below — the text actually sent to the video provider — without
    // sanitization or moderation. moderateCharacter() above only checks
    // userMessage. Same category as the generate-image appearance-field
    // fix: sanitized here, and folded into the moderation check so a
    // policy-violating mood string can't slip through alongside a clean
    // userMessage.
    const safeMood = mood ? sanitizeField(mood, 50) : undefined;
    if (safeMood) {
      const moodModResult = await moderateCharacter({ name: character.name, description: safeMood });
      if (!moodModResult.allowed) {
        return NextResponse.json({
          error: moodModResult.reason ?? 'Video request blocked by content policy',
          code: 'CONTENT_POLICY_VIOLATION',
          category: moodModResult.category,
        }, { status: 422 });
      }
    }

    const motionPrompt = safeMood
      ? `natural motion matching a ${safeMood} mood, photorealistic, no distortion`
      : 'subtle natural motion, gentle expression, photorealistic, no distortion';

    const submitted = await submitVideo({
      imageUrl: sourceImage,
      prompt: motionPrompt,
      durationSeconds: '5',
      mode: 'std',
    });

    if (!submitted.success || !submitted.taskId) {
      logger.warn('chat-video:submit-failed', { characterId, error: submitted.error, provider: submitted.provider });
      return NextResponse.json({
        error: 'Video generation is temporarily unavailable — please try again in a moment',
        code: 'VIDEO_PROVIDER_DOWN',
      }, { status: 503 });
    }

    const jobId = randomUUID();
    const job: ChatVideoJob = {
      userId: user.id,
      characterId: character.id,
      conversationId,
      videoTaskId: submitted.taskId,
      status: 'processing',
      createdAt: Date.now(),
    };
    await redis.set(`chat-video-job:${jobId}`, JSON.stringify(job), { ex: JOB_TTL_SECONDS });

    logger.info('chat-video:submitted', { userId: user.id, characterId: character.id, jobId });

    return NextResponse.json({ jobId, status: 'processing', rateLimit });
  } catch (err) {
    logger.error('chat-video:error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
