/**
 * POST /api/characters/import
 *
 * Takes a `.vantrix-character.json` package (as produced by
 * GET /api/characters/:id/export) and rebuilds it as a brand-new character
 * owned by the calling user — the counterpart to export that Creator Studio
 * previously had no entry point for.
 *
 * Mirrors POST /api/characters step for step (moderation gate → token
 * charge → insert → digital-person bootstrap → rollback-on-failure) so an
 * imported character is held to exactly the same bar as a freshly created
 * one, just pre-filled from the package instead of the wizard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requirePlan } from '@/lib/auth/plan';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isValidCharacterPackage, type CharacterExportPackage } from '@/lib/characters/export';
import { characterInsertFromPackage } from '@/lib/characters/import';
import { moderateCharacter } from '@/lib/moderation';
import { initializeDigitalPerson } from '@/lib/ai/digital-person-bootstrap';
import { provisionCharacterInUniverse } from '@/lib/universe/provisioning';
import { triggerAnimationAsync } from '@/lib/fal/animate-portrait';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { env } from '@/env';

export const dynamic = 'force-dynamic';

const CHARACTER_IMPORT_COST = 100; // same price as creation — an imported character is a full character, not a shortcut

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    await requirePlan(user.id, 'premium', 'Character import');

    const raw = await req.json().catch(() => null);
    // Accept either the raw package, or { package: {...} } so a client that
    // wants to send extra metadata alongside it doesn't have to reshape it.
    const candidate = raw && typeof raw === 'object' && 'package' in (raw as Record<string, unknown>)
      ? (raw as Record<string, unknown>).package
      : raw;

    if (!isValidCharacterPackage(candidate)) {
      return NextResponse.json({
        error: 'This file isn\u2019t a valid Vantrix character package.',
        code: 'INVALID_PACKAGE',
      }, { status: 400 });
    }

    const pkg = candidate as CharacterExportPackage;
    const c = pkg.character;

    if (!c?.name || !c?.description) {
      return NextResponse.json({
        error: 'Package is missing required character fields (name, description).',
        code: 'INCOMPLETE_PACKAGE',
      }, { status: 400 });
    }

    // ── MODERATION: must pass before any DB write, same as creation ────────
    const modResult = await moderateCharacter({
      name: c.name,
      description: c.description,
      personality: c.brain?.personality ?? undefined,
      backstory: c.knowledge?.backstory ?? undefined,
      scenario: c.knowledge?.scenario ?? undefined,
    });

    if (!modResult.allowed) {
      logger.warn('Character import blocked by moderation', {
        userId: user.id,
        category: modResult.category,
      });
      return NextResponse.json({
        error: modResult.reason ?? 'Content not permitted on this platform.',
        code: 'MODERATION_REJECTED',
        category: modResult.category,
      }, { status: 422 });
    }

    let r2Host: string | undefined;
    try {
      if (!env.R2_PUBLIC_URL) throw new Error('R2_PUBLIC_URL not set');
      r2Host = new URL(env.R2_PUBLIC_URL).hostname;
    } catch {
      // no R2 configured in this environment — imported images just fall back
      // to the placeholder host allowlist in characterInsertFromPackage.
    }

    const insertRow = characterInsertFromPackage(pkg, user.id, { r2Host });

    // ── TOKEN COST: charge before persisting, matching the creation route ──
    const { error: deductErr } = await supabaseAdmin.rpc('deduct_tokens', {
      p_user_id: user.id,
      p_amount: CHARACTER_IMPORT_COST,
    });

    if (deductErr) {
      const insufficientTokens = deductErr.message?.includes('insufficient_tokens');
      logger.warn('Character import token deduction failed', {
        userId: user.id, error: deductErr.message,
      });
      return NextResponse.json({
        error: insufficientTokens
          ? `You need ${CHARACTER_IMPORT_COST} Vantrix Coin to import a character.`
          : 'Token deduction failed \u2014 please try again',
        code: insufficientTokens ? 'INSUFFICIENT_TOKENS' : 'TOKEN_DEDUCT_FAILED',
      }, { status: insufficientTokens ? 402 : 500 });
    }

    const { data: character, error } = await supabaseAdmin
      .from('characters')
      .insert(insertRow)
      .select('id,name,category,active,is_public,moderation_status')
      .single();

    if (error) {
      // BILLING-FIX: refund_tokens() instead of deduct_tokens with a
      // negative amount — deduct_tokens rejects amount <= 0 at the DB
      // level, so this refund always failed before, leaving the user
      // charged with no character imported.
      await supabaseAdmin.rpc('refund_tokens', {
        p_user_id: user.id,
        p_amount: CHARACTER_IMPORT_COST,
      }).then(({ error: refundErr }) => {
        if (refundErr) {
          logger.error('Character import refund failed \u2014 user charged with no character created', {
            userId: user.id, error: refundErr.message,
          });
        }
      });
      throw error;
    }

    // ── ENFORCE DIGITAL PERSON: same non-negotiable bar as creation ────────
    const brainResult = await initializeDigitalPerson({
      characterId: character.id,
      name: insertRow.name,
      personality: insertRow.personality,
      backstory: insertRow.backstory,
      occupation: insertRow.occupation,
      category: insertRow.category,
      tags: insertRow.tags,
    });

    if (!brainResult.success) {
      logger.error('Character import rolled back \u2014 brain init failed', {
        characterId: character.id, userId: user.id,
        stage: brainResult.stage, error: brainResult.error,
      });

      await supabaseAdmin.from('characters').delete().eq('id', character.id);
      // BILLING-FIX: see refund_tokens() note above — same fix applied here.
      await supabaseAdmin.rpc('refund_tokens', {
        p_user_id: user.id,
        p_amount: CHARACTER_IMPORT_COST,
      }).then(({ error: refundErr }) => {
        if (refundErr) {
          logger.error('Character import refund failed after brain-init rollback', {
            userId: user.id, error: refundErr.message,
          });
        }
      });

      return NextResponse.json({
        error: 'Character could not be imported \u2014 please try again.',
        code: 'BRAIN_INIT_FAILED',
      }, { status: 500 });
    }

    // initializeDigitalPerson unconditionally assigns a fresh writing_style /
    // voice_profile preset (it has no way to know a package already carried
    // real ones) — restore the package's own voice if it had one, so an
    // imported character keeps the voice its creator actually built instead
    // of being silently reset to a keyword-guessed default.
    if (insertRow.voice_profile || insertRow.writing_style) {
      const { error: voiceRestoreErr } = await supabaseAdmin
        .from('characters')
        .update({
          voice_profile: insertRow.voice_profile,
          writing_style: insertRow.writing_style,
        })
        .eq('id', character.id);

      if (voiceRestoreErr) {
        logger.warn('Character import: failed to restore packaged voice profile', {
          characterId: character.id, error: voiceRestoreErr.message,
        });
      }
    }

    // Same world-identity provisioning as fresh creation — an imported
    // character gets an occupation/location/faction/reputation seed too.
    // RELIABILITY-FIX: wrapped both fire-and-forget calls in after() — see
    // the same fix in api/characters/route.ts for why a bare un-awaited
    // call here risks being killed before it ever runs.
    after(() => {
      provisionCharacterInUniverse(character.id).catch((err) => {
        logger.error('world-provisioning: fire-and-forget call threw', {
          characterId: character.id, error: String(err),
        });
      });
    });

    if (insertRow.image_url) {
      const imageUrl = insertRow.image_url; // narrow before the closure — TS can't trust the narrowing survives into after()
      after(() => {
        triggerAnimationAsync({
          characterId: character.id,
          characterSlug: character.id,
          imageUrl,
        });
      });
    }

    logger.info('Character imported', { characterId: character.id, userId: user.id });
    return NextResponse.json({
      character,
      status: 'pending_review',
      message: 'Your character was rebuilt from the package and their brain has been initialized \u2014 you can chat with them right away. They\u2019ll appear in public discovery once a staff member activates the character.',
    }, { status: 201 });
  } catch (err) {
    logger.error('Characters import POST error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
