import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyFalWebhookSignature, getFalWebhookHeaders } from '@/lib/fal/webhook-verify';
import { persistAnimatedVideoToR2 } from '@/lib/fal/animate-portrait';
import { logger } from '@/lib/logger';

export const maxDuration = 120;
export const dynamic     = 'force-dynamic';

interface FalAnimateWebhookBody {
  request_id: string;
  status:     'OK' | 'ERROR';
  payload?: {
    video?: { url: string } | string; // fal's response shape varies by model — check against the live payload
  };
  error?: string;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const { requestId, userId, timestamp, signature } = getFalWebhookHeaders(req.headers);
  const verified = await verifyFalWebhookSignature(rawBody, requestId, userId, timestamp, signature);

  if (!verified) {
    logger.error('fal-animate-webhook: rejected — invalid, missing, or unverifiable signature');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const characterId = req.nextUrl.searchParams.get('characterId');
  if (!characterId) {
    return NextResponse.json({ error: 'missing characterId' }, { status: 400 });
  }

  let body: FalAnimateWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.request_id) {
    return NextResponse.json({ error: 'missing request_id' }, { status: 400 });
  }

  // Idempotency — same pattern as fal-lora's webhook, in case fal.ai retries delivery.
  const idempKey = `fal_animate-${body.request_id}`;
  const { data: existing } = await supabaseAdmin
    .from('processed_webhooks')
    .select('id')
    .eq('id', idempKey)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const { error: insertError } = await supabaseAdmin
    .from('processed_webhooks')
    .insert({ id: idempKey, provider: 'fal_animate' });

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ ok: true, deduped: true });
    }
    logger.error('fal-animate-webhook: failed to record idempotency key', { error: insertError.message });
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }

  if (body.status === 'ERROR') {
    await supabaseAdmin
      .from('characters')
      .update({
        video_status: 'failed',
        video_error:  body.error ?? 'unknown error',
      })
      .eq('id', characterId);

    return NextResponse.json({ ok: true });
  }

  // fal's response shape for the video output varies by model — this reads
  // both common shapes (nested object with .url, or a bare string). Confirm
  // the exact shape against the live payload for whichever model
  // FAL_ANIMATE_MODEL ends up being, and adjust if needed.
  const videoField = body.payload?.video;
  const falVideoUrl = typeof videoField === 'string' ? videoField : videoField?.url;

  if (!falVideoUrl) {
    logger.error('fal-animate-webhook: OK status missing video url in payload', { requestId: body.request_id });
    await supabaseAdmin
      .from('characters')
      .update({ video_status: 'failed', video_error: 'malformed payload: no video url' })
      .eq('id', characterId);
    return NextResponse.json({ error: 'malformed payload' }, { status: 400 });
  }

  const { data: character } = await supabaseAdmin
    .from('characters')
    .select('id')
    .eq('id', characterId)
    .maybeSingle();

  if (!character) {
    logger.error('fal-animate-webhook: character not found', { characterId });
    return NextResponse.json({ error: 'character not found' }, { status: 404 });
  }

  const upload = await persistAnimatedVideoToR2(character.id, falVideoUrl);

  if (!upload.success || !upload.r2Url) {
    logger.error('fal-animate-webhook: R2 upload failed', { error: upload.error, characterId });
    await supabaseAdmin
      .from('characters')
      .update({ video_status: 'failed', video_error: upload.error ?? 'R2 upload failed' })
      .eq('id', characterId);
    return NextResponse.json({ error: 'storage failed' }, { status: 500 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('characters')
    .update({
      video_url:         upload.r2Url,
      video_status:      'completed',
      video_error:        null,
      video_generated_at: new Date().toISOString(),
    })
    .eq('id', characterId);

  if (updateError) {
    logger.error('fal-animate-webhook: failed to update character', { error: updateError.message, characterId });
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
