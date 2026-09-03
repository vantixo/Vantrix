/**
 * GET /api/chat/video/status?jobId=... — poll a chat-video job submitted via
 * POST /api/chat/video. The client is expected to poll this every few
 * seconds until status is 'completed' or 'failed'.
 *
 * Token deduction happens here, once, on the transition to 'completed' —
 * not at submit time — so a job that times out or fails never costs the
 * user tokens. The Redis job record is deleted after a terminal status is
 * returned so a retried/duplicate poll can't double-charge.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { isAdminProfile } from '@/lib/auth/admin';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getVideoStatus } from '@/lib/video/video-router';
import { uploadToR2 } from '@/lib/fal/lora-pipeline';
import { redis } from '@/lib/redis';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ChatVideoJob } from '../route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOKEN_COST = 20; // must match the submit route

const schema = z.object({ jobId: z.string().uuid() });

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const parsed = schema.safeParse({ jobId: req.nextUrl.searchParams.get('jobId') });
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const { jobId } = parsed.data;

    const jobKey = `chat-video-job:${jobId}`;
    const raw = await redis.get<string | ChatVideoJob>(jobKey);
    if (!raw) {
      return NextResponse.json({ error: 'Job not found or expired', code: 'JOB_NOT_FOUND' }, { status: 404 });
    }
    const job: ChatVideoJob = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // A job belongs to exactly the user who submitted it — never let one
    // user poll (and thus learn the completion/failure of) another user's job.
    if (job.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 403 });
    }

    const status = await getVideoStatus(job.videoTaskId);

    if (status.status === 'submitted' || status.status === 'processing') {
      return NextResponse.json({ status: 'processing' });
    }

    if (status.status === 'check_error') {
      // Transient — couldn't confirm Kling's status this attempt, but the
      // task itself hasn't failed. Don't delete the job; let the client
      // poll again shortly. If this persists until the job's Redis TTL
      // expires, the client's own maxWaitMs timeout (5 min) catches it.
      return NextResponse.json({ status: 'processing' });
    }

    if (status.status === 'failed') {
      await redis.del(jobKey);
      logger.warn('chat-video:job-failed', { jobId, userId: user.id, error: status.error });
      return NextResponse.json({ status: 'failed', error: status.error ?? 'video generation failed' });
    }

    // status.status === 'succeed'
    if (!status.videoUrl) {
      await redis.del(jobKey);
      return NextResponse.json({ status: 'failed', error: 'missing video url' });
    }

    const r2Key = `chat-videos/${user.id}/${job.characterId}/${Date.now()}.mp4`;
    const uploaded = await uploadToR2(status.videoUrl, r2Key, 'video/mp4');
    if (!uploaded.success || !uploaded.r2Url) {
      await redis.del(jobKey);
      logger.error('chat-video:r2-upload-failed', { jobId, error: uploaded.error });
      return NextResponse.json({ status: 'failed', error: 'storage failed' });
    }

    await redis.del(jobKey);

    const { data: profile } = await supabaseAdmin
      .from('profiles').select('role,is_admin').eq('id', user.id).single();

    if (!profile || !isAdminProfile(profile)) {
      const { error: deductErr } = await supabaseAdmin.rpc('deduct_tokens', {
        p_user_id: user.id,
        p_amount: TOKEN_COST,
      });
      if (deductErr) {
        logger.error('chat-video:token-deduct-failed', { userId: user.id, error: deductErr.message });
      }
    }

    // ── Persist to conversation history ─────────────────────────────────────
    // Same reasoning as the in-chat image route: without this the video
    // only ever lived in the requesting client's React state (see
    // messages_video_url migration — video_url didn't even exist as a
    // column until now). Best-effort — a persist failure shouldn't turn an
    // already-charged, already-uploaded video into an error response.
    let messageId: string | undefined;
    let messageCreatedAt: string | undefined;
    if (job.conversationId) {
      const { data: savedMsg, error: saveErr } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: job.conversationId,
          role:            'assistant',
          content:         '',
          video_url:       uploaded.r2Url,
          tokens_used:     TOKEN_COST,
        })
        .select('id,created_at')
        .single();
      if (saveErr) {
        logger.warn('chat-video:message-persist-failed', { conversationId: job.conversationId, error: saveErr.message });
      } else if (savedMsg) {
        messageId = savedMsg.id;
        messageCreatedAt = savedMsg.created_at ?? undefined;
      }
    }

    logger.info('chat-video:completed', { userId: user.id, characterId: job.characterId, jobId, tokenCost: TOKEN_COST });

    return NextResponse.json({
      status: 'completed',
      url: uploaded.r2Url,
      tokenCost: TOKEN_COST,
      messageId,
      createdAt: messageCreatedAt,
    });
  } catch (err) {
    logger.error('chat-video-status:error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
