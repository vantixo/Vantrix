/**
 * POST /api/images/generate-batch — Streaming Batch Image Generation
 *
 * Accepts up to 64 image specs and streams results back as NDJSON
 * (newline-delimited JSON). Each line is one completed GeneratedImage:
 *   { specId: string, url: string, failed: boolean, seed?: string }
 *
 * Streaming pattern: client receives images as they finish, not all at once.
 * This means 30 images start showing in the UI at ~0.5s intervals rather
 * than waiting 16s for the whole batch.
 *
 * Consistency mode:
 *   When consistencyMode=true, all images in the batch use visualSeed
 *   prepended to the prompt. The seed is also persisted to characters.visual_seed
 *   if it was newly generated.
 *
 * Token deduction:
 *   Deducted upfront (before generation). Failed images are refunded
 *   atomically at the end.
 *
 * Max batch: 64. Parallelism: 8 concurrent generations.
 *
 * WIRE-FIX (character studio audit, 2026-07-18): this is the route the
 * frontend actually calls (components/studio/image-studio.tsx). The
 * allowMature double-gate (profiles.nsfw_enabled, see checkMatureContentAccess
 * in lib/access/character-gate.ts) only ever existed in the unreferenced,
 * dead app/api/image-studio/route.ts — deleted as part of this fix. Net
 * effect before this change: every image request here ran with Fal's
 * blanket safety checker permanently ON regardless of the user's opt-in
 * status (no bypass, just no working feature). Ported the check over;
 * moderateCharacter() below is unaffected by this flag and still runs
 * unconditionally.
 */

import { NextRequest, NextResponse }  from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { isAdminProfile } from '@/lib/auth/admin';
import { z }                           from 'zod';
import { supabaseAdmin }               from '@/lib/supabase/admin';
import { resolveEffectiveTier }        from '@/lib/rate-limit';
import { canAccessNSFW }               from '@/lib/tiers/config';
import { toErrorBody, errorLogFields }                 from '@/lib/errors';
import { logger }                      from '@/lib/logger';
import { moderateCharacter }           from '@/lib/moderation';
import {
  buildImagePrompt,
  getOrCreateSeed,
} from '@/lib/image/in-chat-image';
import type { CharacterAppearance, SceneContext } from '@/lib/image/in-chat-image';
import { generateScene, uploadToR2 } from '@/lib/fal/lora-pipeline';
import { generatePrimaryImage } from '@/lib/media/primary-image';

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
// HARDENING (heavy-load audit): was 60s. A single fal.subscribe() call can
// legitimately take up to ~60s on its own (see circuit-breaker comment in
// lora-pipeline.ts), and this route processes up to MAX_IMAGES=64 specs in
// PARALLELISM=8 batches — worst case 8 sequential batches, each bounded by
// its slowest image. At 60s/batch that's up to 480s of real work behind a
// 60s ceiling: a full-size batch (which the UI explicitly advertises as
// supported — "Queue up to 64 images") was reliably going to hit the
// platform's hard timeout mid-stream. When that happens the function is
// killed with no more code executing — the refund logic below never runs,
// so every spec that hadn't finished yet stayed paid-for and never
// delivered. Raised to the platform max used elsewhere in this app
// (see generate-character-portraits) and paired with a self-imposed
// soft deadline below so we stop *ourselves*, cleanly and with refunds,
// well before the platform would kill us.
export const maxDuration = 280;

const SOFT_DEADLINE_MS = 260_000; // stop starting new batches with this much margin before maxDuration
const PER_IMAGE_TIMEOUT_MS = 45_000; // no single image may stall a whole batch

const TOKEN_PER_IMAGE = 4;
const MAX_IMAGES      = 64;
const PARALLELISM     = 8;

const specSchema = z.object({
  id:         z.string(),
  outfit:     z.string().max(200).optional(),
  pose:       z.string().max(200).optional(),
  background: z.string().max(200).optional(),
  expression: z.string().max(100).optional(),
  style:      z.enum(['realistic', 'anime', 'artistic']).optional(),
  angle:      z.enum(['portrait', 'full_body', 'close_up', 'over_shoulder', 'selfie']).optional(),
});

