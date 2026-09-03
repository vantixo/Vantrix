import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { z }                from 'zod';
import { checkImageLimit, checkDailyImageCap, normalizeTier } from '@/lib/rate-limit';
import { sanitizeField }    from '@/lib/sanitize';
import { toErrorBody, errorLogFields }      from '@/lib/errors';
import { logger }           from '@/lib/logger';
import { requirePlan }      from '@/lib/auth/plan';
import { moderateCharacter } from '@/lib/moderation';
import { uploadToR2 } from '@/lib/fal/lora-pipeline';
import { generatePrimaryImage } from '@/lib/media/primary-image';

export const dynamic = 'force-dynamic';

const schema = z.object({
  prompt:      z.string().min(3).max(500),
  style:       z.enum(['realistic', 'anime', 'artistic']).optional().default('realistic'),
  width:       z.number().int().min(256).max(1024).optional().default(768),   // raised from 512
  height:      z.number().int().min(256).max(1536).optional().default(1152),  // raised from 768
  // Appearance fields — collected in creation form but previously ignored
  hair_color:  z.string().max(50).optional(),
  eye_color:   z.string().max(50).optional(),
  body_type:   z.string().max(50).optional(),
  skin_tone:   z.string().max(50).optional(),
  age:         z.number().int().min(18).max(80).optional(),
  occupation:  z.string().max(100).optional(),
  gender:      z.enum(['female', 'male', 'non-binary']).optional(),
});

/**
 * Build a rich, appearance-aware prompt that uses ALL collected fields.
 * Previously only prompt[:200] + occupation were used.
 */
