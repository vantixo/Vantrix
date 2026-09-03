import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyFalWebhookSignature, getFalWebhookHeaders } from '@/lib/fal/webhook-verify';
import { persist3DModelToR2 } from '@/lib/fal/character-3d-model';
import { logger } from '@/lib/logger';

export const maxDuration = 120;
export const dynamic     = 'force-dynamic';

interface FalModelWebhookBody {
  request_id: string;
  status:     'OK' | 'ERROR';
  payload?: {
    // Verified against fal-ai/hunyuan3d/v2's live output schema (checked
    // 2026-08-31): { model_mesh: { url, content_type, file_name,
    // file_size } }. Kept as an object-or-string union anyway, matching
    // fal-animate's defensive read of a field whose exact shape is only
    // pinned to one specific model version.
    model_mesh?: { url: string } | string;
  };
  error?: string;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const { requestId, userId, timestamp, signature } = getFalWebhookHeaders(req.headers);
  const verified = await verifyFalWebhookSignature(rawBody, requestId, userId, timestamp, signature);

  if (!verified) {
    logger.error('fal-3d-model-webhook: rejected — invalid, missing, or unverifiable signature');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const characterId = req.nextUrl.searchParams.get('characterId');
  if (!characterId) {
    return NextResponse.json({ error: 'missing characterId' }, { status: 400 });
  }

  let body: FalModelWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.request_id) {
    return NextResponse.json({ error: 'missing request_id' }, { status: 400 });
  }

  // Idempotency — same pattern as fal-animate/fal-lora's webhooks, in case
  // fal.ai retries delivery.
  const idempKey = `fal_3d_model-${body.request_id}`;
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
    .insert({ id: idempKey, provider: 'fal_3d_model' });

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ ok: true, deduped: true });
    }
    logger.error('fal-3d-model-webhook: failed to record idempotency key', { error: insertError.message });
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }

  if (body.status === 'ERROR') {
    await supabaseAdmin
      .from('characters')
      .update({
        model_status: 'failed',
        model_error:  body.error ?? 'unknown error',
      })
      .eq('id', characterId);

    return NextResponse.json({ ok: true });
  }

  const meshField = body.payload?.model_mesh;
  const falModelUrl = typeof meshField === 'string' ? meshField : meshField?.url;

  if (!falModelUrl) {
    logger.error('fal-3d-model-webhook: OK status missing model_mesh url in payload', { requestId: body.request_id });
    await supabaseAdmin
      .from('characters')
      .update({ model_status: 'failed', model_error: 'malformed payload: no model_mesh url' })
      .eq('id', characterId);
    return NextResponse.json({ error: 'malformed payload' }, { status: 400 });
  }

  const { data: character } = await supabaseAdmin
    .from('characters')
    .select('id')
    .eq('id', characterId)
    .maybeSingle();

  if (!character) {
    logger.error('fal-3d-model-webhook: character not found', { characterId });
    return NextResponse.json({ error: 'character not found' }, { status: 404 });
  }

  const upload = await persist3DModelToR2(character.id, falModelUrl);

  if (!upload.success || !upload.r2Url) {
    logger.error('fal-3d-model-webhook: R2 upload failed', { error: upload.error, characterId });
    await supabaseAdmin
      .from('characters')
      .update({ model_status: 'failed', model_error: upload.error ?? 'R2 upload failed' })
      .eq('id', characterId);
    return NextResponse.json({ error: 'storage failed' }, { status: 500 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('characters')
    .update({
      model_url:          upload.r2Url,
      model_status:       'completed',
      model_error:        null,
      model_generated_at: new Date().toISOString(),
    })
    .eq('id', characterId);

  if (updateError) {
    logger.error('fal-3d-model-webhook: failed to update character', { error: updateError.message, characterId });
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