const bodySchema = z.object({
  characterId:     z.string().uuid(),
  specs:           z.array(specSchema).min(1).max(MAX_IMAGES),
  consistencyMode: z.boolean().optional().default(true),
  visualSeed:      z.string().max(500).optional().nullable(),
});

type Spec = z.infer<typeof specSchema>;

function buildBatchPrompt(
  charBase: CharacterAppearance,
  spec:     Spec,
  seed:     string,
  consistency: boolean,
): { positive: string; negative: string } {
  const sceneCtx: SceneContext = {
    outfit:  spec.outfit   ?? undefined,
    setting: spec.background ?? undefined,
    action:  spec.pose      ?? undefined,
    mood:    spec.expression ?? undefined,
    angle:   spec.angle     ?? 'portrait',
    lighting: 'soft',
  };

  const charWithSeed: CharacterAppearance = {
    ...charBase,
    art_style:   spec.style ?? charBase.art_style ?? 'realistic',
    // Only inject seed when consistency mode is on
    visual_seed: consistency ? seed : undefined,
  };

  return buildImagePrompt(charWithSeed, sceneCtx);
}

async function generateOne(
  prompt:      string,
  specId:      string,
  seedNum:     number,
  idx:         number,
  characterId: string,
  loraModelId: string | null | undefined,
  userId:      string,
  negativePrompt: string,
  allowMature: boolean,
  facePrompt?: string | null,
  generationStyle?: string | null,
): Promise<{ specId: string; url: string; failed: boolean; seed?: string }> {
  const deterministicSeed = (seedNum + idx * 997) >>> 0;

  // generation_style is a scene-only camera/lighting/texture layer — appended
  // to the scene prompt, never merged into the locked face_prompt.
  const scenePrompt = generationStyle ? `${prompt}, ${generationStyle}` : prompt;

  // HARDENING: wrap the whole per-image pipeline (generation + R2 upload) in
  // a hard timeout. Without this, one slow/hung fal request inside a
  // Promise.allSettled batch of 8 stalls the entire batch (allSettled still
  // waits for every promise to settle) — under load that's how one bad
  // upstream call turns into every user's batch running long, compounding
  // the exact platform-timeout risk this route now defends against above.
  const work = (async () => {
    const generated = loraModelId
      ? await generateScene({
          characterSlug:  characterId,
          loraModelId,
          // Locked LoRA already encodes identity; including face_prompt when
          // present reinforces facial consistency at generation time.
          facePrompt:     facePrompt ?? '',
          scenePrompt,
          negativePrompt,
          seed:           deterministicSeed,
          allowMature,
        })
      : await generatePrimaryImage({ prompt: scenePrompt, negativePrompt, seed: deterministicSeed, allowMature });

    if (!generated.success || !generated.imageUrl) {
      return { specId, url: '', failed: true };
    }

    const r2Key = `studio-batch/${userId}/${characterId}/${Date.now()}-${idx}.jpg`;
    const uploaded = await uploadToR2(generated.imageUrl, r2Key);
    if (!uploaded.success || !uploaded.r2Url) {
      return { specId, url: '', failed: true };
    }

    return { specId, url: uploaded.r2Url, failed: false, seed: String(deterministicSeed) };
  })();

  const timeout = new Promise<{ specId: string; url: string; failed: boolean }>(resolve =>
    setTimeout(() => resolve({ specId, url: '', failed: true }), PER_IMAGE_TIMEOUT_MS),
  );

  return Promise.race([work, timeout]);
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const raw    = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid request', code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      }, { status: 400 });
    }

    const { characterId, specs, consistencyMode, visualSeed } = parsed.data;
    const totalCost = specs.length * TOKEN_PER_IMAGE;

    // ── Plan gate — REMOVED (ACCESS-OPEN) ─────────────────────────────────
    // studio/page.tsx explicitly documents Image Studio as available to
    // every authenticated user regardless of tier, with the token wallet
    // (checked immediately below) as the real, only limit. This route had
    // a stale `if (tier === 'free') return 403 PLAN_REQUIRED` left over
    // from before that decision — it hard-blocked every free-tier user's
    // very first click, before the token-balance check ever ran, directly
    // contradicting the page's own documented behavior and making the
    // "ACCESS-OPEN" comment there false. Removed; token balance below is
    // now the sole gate, as intended.
    const { data: profile } = await supabase
      .from('profiles').select('tier,tokens,role,is_admin,nsfw_enabled').eq('id', user.id).single();
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

    const tier = resolveEffectiveTier(profile);

    // ADMIN-FREE-TIER: admins bypass the token wallet, not just the
    // tier-gate above.
    if (!isAdminProfile(profile) && profile.tokens < totalCost) {
      return NextResponse.json({
        error: `Need ${totalCost} VC, have ${profile.tokens}`,
        code:  'INSUFFICIENT_TOKENS',
        tokensRequired:  totalCost,
        tokensAvailable: profile.tokens,
      }, { status: 402 });
    }

    // ── Fetch character ───────────────────────────────────────────────────────
    const { data: character } = await supabase
      .from('characters')
      .select('id,name,gender,age,description,personality,occupation,visual_seed,hair_color,eye_color,body_type,skin_tone,lora_model_id,face_prompt,generation_style')
      .eq('id', characterId).single();

    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

    // SEC FIX (Phase B audit, 2026-08-06): moderation only checked
    // specs[0].outfit/pose — a batch can contain up to MAX_IMAGES (64)
    // independent specs, each with its own free-text outfit/pose/
    // background/expression (up to 200/200/200/100 chars). specs[1..63]
    // were never moderated at all: a benign first spec cleared the gate
    // while every subsequent spec's content reached the image generator
    // completely unchecked. Now moderates the concatenation of every
    // spec's free-text fields in the batch, not just the first one.
    const allSpecText = specs
      .flatMap(s => [s.outfit, s.pose, s.background, s.expression])
      .filter(Boolean)
      .join(', ')
      .slice(0, 4000); // bounded — up to 64 specs could otherwise produce ~45KB
    const modCheck = await moderateCharacter({
      name:        character.name,
      description: allSpecText || character.description,
    });
    if (!modCheck.allowed) {
      return NextResponse.json({
        error: modCheck.reason ?? 'Content blocked',
        code:  'CONTENT_POLICY_VIOLATION',
      }, { status: 422 });
    }

    // ── Deduct tokens upfront (ADMIN-FREE-TIER: skip for admins) ──────────────
    if (!isAdminProfile(profile)) {
      const { error: deductErr } = await supabaseAdmin.rpc('deduct_tokens', {
        p_user_id: user.id,
        p_amount:  totalCost,
      });
      if (deductErr) {
        return NextResponse.json({
          error: 'Token deduction failed — please try again',
          code:  'TOKEN_DEDUCT_FAILED',
        }, { status: 500 });
      }
    }

    // ── Resolve visual seed ───────────────────────────────────────────────────
    const charBase: CharacterAppearance = {
      id:          character.id,
      name:        character.name,
      gender:      character.gender,
      age:         character.age,
      description: character.description,
      personality: character.personality,
      occupation:  character.occupation,
      visual_seed: visualSeed ?? character.visual_seed,
      hair_color:  (character as Record<string, unknown>).hair_color as string | null,
      eye_color:   (character as Record<string, unknown>).eye_color  as string | null,
      body_type:   (character as Record<string, unknown>).body_type  as string | null,
      skin_tone:   (character as Record<string, unknown>).skin_tone  as string | null,
    };

    const { seed, shouldPersist } = getOrCreateSeed(charBase);

    // Persist seed if new — fire-and-forget
    if (shouldPersist) {
      Promise.resolve(
        supabaseAdmin
          .from('characters')
          .update({ visual_seed: seed })
          .eq('id', character.id),
      )
        .then(() => {})
        .catch(err => logger.warn('studio:seed-persist-failed', { characterId: character.id, error: String(err) }));
    }

    const seedNum = seed.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);

    // allowMature requires the nsfw_enabled opt-in AND verified age — tier
    // no longer gates mature content (canAccessNSFW() is unconditionally
    // true), but this route was computing allowMature from nsfw_enabled
    // alone, skipping the age-verification RPC that
    // checkMatureContentAccess() (used by chat/image, chat/video, etc.)
    // requires. That meant an authenticated-but-unverified user could
    // still generate mature images here purely by flipping the
    // nsfw_enabled profile toggle. Bring this in line with the same
    // standard.
    let ageVerified = false;
    if (canAccessNSFW(tier) && profile.nsfw_enabled === true) {
      const { data: isAgeVerified } = await supabaseAdmin
        .rpc('is_user_age_verified', { p_user_id: user.id });
      ageVerified = isAgeVerified === true;
    }
    const allowMature = ageVerified;

    // ── Stream NDJSON results ─────────────────────────────────────────────────
    let failedCount = 0;
    const encoder   = new TextEncoder();
    const startedAt = Date.now();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Process specs in parallel batches of PARALLELISM
          for (let i = 0; i < specs.length; i += PARALLELISM) {
            // HARDENING: stop starting new batches once we're close to the
            // platform's own maxDuration, instead of letting the platform
            // kill the function mid-batch (which would skip the refund
            // logic entirely — see maxDuration comment above). Remaining
            // specs are reported as failed here so they get refunded below,
            // and the client sees a clean, complete stream rather than a
            // connection that just stops.
            if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
              for (let k = i; k < specs.length; k++) {
                failedCount++;
                controller.enqueue(encoder.encode(
                  JSON.stringify({ specId: specs[k].id, url: '', failed: true, timedOut: true }) + '\n',
                ));
              }
              logger.warn('studio:batch-soft-deadline-hit', {
                userId: user.id, characterId: character.id, completed: i, total: specs.length,
              });
              break;
            }

            const batch = specs.slice(i, i + PARALLELISM);

            const results = await Promise.allSettled(
              batch.map((spec, j) => {
                const { positive, negative } = buildBatchPrompt(charBase, spec, seed, consistencyMode);
                return generateOne(
                  positive, spec.id, seedNum, i + j, character.id, character.lora_model_id, user.id, negative,
                  allowMature,
                  (character as Record<string, unknown>).face_prompt as string | null,
                  (character as Record<string, unknown>).generation_style as string | null,
                );
              })
            );

            for (let k = 0; k < results.length; k++) {
              const r    = results[k];
              const spec = batch[k];
              let   line: string;

              if (r.status === 'fulfilled') {
                line = JSON.stringify(r.value) + '\n';
              } else {
                failedCount++;
                line = JSON.stringify({ specId: spec.id, url: '', failed: true }) + '\n';
                logger.warn('studio:batch-image-failed', {
                  idx: i + k, error: String(r.reason),
                });
              }

              controller.enqueue(encoder.encode(line));
            }
          }

          // Refund failed images (ADMIN-FREE-TIER: admins were never
          // charged, so skip — a refund here would just add tokens they
          // never spent).
          if (failedCount > 0 && !isAdminProfile(profile)) {
            const refund = failedCount * TOKEN_PER_IMAGE;
            await Promise.resolve(supabaseAdmin.rpc('deduct_tokens', {
              p_user_id: user.id,
              p_amount:  -refund, // negative = credit
            })).catch(err => logger.error('studio:refund-failed — user charged for failed images with no refund', {
              userId: user.id, failedCount, refund, error: String(err),
            }));
          }

          logger.info('studio:batch-complete', {
            userId:      user.id,
            characterId: character.id,
            total:       specs.length,
            failed:      failedCount,
            tokensUsed:  (specs.length - failedCount) * TOKEN_PER_IMAGE,
          });

        } catch (err) {
          logger.error('studio:stream-error', { error: String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type':  'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-store',
      },
    });

  } catch (err) {
    logger.error('studio:batch-error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
