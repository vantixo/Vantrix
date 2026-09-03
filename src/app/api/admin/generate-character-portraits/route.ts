/**
 * POST /api/admin/generate-character-portraits
 *
 * Generates real Fal.ai portraits for any character that doesn't have one
 * yet — either because it's a fresh migration-seeded character still on the
 * default placeholder (/images/character-placeholder.png), or because it's
 * legacy data left over from before this fix, still pointing at a
 * Pollinations.ai URL. Both cases are handled by the same code path here
 * rather than two separate admin routes, since the actual work — generate
 * via Fal.ai, upload to R2, write the URL back — is identical either way.
 *
 * Character ROWS come from a migration (supabase/migrations/20260701_seed_
 * launch_characters.sql) and are deliberately seeded without an image_url,
 * so they display immediately without waiting on this route at all — this
 * only handles getting them a real portrait afterward.
 *
 * This route previously (as two separate routes — seed-characters and
 * backfill-images) either generated a Pollinations.ai URL directly, or
 * re-fetched an existing Pollinations image and relocated it to Supabase
 * Storage — neither ever produced an actual Fal.ai-generated image. Every
 * image this route produces now goes through the same Fal.ai + R2 pipeline
 * used everywhere else in the app (see lib/fal/lora-pipeline.ts).
 *
 * Requires ADMIN_SECRET_TOKEN header:
 *   curl -X POST https://vantrix.ink/api/admin/generate-character-portraits \
 *     -H "x-admin-secret: YOUR_ADMIN_SECRET_TOKEN"
 *
 * Idempotent — only touches characters that still need a real portrait;
 * already-portraited characters are left untouched, so this is safe to
 * re-run (e.g. after adding new seed characters) without regenerating
 * everything.
 */

import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { requireSecret }             from '@/lib/security';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { uploadToR2 } from '@/lib/fal/lora-pipeline';
import { generatePrimaryImage } from '@/lib/media/primary-image';
import { buildAppearancePrompt, type CharacterAppearance } from '@/lib/image/in-chat-image';
import { CHARACTER_IMAGE_FALLBACK } from '@/lib/utils';
import { triggerAnimationAsync } from '@/lib/fal/animate-portrait';

export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';
export const maxDuration = 300; // several sequential Fal generations can take a while

interface PortraitResult {
  name:   string;
  status: 'generated' | 'error';
  error?: string;
}

function buildPortraitPrompt(char: CharacterAppearance): string {
  const appearance = buildAppearancePrompt(char);
  const style = char.art_style === 'anime' ? 'anime style illustration' : 'photorealistic portrait photograph';
  return [
    style,
    appearance,
    char.occupation ?? '',
    'professional photography, sharp focus, cinematic lighting, upper body portrait',
  ].filter(Boolean).join(', ');
}

export async function POST(req: NextRequest) {
  if (!requireSecret(req, env.ADMIN_SECRET_TOKEN)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Covers both cases in one query: fresh migration-seeded characters still
  // on the placeholder, and legacy rows still pointing at a Pollinations URL.
  const { data: characters, error: fetchErr } = await supabaseAdmin
    .from('characters')
    .select('id, name, gender, age, description, personality, occupation, hair_color, eye_color, body_type, skin_tone, image_url')
    .or(`image_url.eq.${CHARACTER_IMAGE_FALLBACK},image_url.ilike.%pollinations.ai%`);

  if (fetchErr) {
    logger.error('generate-character-portraits:fetch-failed', { error: fetchErr.message });
    return NextResponse.json({ error: 'Failed to fetch characters' }, { status: 500 });
  }

  if (!characters || characters.length === 0) {
    return NextResponse.json({ ok: true, message: 'Every character already has a real portrait', summary: { total: 0, generated: 0, errors: 0 } });
  }

  const results: PortraitResult[] = [];

  for (const char of characters) {
    try {
      const prompt = buildPortraitPrompt(char as CharacterAppearance);
      const generated = await generatePrimaryImage({ prompt, imageSize: 'portrait_4_3' });

      if (!generated.success || !generated.imageUrl) {
        results.push({ name: char.name, status: 'error', error: generated.error ?? 'generation_failed' });
        logger.error('generate-character-portraits:generation-failed', { name: char.name, provider: generated.provider, error: generated.error });
        continue;
      }

      const r2Key = `characters/${char.id}/portrait-${Date.now()}.jpg`;
      const uploaded = await uploadToR2(generated.imageUrl, r2Key);

      if (!uploaded.success || !uploaded.r2Url) {
        results.push({ name: char.name, status: 'error', error: uploaded.error ?? 'r2_upload_failed' });
        logger.error('generate-character-portraits:r2-failed', { name: char.name, error: uploaded.error });
        continue;
      }

      const r2Url = uploaded.r2Url;

      const { error: updateErr } = await supabaseAdmin
        .from('characters')
        .update({ image_url: r2Url })
        .eq('id', char.id);

      if (updateErr) {
        results.push({ name: char.name, status: 'error', error: updateErr.message });
        continue;
      }

      // Auto-trigger living-portrait animation for the (re)generated
      // portrait. Fire-and-forget — a failed/slow animate submit must not
      // fail the batch portrait job. Wrapped in after(): this call sat
      // inside a loop with more awaited work after it in most iterations,
      // which partly masked the risk, but the *last* character in the
      // batch had zero buffer before the function returns — same fix as
      // every other triggerAnimationAsync call site, for the same reason.
      after(() => {
        triggerAnimationAsync({
          characterId:   char.id,
          characterSlug: char.id,
          imageUrl:      r2Url,
        });
      });

      results.push({ name: char.name, status: 'generated' });
      logger.info('generate-character-portraits:success', { name: char.name });
    } catch (err) {
      results.push({ name: char.name, status: 'error', error: err instanceof Error ? err.message : String(err) });
      logger.error('generate-character-portraits:unexpected-error', { name: char.name, error: String(err) });
    }
  }

  const summary = {
    total:     characters.length,
    generated: results.filter(r => r.status === 'generated').length,
    errors:    results.filter(r => r.status === 'error').length,
  };

  logger.info('generate-character-portraits:complete', summary);

  return NextResponse.json({ ok: true, summary, results });
}
