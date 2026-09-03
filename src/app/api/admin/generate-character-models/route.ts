/**
 * POST /api/admin/generate-character-models
 *
 * Submits real image-to-3D generation jobs (fal-ai/hunyuan3d/v2, see
 * lib/fal/character-3d-model.ts) for every character that doesn't have a
 * real .glb model yet — i.e. model_status is 'none' or 'failed' (never
 * re-submits a character that's already 'processing' or 'completed'),
 * and only for characters with a real, non-placeholder image_url, since
 * there's nothing meaningful to reconstruct a 3D model from otherwise.
 *
 * ASYNC BY DESIGN: this route only submits jobs and returns — it does not
 * wait for any mesh to actually finish generating (each one can take real
 * time and this endpoint has no interest in holding a connection open for
 * dozens of them sequentially). Completion arrives later via
 * /api/webhooks/fal-3d-model, which writes model_url/model_status. Re-run
 * this route any time to pick up newly-added characters or retry ones
 * that previously failed — it's a mirror of generate-character-portraits'
 * own idempotent-batch shape for that reason.
 *
 * Requires ADMIN_SECRET_TOKEN header:
 *   curl -X POST https://vantrix.ink/api/admin/generate-character-models \
 *     -H "x-admin-secret: YOUR_ADMIN_SECRET_TOKEN"
 *
 * COST NOTE: each submission is a real $0.48 fal.ai charge (textured
 * mesh — see character-3d-model.ts) once it actually runs, gated by
 * PLATFORM_DAILY_3D_MODEL_BUDGET. Running this against the full ~65+
 * character roster in one call will submit up to that many jobs; the
 * budget guard inside generateAndPersistModelStatus caps how many
 * actually get accepted per UTC day, marking the rest 'failed' with a
 * budget-exceeded reason (safe to re-run the next day to pick those up).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireSecret } from '@/lib/security';
import { logger } from '@/lib/logger';
import { env } from '@/env';
import { generateAndPersistModelStatus } from '@/lib/fal/character-3d-model';
import { CHARACTER_IMAGE_FALLBACK } from '@/lib/utils';

export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';
export const maxDuration = 120; // submitting N jobs sequentially, not waiting for any to complete

interface ModelSubmitResult {
  name:   string;
  status: 'submitted' | 'error';
  error?: string;
}

export async function POST(req: NextRequest) {
  if (!requireSecret(req, env.ADMIN_SECRET_TOKEN)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: characters, error: fetchErr } = await supabaseAdmin
    .from('characters')
    .select('id, name, image_url, model_status')
    .in('model_status', ['none', 'failed'])
    .neq('image_url', CHARACTER_IMAGE_FALLBACK)
    .not('image_url', 'ilike', '%pollinations.ai%');

  if (fetchErr) {
    logger.error('generate-character-models:fetch-failed', { error: fetchErr.message });
    return NextResponse.json({ error: 'Failed to fetch characters' }, { status: 500 });
  }

  if (!characters || characters.length === 0) {
    return NextResponse.json({ ok: true, message: 'Every character already has a model or is in progress', summary: { total: 0, submitted: 0, errors: 0 } });
  }

  const results: ModelSubmitResult[] = [];

  for (const char of characters) {
    if (!char.image_url) {
      results.push({ name: char.name, status: 'error', error: 'no image_url to reconstruct from' });
      continue;
    }

    try {
      await generateAndPersistModelStatus({ characterId: char.id, imageUrl: char.image_url });

      // generateAndPersistModelStatus writes model_status itself (processing
      // or failed) — re-read it to report which actually happened rather
      // than assuming success.
      const { data: updated } = await supabaseAdmin
        .from('characters')
        .select('model_status, model_error')
        .eq('id', char.id)
        .maybeSingle();

      if (updated?.model_status === 'processing') {
        results.push({ name: char.name, status: 'submitted' });
        logger.info('generate-character-models:submitted', { name: char.name });
      } else {
        results.push({ name: char.name, status: 'error', error: updated?.model_error ?? 'submit did not reach processing state' });
      }
    } catch (err) {
      results.push({ name: char.name, status: 'error', error: err instanceof Error ? err.message : String(err) });
      logger.error('generate-character-models:unexpected-error', { name: char.name, error: String(err) });
    }
  }

  const summary = {
    total:     characters.length,
    submitted: results.filter(r => r.status === 'submitted').length,
    errors:    results.filter(r => r.status === 'error').length,
  };

  logger.info('generate-character-models:complete', summary);

  return NextResponse.json({ ok: true, summary, results });
}
