import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyFalWebhookSignature, getFalWebhookHeaders } from '@/lib/fal/webhook-verify';
import { runCanonImageSetForCharacter } from '@/lib/fal/lora-pipeline';
import { logger } from '@/lib/logger';

// maxDuration covers both the request itself and the after() callback
// below — the canon set is 50 generations + 50 R2 uploads in batches of 5,
// which comfortably clears a typical single-image round trip but needs
// real headroom; 120s was already set on this route before this was wired
// up, which is what made after() here safe rather than a change that
// silently introduces a timeout risk.
export const maxDuration = 120;
export const dynamic     = 'force-dynamic';

interface FalWebhookBody {
  request_id: string;
  status:     'OK' | 'ERROR';
  payload?: {
    character_id?:   string;
    lora_model_url?: string;
    images?:         string[];
  };
  error?: string;
}

const ALLOWED_LORA_HOSTS = ['fal.media', 'v3.fal.media', 'fal-cdn.com'];

// Matches train-lora/route.ts's own local slugify() exactly — that route
// computed the same characterSlug when it originally submitted this
// training job, so the canon set's R2 keys need the identical derivation
// or a character's assets end up split across two slugs.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'character';
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const { requestId, userId, timestamp, signature } = getFalWebhookHeaders(req.headers);
  const verified = await verifyFalWebhookSignature(rawBody, requestId, userId, timestamp, signature);

  if (!verified) {
    logger.error('fal-lora-webhook: rejected — invalid, missing, or unverifiable signature');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: FalWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.request_id) {
    return NextResponse.json({ error: 'missing request_id' }, { status: 400 });
  }

  const idempKey = `fal_lora-${body.request_id}`;
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
    .insert({ id: idempKey, provider: 'fal_lora' });

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ ok: true, deduped: true });
    }
    logger.error('fal-lora-webhook: failed to record idempotency key', { error: insertError.message });
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }

  if (body.status === 'ERROR') {
    await supabaseAdmin
      .from('characters')
      .update({
        lora_training_status: 'failed',
        lora_training_error:  body.error ?? 'unknown error',
      })
      .eq('lora_request_id', body.request_id);

    return NextResponse.json({ ok: true });
  }

  const characterId  = body.payload?.character_id;
  const loraModelUrl = body.payload?.lora_model_url;

  if (!characterId || !loraModelUrl) {
    logger.error('fal-lora-webhook: OK status missing required payload fields', { requestId: body.request_id });
    return NextResponse.json({ error: 'malformed payload' }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(loraModelUrl);
  } catch {
    return NextResponse.json({ error: 'invalid lora_model_url' }, { status: 400 });
  }

  const hostOk = ALLOWED_LORA_HOSTS.some(
    (h) => parsedUrl.hostname === h || parsedUrl.hostname.endsWith(`.${h}`)
  );
  if (!hostOk) {
    logger.error('fal-lora-webhook: rejected lora_model_url with disallowed host', { hostname: parsedUrl.hostname });
    return NextResponse.json({ error: 'disallowed host' }, { status: 400 });
  }

  const { data: updatedCharacter, error: updateError } = await supabaseAdmin
    .from('characters')
    .update({
      lora_model_id:        loraModelUrl,
      lora_training_status: 'completed',
      lora_trained_at:      new Date().toISOString(),
    })
    .eq('id', characterId)
    .select('name, face_prompt')
    .single();

  if (updateError) {
    logger.error('fal-lora-webhook: failed to update character', { error: updateError.message, characterId });
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }

  // WIRE-FIX (production audit, 2026-07-23): kick off the 50-image canon
  // set now that a trained LoRA exists — this is the only point in the app
  // where "LoRA just finished training" is known, so it's the correct (and
  // only sane) trigger. Run via after() so Fal's webhook gets its 200
  // immediately rather than waiting out 50 generations + uploads on the
  // request path; Fal only cares that we didn't error, and a slow/failed
  // webhook response would just cause Fal to retry a training job that
  // already succeeded. face_prompt is required to reach lora_training_status
  // = 'completed' at all (train-lora/route.ts refuses to start training
  // without it), so its absence here would mean data got into an
  // inconsistent state — logged, not silently generated from nothing.
  if (updatedCharacter?.face_prompt) {
    const characterName = updatedCharacter.name;
    const facePrompt    = updatedCharacter.face_prompt;
    after(() =>
      runCanonImageSetForCharacter(characterId, {
        characterSlug: slugify(characterName),
        loraModelId:   loraModelUrl,
        facePrompt,
      })
    );
  } else {
    logger.error('fal-lora-webhook: training completed but character has no face_prompt — skipping canon set', { characterId });
  }

  return NextResponse.json({ ok: true });
}
