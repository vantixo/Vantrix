/**
 * POST /api/characters/generate-concept
 *
 * Powers the Character Creation Studio's Concept stage: one free-text
 * description in, a full structured character draft out (identity,
 * personality, psychology, voice, appearance) — pre-filling every later
 * stage of the wizard instead of making the creator fill ~35 fields by
 * hand. Nothing is persisted here; the wizard holds the draft client-side
 * until the creator actually submits (POST /api/characters, then PATCH the
 * rich fields — see creation-studio.tsx).
 *
 * Deliberately reuses generateStructured() (the same helper backstory-engine,
 * core-beliefs, self-esteem etc. all use) rather than hitting a provider
 * directly, so this gets the same JSON fence-stripping, error handling, and
 * platform-token accounting every other structured-generation caller gets.
 *
 * Gated like character creation itself (requirePlan 'premium') since this
 * is a real POWER-tier generation call, not a cheap NANO classification —
 * quality matters here (it's the first thing a creator sees), so this
 * intentionally costs more per call than the NANO-tier background writers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requirePlan } from '@/lib/auth/plan';
import { checkActionLimit } from '@/lib/rate-limit';
import { sanitizeField } from '@/lib/sanitize';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { moderateCharacter } from '@/lib/moderation';
import { generateStructured } from '@/lib/ai/capability';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  prompt: z.string().min(10).max(500),
  gender: z.enum(['female', 'male', 'anime', 'other']).optional(),
  // If set, this is a regeneration carrying the previous draft's name/etc.
  // forward as extra context rather than starting cold — lets "Refine with
  // AI" nudge an existing concept instead of replacing it outright.
  refineOf: z.string().max(4000).optional(),
});

// What the wizard actually needs to prefill every stage. Kept flat and
// close to the real `characters` columns (see character-builder-form.tsx's
// toFormState) so the frontend can hand most of this straight to
// saveCharacterFields() with minimal remapping.
const conceptSchema = z.object({
  name: z.string().min(1).max(80),
  age: z.number().int().min(18).max(65),
  pronouns: z.string().max(50),
  occupation: z.string().max(100),
  origin: z.string().max(500),
  category: z.string().max(50),
  description: z.string().min(10).max(1000),
  personality: z.string().max(2000),
  archetype: z.string().max(200),
  attachment_style: z.string().max(200),
  love_language: z.string().max(200),
  traits: z.object({
    openness: z.number().min(0).max(100),
    warmth: z.number().min(0).max(100),
    adventure: z.number().min(0).max(100),
    depth: z.number().min(0).max(100),
  }),
  values_list: z.array(z.string().max(60)).max(5),
  fears: z.array(z.string().max(60)).max(5),
  flaws: z.array(z.string().max(60)).max(5),
  dreams: z.array(z.string().max(60)).max(5),
  current_goal: z.string().max(500),
  daily_routine: z.array(z.string().max(80)).max(6),
  backstory: z.string().max(5000),
  scenario: z.string().max(2000),
  family_bg: z.string().max(2000),
  childhood_bg: z.string().max(2000),
  secrets: z.array(z.string().max(120)).max(3),
  friends_list: z.array(z.string().max(80)).max(5),
  opening_line: z.string().max(500),
  speech_style: z.string().max(200),
  voice: z.object({
    tone: z.number().min(0).max(100),
    energy: z.number().min(0).max(100),
    formality: z.number().min(0).max(100),
    humor: z.number().min(0).max(100),
  }),
  speech_uses: z.array(z.string().max(60)).max(4),
  speech_avoids: z.array(z.string().max(60)).max(4),
  hair_color: z.string().max(100),
  eye_color: z.string().max(100),
  body_type: z.string().max(100),
  skin_tone: z.string().max(100),
  art_style: z.string().max(100),
  clothing: z.string().max(500),
  tags: z.array(z.string().max(40)).max(8),
});

export type CharacterConceptDraft = z.infer<typeof conceptSchema>;

const SYSTEM_PROMPT = `You are Vantrix's Character Concept Director — an expert character writer for a premium AI-companion platform. Given a short creator description, invent one complete, emotionally coherent, believable character.

Respond with ONLY a single raw JSON object — no markdown fences, no commentary, no keys beyond the ones requested. Every field is required.

Guidance:
- Give the character at least one real internal contradiction (e.g. confident professionally but avoidant emotionally) and let it show in "personality" and "backstory", not as a separate field.
- traits/voice fields are integers 0-100.
- Arrays hold short, concrete phrases (a few words each), never full sentences, never placeholders like "TBD".
- "description" is the short public bio shown on the character's card. "personality", "backstory" and "scenario" can be longer prose.
- "opening_line" is the first line the character would say to someone they just matched with.
- Keep everything PG-13 — no explicit sexual content, no minors, nothing illegal.
- gender/age must stay consistent with any hint given.`;

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    await requirePlan(user.id, 'premium', 'AI character concept generation');

    const actionLimit = await checkActionLimit(user.id, 'character_concept_generate');
    if (!actionLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many concept generations recently. Try again later.', retryAt: actionLimit.reset },
        { status: 429 },
      );
    }

    const raw = await req.json().catch(() => null);
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid request', code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      }, { status: 400 });
    }

    const safePrompt = sanitizeField(parsed.data.prompt, 500);
    if (!safePrompt) {
      return NextResponse.json({ error: 'Prompt cannot be empty after sanitization', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Moderate the creator's input before spending a real generation call
    // on it — same "gate before you pay for it" shape generate-image uses
    // for its enriched prompt.
    const moderation = await moderateCharacter({ name: 'concept', description: safePrompt });
    if (!moderation.allowed) {
      logger.warn('Concept prompt rejected by moderation', { userId: user.id, reason: moderation.reason });
      return NextResponse.json({
        error: moderation.reason ?? 'That description isn\u2019t allowed on this platform.',
        code: 'CONTENT_POLICY_VIOLATION',
      }, { status: 422 });
    }

    const genderHint = parsed.data.gender ? `Gender: ${parsed.data.gender}.` : '';
    const refineContext = parsed.data.refineOf
      ? `The creator is refining an existing draft. Previous draft (JSON): ${sanitizeField(parsed.data.refineOf, 4000)}\n\nRefinement instruction: `
      : '';

    const userPrompt = `${refineContext}${safePrompt}\n${genderHint}`.trim();

    const draft = await generateStructured<CharacterConceptDraft>({
      caller: 'character-concept',
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 1600,
      temperature: 0.95,
      modelTier: 'POWER',
    });

    if (!draft) {
      return NextResponse.json({
        error: 'Couldn\u2019t generate a concept right now — please try again.',
        code: 'CONCEPT_GENERATION_FAILED',
      }, { status: 503 });
    }

    const validated = conceptSchema.safeParse(draft);
    if (!validated.success) {
      logger.warn('Concept draft failed schema validation', { userId: user.id, details: validated.error.flatten() });
      return NextResponse.json({
        error: 'Generated a concept that didn\u2019t come out right — please try again.',
        code: 'CONCEPT_GENERATION_FAILED',
      }, { status: 503 });
    }

    return NextResponse.json({ concept: validated.data, prompt: safePrompt });
  } catch (err) {
    logger.error('Character concept generation error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err
      ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
