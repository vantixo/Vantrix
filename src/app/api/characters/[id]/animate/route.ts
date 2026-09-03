/**
 * POST /api/characters/[id]/animate
 *
 * Kicks off living-portrait animation for a character's current image_url.
 * Async — the actual video arrives later via /api/webhooks/fal-animate.
 * Immediately marks video_status = 'processing' so the frontend can show a
 * "generating…" state rather than polling for a job that hasn't started.
 *
 * Not auto-triggered anywhere in the existing generation flow — see the
 * note in lib/fal/animate-portrait.ts. This is the manual entry point;
 * wire a button to it from Character Studio, or call it server-side from
 * wherever a character's image is finalized if/when auto-trigger is wanted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { triggerAnimationAsync } from '@/lib/fal/animate-portrait';
import { Ratelimit } from '@upstash/ratelimit';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

// This route had no rate limit at all — only an owner/admin auth check and
// a same-character "already processing" guard. Neither stops an owner (or
// admin) from repeatedly regenerating a character's image to re-trigger a
// fresh animate call each time (the video_status==='processing' guard only
// blocks a second call while one is *actively* in flight; back-to-back
// completed→retrigger cycles sail right through it). Each call is a
// billable Grok/fal video-generation job, same cost profile as the
// chat-video path, which does have both a per-minute and daily cap — this
// closes that gap with a modest per-user hourly ceiling.
const animateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 h'),
  analytics: true,
  prefix: 'rl:animate',
});

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: characterId } = await params;
  const { user, error: authError } = await getAuthedUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: character, error: fetchError } = await supabaseAdmin
    .from('characters')
    .select('id, image_url, creator_id, video_status')
    .eq('id', characterId)
    .maybeSingle();

  if (fetchError || !character) {
    return NextResponse.json({ error: 'character not found' }, { status: 404 });
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin, role')
    .eq('id', user.id)
    .maybeSingle();

  const isOwner = character.creator_id === user.id;
  const isAdmin = profile?.is_admin === true || profile?.role === 'admin';

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (!character.image_url) {
    return NextResponse.json({ error: 'character has no image to animate' }, { status: 400 });
  }
  const imageUrl = character.image_url; // narrow before the after() closure below

  // Avoid duplicate in-flight jobs for the same character.
  if (character.video_status === 'processing') {
    return NextResponse.json({ ok: true, alreadyProcessing: true });
  }

  // Fail closed on a Redis outage — same cost-hardening rationale as
  // checkDailyVideoCap: this gates a real, metered video-generation charge,
  // so "temporarily unavailable" is the safer failure mode than "unlimited".
  try {
    const { success } = await animateLimiter.limit(user.id);
    if (!success) {
      return NextResponse.json(
        { error: 'Animation requests are limited — please try again later' },
        { status: 429 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Animation is temporarily unavailable — please try again shortly' },
      { status: 503 },
    );
  }

  // Grok is the primary video provider now, and its flow (used by
  // triggerAnimationAsync) polls in the background and writes video_status
  // itself, rather than returning a synchronous request id — same
  // fire-and-forget shape as every other auto-trigger call site now uses.
  await supabaseAdmin
    .from('characters')
    .update({ video_status: 'processing', video_error: null })
    .eq('id', characterId);

  // RELIABILITY-FIX: this call was previously un-awaited with no waitUntil/
  // after() registration — a bare fire-and-forget call inside a serverless
  // function body. The rest of this codebase already established the
  // correct pattern for exactly this shape of work (see orchestrator.ts,
  // queue/worker.ts) because without it, Vercel is free to freeze/terminate
  // the function's execution context the instant the response below is
  // sent — which can happen before the fal.ai submit call, or even the
  // Redis budget check that precedes it, ever completes. That would leave
  // video_status stuck at 'processing' forever with no fal request ever
  // actually made and no error logged, since the code that would have
  // caught and recorded the failure never got to run. after() guarantees
  // this runs to completion regardless of when the response is flushed.
  after(() => {
    triggerAnimationAsync({
      characterId:   character.id,
      characterSlug: character.id,
      imageUrl:      imageUrl,
    });
  });

  return NextResponse.json({ ok: true });
}