function buildEnrichedPrompt(data: {
  prompt:     string;
  style:      string;
  hair_color?:string;
  eye_color?: string;
  body_type?: string;
  skin_tone?: string;
  age?:       number;
  occupation?:string;
  gender?:    string;
}): string {
  const styleToken  = data.style === 'anime' ? 'anime art style, cel shaded' : data.style === 'artistic' ? 'oil painting, artistic portrait' : 'photorealistic, 8k, professional photography';
  const appearance  = [
    data.hair_color  ? `${data.hair_color} hair`      : '',
    data.eye_color   ? `${data.eye_color} eyes`       : '',
    data.body_type   ? `${data.body_type} build`      : '',
    data.skin_tone   ? `${data.skin_tone} skin tone`  : '',
    data.age         ? `${data.age} years old`        : '',
    data.occupation  ? `${data.occupation}`           : '',
  ].filter(Boolean).join(', ');

  // GENDER-IMAGE-FIX: this previously treated anything that wasn't
  // exactly 'male' or 'non-binary' — including gender being omitted
  // entirely, since the field is optional — as female, defaulting to
  // "1 woman,". That's the actual mechanism behind male characters
  // silently getting generated with a woman's likeness whenever the
  // caller forgot to pass gender. Now: an explicit, known gender maps to
  // its correct token; anything missing/unrecognized gets NO gender token
  // at all rather than a wrong one, so the image generator infers from
  // the rest of the prompt instead of being told the wrong gender.
  const genderToken =
    data.gender === 'male'       ? '1 man,' :
    data.gender === 'female'     ? '1 woman,' :
    data.gender === 'non-binary' ? '1 person (non-binary),' :
    '';

  return [
    styleToken,
    genderToken,
    appearance,
    data.prompt.slice(0, 300),
    'portrait, face visible, high quality, detailed, beautiful lighting',
  ].filter(Boolean).join(', ');
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const { tier: rawTier } = await requirePlan(user.id, 'premium', 'Image generation');
    const tier = normalizeTier(rawTier);

    const rateLimit = await checkImageLimit(user.id, tier);
    if (!rateLimit.allowed) {
      return NextResponse.json({
        error: `Image generation limit reached: ${rateLimit.limit}/min on ${tier} plan`,
        code: 'RATE_LIMIT_EXCEEDED', rateLimit,
      }, { status: 429 });
    }

    // H-03: burst limiter above only guards per-minute abuse — this enforces
    // the actual daily figure promised on the pricing page.
    const dailyImageCap = await checkDailyImageCap(user.id, tier);
    if (!dailyImageCap.allowed) {
      return NextResponse.json({
        error: `Daily image generation limit reached: ${dailyImageCap.limit}/day on ${tier} plan`,
        code: 'DAILY_LIMIT_EXCEEDED', dailyImageCap,
      }, { status: 429 });
    }

    const raw    = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid request', code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      }, { status: 400 });
    }

    const safePrompt = sanitizeField(parsed.data.prompt, 500);
    if (!safePrompt) {
      return NextResponse.json({
        error: 'Prompt cannot be empty after sanitization', code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    // SEC FIX (Phase B audit, 2026-08-06): the LOW-3 fix below moderates
    // safePrompt, but hair_color/eye_color/body_type/skin_tone/occupation
    // are free-text fields (up to 100 chars each, unsanitized) that get
    // concatenated straight into enrichedPrompt further down — the actual
    // text sent to the image provider. None of them passed through
    // sanitizeField() or moderation, so e.g. body_type could carry
    // explicit content and reach the image generator untouched. Sanitized
    // here so moderation below (which needs to run on the full enriched
    // text, not just the main prompt) sees the same content the provider
    // will.
    const safeAppearance = {
      hair_color: parsed.data.hair_color ? sanitizeField(parsed.data.hair_color, 50) : undefined,
      eye_color:  parsed.data.eye_color  ? sanitizeField(parsed.data.eye_color, 50)  : undefined,
      body_type:  parsed.data.body_type  ? sanitizeField(parsed.data.body_type, 50)  : undefined,
      skin_tone:  parsed.data.skin_tone  ? sanitizeField(parsed.data.skin_tone, 50)  : undefined,
      occupation: parsed.data.occupation ? sanitizeField(parsed.data.occupation, 100) : undefined,
    };

    const { width, height, style, age, gender } = parsed.data;

    // Build enriched prompt using all appearance fields
    const enrichedPrompt = buildEnrichedPrompt({
      prompt:     safePrompt,
      style:      style ?? 'realistic',
      age, gender,
      ...safeAppearance,
    });

    // LOW-3 (extended): moderate the FULL enriched prompt — appearance
    // fields are part of what's actually sent to the image provider, so a
    // safe main prompt paired with a policy-violating appearance field
    // must not slip through.
    const moderation = await moderateCharacter({ name: 'image', description: enrichedPrompt });
    if (!moderation.allowed) {
      logger.warn('Image prompt rejected by moderation', { userId: user.id, reason: moderation.reason });
      return NextResponse.json({
        error: 'Image prompt rejected by content moderation',
        reason: moderation.reason,
        code: 'CONTENT_POLICY_VIOLATION',
      }, { status: 422 });
    }


    // No LoRA branch here — this generates a preview during character
    // CREATION, before any character row (and therefore any trained LoRA)
    // exists. LoRA training happens afterward, once the character is saved;
    // see lib/fal/lora-pipeline.ts trainCharacterLoRA().
    const imageSize = height > width ? 'portrait_4_3' : width > height ? 'landscape_16_9' : 'square';

    // Grok is primary; fal.ai is only used as an outage fallback (never for
    // content-policy rejections — see generatePrimaryImage()). Moderation
    // already ran above, unconditionally, before either provider is called.
    const generated = await generatePrimaryImage({ prompt: enrichedPrompt, imageSize });
    const providerUsed = generated.provider;

    if (!generated.success || !generated.imageUrl) {
      return NextResponse.json({
        error: 'Image generation is temporarily unavailable — please try again in a moment',
        code:  'IMAGE_PROVIDER_DOWN',
      }, { status: 503 });
    }

    // Both providers' result URLs expire — upload to R2 for a permanent one
    // before returning it to the client, same as every other generation path.
    const r2Key = `character-previews/${user.id}/${Date.now()}.jpg`;
    const uploaded = await uploadToR2(generated.imageUrl, r2Key);
    if (!uploaded.success || !uploaded.r2Url) {
      return NextResponse.json({
        error: 'Image generation is temporarily unavailable — please try again in a moment',
        code:  'IMAGE_PROVIDER_DOWN',
      }, { status: 503 });
    }

    return NextResponse.json({ url: uploaded.r2Url, rateLimit, enrichedPrompt, provider: providerUsed });

  } catch (err) {
    logger.error('Image gen error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err
      ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
