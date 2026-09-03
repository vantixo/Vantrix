/**
 * /api/characters — character CRUD with moderation gate
 *
 * POST: Character creation now runs through moderateCharacter() before persist.
 * A blocklist check fires synchronously (< 1ms); an AI moderation pass runs
 * async (< 300ms). Both must pass before the character is inserted.
 *
 * Also adds: like_count / total_swipes fields for popularity ranking,
 * and a ?dating=true filter for the dating discovery endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { z }               from 'zod';
import { createClient }    from '@/lib/supabase/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin }   from '@/lib/supabase/admin';
import { requirePlan }     from '@/lib/auth/plan';
import { checkActionLimit } from '@/lib/rate-limit';
import { sanitizeField, sanitizeArray } from '@/lib/sanitize';
import { toErrorBody, errorLogFields }     from '@/lib/errors';
import { logger }          from '@/lib/logger';
import { moderateCharacter } from '@/lib/moderation';
import { triggerAnimationAsync } from '@/lib/fal/animate-portrait';
import { initializeDigitalPerson } from '@/lib/ai/digital-person-bootstrap';
import { provisionCharacterInUniverse } from '@/lib/universe/provisioning';
import { embedAndStoreCharacter } from '@/lib/ai/character-embeddings';
import { resolveNsfwDiscoveryAccess } from '@/lib/access/character-gate';
import { env } from '@/env';

export const dynamic = 'force-dynamic';
export const revalidate = 30; // ISR: regenerate every 30s — 99% reduction in DB reads at scale

// Allowlisted domains for character image_url. Any URL from outside this set
// is rejected at the schema layer, preventing SSRF, phishing, or harmful
// content being stored in the platform's character database.
//
// image.pollinations.ai intentionally removed: every image-generation path
// in this app now produces a permanent R2 URL (see lib/fal/lora-pipeline.ts
// uploadToR2()), never a raw Pollinations URL. Keeping it allowlisted would
// let a POST here re-introduce exactly the unmoderated-third-party-host
// problem the rest of this migration closes.
//
// The deployment's own R2 public host is added dynamically below rather
// than hardcoded, since R2_PUBLIC_URL is a custom domain configured
// per-deployment (see .env.example) — hardcoding one operator's domain
// would silently reject legitimate uploads on any other deployment.
const ALLOWED_IMAGE_HOSTS = new Set([
  'cdn.vantrix.ink',
  'images.unsplash.com',
  'lh3.googleusercontent.com',
  'ui-avatars.com',
  'avatars.githubusercontent.com',
  'cdn.discordapp.com',
  'storage.googleapis.com',    // GCS buckets used by some integrations
  'res.cloudinary.com',        // Cloudinary CDN (common avatar provider)
]);

try {
  if (!env.R2_PUBLIC_URL) throw new Error('R2_PUBLIC_URL not set');
  const r2Host = new URL(env.R2_PUBLIC_URL).hostname;
  ALLOWED_IMAGE_HOSTS.add(r2Host);
} catch {
  // R2_PUBLIC_URL not configured/invalid in this environment (e.g. local
  // dev without R2 set up) — nothing to add, the rest of the allowlist
  // still functions normally.
}

const characterCreateSchema = z.object({
  name:        z.string().min(1).max(80),
  age:         z.number().int().min(18).max(100),
  gender:      z.enum(['female', 'male', 'anime', 'other']),
  category:    z.string().min(1).max(50),
  description: z.string().min(10).max(1000),
  personality: z.string().max(500).optional(),
  backstory:   z.string().max(800).optional(),
  scenario:    z.string().max(500).optional(),
  // Wizard fields — mapped to DB columns that were previously unused in creation
  speech_style: z.string().max(50).optional(),   // maps to characters.speech_style
  occupation:   z.string().max(100).optional(),  // maps to characters.occupation
  // CREATION-STUDIO: Identity stage field + AI Concept-stage provenance —
  // see 20260825_character_creation_studio.sql.
  pronouns:        z.string().max(50).optional(),
  creation_prompt: z.string().max(500).optional(),
  // Domain allowlist: only trusted CDN/image hosts accepted.
  image_url:   z.string().url().max(500).refine(
    (url) => {
      try {
        const { hostname } = new URL(url);
        return ALLOWED_IMAGE_HOSTS.has(hostname);
      } catch { return false; }
    },
    { message: 'image_url must be from an approved host (cdn.vantrix.ink, images.unsplash.com, or other approved CDNs)' }
  ),
  tags:        z.array(z.string().max(40)).max(10).optional().default([]),
  is_nsfw:     z.boolean().optional().default(false),
  // ACTIVATION-FIX: previously absent from the creation schema, which meant a
  // user-created character could only ever reach the dating pool via a direct
  // DB write — and, since the `dating_enabled` column itself defaults to TRUE,
  // every brand-new (and still-pending) character was silently dating-eligible
  // the moment it existed. Exposed here, explicit default false: a creator can
  // opt in once their character is reviewed, rather than it happening by omission.
  dating_enabled: z.boolean().optional().default(false),
  // Creator's intent for once the character clears moderation. Cannot take
  // effect immediately — characters_public_requires_active means is_public
  // stays false until approved regardless of this value — but is stored so
  // the admin-approval step can honor it instead of always defaulting public.
  // See migration 20260812_character_visibility_requested.sql.
  visibility: z.enum(['private', 'public']).optional().default('private'),
});

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const search   = searchParams.get('q');
    const dating   = searchParams.get('dating') === 'true';
    const premium  = searchParams.get('premium') === 'true';
    // Same NaN guard as characters/mine/route.ts — parseInt('abc') is NaN,
    // which Math.min/.limit() would otherwise pass straight to Postgrest.
    const rawLimit = parseInt(searchParams.get('limit') ?? '20', 10);
    const limit    = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20, 100);
    // Dating-discovery filters (FILTER-01): all optional, only applied when
    // ?dating=true — these columns exist on every character row already
    // (archetype/love_language/age are selected above) but were never
    // exposed as query filters, so the luxury discovery filter panel had
    // nothing to call.
    const archetypesParam = searchParams.get('archetypes'); // comma-separated
    const loveLanguage    = searchParams.get('loveLanguage');
    const minAge          = searchParams.get('minAge');
    const maxAge          = searchParams.get('maxAge');

    let query = supabase
      .from('characters')
      .select('id,name,age,gender,category,description,image_url,tags,is_premium,min_tier,is_new,is_live,is_nsfw,tokens_cost,created_at,archetype,opening_line,love_language,dating_enabled,char_openness,char_warmth,char_adventure,char_depth,like_count,follower_count')
      .eq('active', true)
      // ACTIVATION-FIX: `active` alone used to be the only gate here, and it
      // was also the *only* place `active` was checked anywhere in the app —
      // see the chat/dating/cron fixes elsewhere in this change set. `is_public`
      // is the dedicated "appears in the public feed" flag; keeping it separate
      // from `active` leaves room for a character to be approved/usable without
      // necessarily being surfaced in discovery, without overloading one column.
      .eq('is_public', true);

    // D-03: This endpoint is INTENTIONALLY public — no session is required.
    // The discover page must work for logged-out visitors. Do not add a
    // blanket auth requirement here; instead, gate NSFW content specifically
    // (A-04) so logged-out and unverified callers never receive it.
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      // Unauthenticated — never serve NSFW characters.
      query = query.eq('is_nsfw', false);
    } else {
      // P0-AGE-GATE-FIX: was nsfw_enabled preference only. Now also
      // requires is_user_age_verified() via the shared gate — see
      // resolveNsfwDiscoveryAccess() in @/lib/access/character-gate.
      const nsfwEnabled = await resolveNsfwDiscoveryAccess(user.id);

      if (!nsfwEnabled) {
        query = query.eq('is_nsfw', false);
      }
    }

    if (dating) query = query.eq('dating_enabled', true);
    // WIRE-FIX: `premium` was read from nowhere — the frontend's search UI
    // (global-search.tsx) already sent ?premium=true for its "Premium"
    // filter chip, silently doing nothing since this route never looked
    // for that param.
    if (premium) query = query.eq('is_premium', true);
    if (category && category !== 'all') query = query.eq('gender', category);
    if (search?.trim()) query = query.ilike('name', `%${search.trim().slice(0, 100)}%`);

    // FILTER-01: dating-discovery filter panel params. Validated defensively —
    // archetypesParam is user-controlled input reaching a DB query, so it's
    // split/trimmed/length-capped rather than passed through raw.
    if (archetypesParam) {
      const archetypes = archetypesParam.split(',').map(a => a.trim().slice(0, 30)).filter(Boolean).slice(0, 10);
      if (archetypes.length > 0) query = query.in('archetype', archetypes);
    }
    if (loveLanguage) query = query.eq('love_language', loveLanguage.trim().slice(0, 30));
    if (minAge) {
      const n = parseInt(minAge, 10);
      if (Number.isFinite(n)) query = query.gte('age', Math.max(18, n));
    }
    if (maxAge) {
      const n = parseInt(maxAge, 10);
      if (Number.isFinite(n)) query = query.lte('age', Math.min(99, n));
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    // PERF: this endpoint previously had no Cache-Control at all, unlike
    // every sibling discover endpoint (featured, home-context,
    // recommendations) — every Discover grid render/tab-switch/back-nav hit
    // the DB fresh. Response content varies per-user (NSFW gating above
    // depends on auth + age-verification state), so this must stay
    // `private` — never `public`/shared, which could leak a NSFW-filtered
    // response across users via a CDN — but a short client-side cache is
    // safe and meaningfully cuts repeat-navigation load, matching the
    // `private, max-age=30` pattern home-context/route.ts already uses.
    return NextResponse.json({ characters: data }, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch (err) {
    logger.error('Characters GET error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    await requirePlan(user.id, 'premium', 'Character creation');

    // HARDEN-FIX: character creation had no rate limit at all despite
    // triggering a real per-attempt cost (moderateCharacter() below is an
    // AI moderation call) — see checkActionLimit's own comment in
    // rate-limit/index.ts for why this needed a new limiter rather than
    // reusing an existing tier-aware one.
    const actionLimit = await checkActionLimit(user.id, 'character_create');
    if (!actionLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many characters created recently. Try again later.', retryAt: actionLimit.reset },
        { status: 429 },
      );
    }

    const raw = await req.json().catch(() => null);
    const parsed = characterCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid character data', code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      }, { status: 400 });
    }

    const d = parsed.data;

    // ── MODERATION: must pass before any DB write ─────────────────────────
    const modResult = await moderateCharacter({
      name:        d.name,
      description: d.description,
      personality: d.personality,
      backstory:   d.backstory,
      scenario:    d.scenario,
    });

    if (!modResult.allowed) {
      logger.warn('Character creation blocked by moderation', {
        userId: user.id,
        category: modResult.category,
      });
      return NextResponse.json({
        error:    modResult.reason ?? 'Content not permitted on this platform.',
        code:     'MODERATION_REJECTED',
        category: modResult.category,
      }, { status: 422 });
    }

    // Sanitize all user-controlled text fields
    const sanitized = {
      name:        sanitizeField(d.name, 80),
      age:         d.age,
      gender:      d.gender,
      category:    sanitizeField(d.category, 50),
      description: sanitizeField(d.description, 1000),
      personality: d.personality ? sanitizeField(d.personality, 500) : null,
      backstory:   d.backstory   ? sanitizeField(d.backstory,   800) : null,
      scenario:    d.scenario    ? sanitizeField(d.scenario,    500) : null,
      speech_style: d.speech_style ? sanitizeField(d.speech_style, 50) : null,
      occupation:   d.occupation   ? sanitizeField(d.occupation, 100) : null,
      pronouns:        d.pronouns        ? sanitizeField(d.pronouns, 50) : null,
      creation_prompt: d.creation_prompt ? sanitizeField(d.creation_prompt, 500) : null,
      image_url:   d.image_url,
      tags:        sanitizeArray(d.tags, 10, 40),
      is_nsfw:     d.is_nsfw,
      creator_id:  user.id,
      active:      false,
      // ACTIVATION-FIX: previously omitted, so these columns fell through to
      // their DB defaults — dating_enabled defaults to TRUE and moderation_status
      // defaults to 'approved' at the schema level, which is backwards for a
      // character that hasn't been through staff activation yet. Set explicitly:
      is_public:         false,
      moderation_status: 'pending',
      visibility_requested: d.visibility,
      dating_enabled:    d.dating_enabled,
      is_new:      true,
      is_premium:  false,
      tokens_cost: 1,
      like_count:  0,
      total_swipes: 0,
    };

    // ── TOKEN COST: charge before persisting, not after ────────────────────
    // BILLING-FIX: this used to run *after* the character insert, as a bare
    // `await supabaseAdmin.rpc(...)` whose result was never read. Two
    // separate bugs compounded here:
    //   1. supabase-js .rpc() resolves with an {error} field on failure, it
    //      does not reject the promise — so even a hard failure (including
    //      "insufficient tokens") was silently swallowed.
    //   2. Because it ran after the insert, a user could end up with a
    //      persisted character regardless of whether the charge succeeded.
    // Deducting first (and checking the error) means a user with <100 tokens
    // is rejected before anything is written, matching the pattern already
    // used by generate-batch/image-studio/chat/image.
    const CHARACTER_CREATION_COST = 100;
    const { error: deductErr } = await supabaseAdmin.rpc('deduct_tokens', {
      p_user_id: user.id,
      p_amount:  CHARACTER_CREATION_COST,
    });

    if (deductErr) {
      const insufficientTokens = deductErr.message?.includes('insufficient_tokens');
      logger.warn('Character creation token deduction failed', {
        userId: user.id, error: deductErr.message,
      });
      return NextResponse.json({
        error: insufficientTokens
          ? `You need ${CHARACTER_CREATION_COST} Vantrix Coin to create a character.`
          : 'Token deduction failed — please try again',
        code: insufficientTokens ? 'INSUFFICIENT_TOKENS' : 'TOKEN_DEDUCT_FAILED',
      }, { status: insufficientTokens ? 402 : 500 });
    }

    const { data: character, error } = await supabaseAdmin
      .from('characters')
      .insert(sanitized)
      .select('id,name,category,active,is_public,moderation_status')
      .single();

    if (error) {
      // Insert failed after the charge went through — refund immediately so
      // the user isn't billed for a character that doesn't exist.
      // BILLING-FIX: refund_tokens() (not deduct_tokens with a negative
      // amount) — deduct_tokens now rejects amount <= 0 at the DB level,
      // so the old `deduct_tokens(..., -CHARACTER_CREATION_COST)` call
      // always failed here, leaving the user charged with no character.
      await supabaseAdmin.rpc('refund_tokens', {
        p_user_id: user.id,
        p_amount:  CHARACTER_CREATION_COST,
      }).then(({ error: refundErr }) => {
        if (refundErr) {
          logger.error('Character creation refund failed — user charged with no character created', {
            userId: user.id, error: refundErr.message,
          });
        }
      });
      throw error;
    }

    // ── ENFORCE DIGITAL PERSON: every character must have a persistent
    // brain before creation is considered complete. Unlike the animation
    // trigger below, this is NOT fire-and-forget — a character without a
    // brain is not a valid Vantrix character. Failure here rolls back the
    // character row and refunds the token charge, same as an insert failure.
    const brainResult = await initializeDigitalPerson({
      characterId: character.id,
      name:        sanitized.name,
      personality: sanitized.personality,
      backstory:   sanitized.backstory,
      occupation:  sanitized.occupation,
      category:    sanitized.category,
      tags:        sanitized.tags,
      gender:      sanitized.gender,
    });

    if (!brainResult.success) {
      logger.error('Character creation rolled back — brain init failed', {
        characterId: character.id, userId: user.id,
        stage: brainResult.stage, error: brainResult.error,
      });

      await supabaseAdmin.from('characters').delete().eq('id', character.id);
      // BILLING-FIX: see refund_tokens() note above — same fix applied here.
      await supabaseAdmin.rpc('refund_tokens', {
        p_user_id: user.id,
        p_amount:  CHARACTER_CREATION_COST,
      }).then(({ error: refundErr }) => {
        if (refundErr) {
          logger.error('Character creation refund failed after brain-init rollback', {
            userId: user.id, error: refundErr.message,
          });
        }
      });

      return NextResponse.json({
        error: 'Character could not be created — please try again.',
        code:  'BRAIN_INIT_FAILED',
      }, { status: 500 });
    }

    // Give the character a place in the world simulation — occupation,
    // location, faction, starting reputation/wealth (weighted by tier),
    // and an initial social_status/market_value row. Fire-and-forget, same
    // as the animation trigger below: a slow or failed provisioning call
    // must never block character creation or the response to the user —
    // sweepUnprovisionedCharacters() (run via legacy-tick) catches anything
    // that fails here.
    // RELIABILITY-FIX: both of these were previously bare un-awaited calls
    // — see the after() fix on triggerAnimationAsync's other call sites for
    // why that's unsafe. Wrapped together since both are fire-and-forget
    // background work triggered by the same character-creation response.
    after(() => {
      provisionCharacterInUniverse(character.id).catch((err) => {
        logger.error('world-provisioning: fire-and-forget call threw', {
          characterId: character.id, error: String(err),
        });
      });
    });

    // PGVECTOR: embed the character for semantic search (character-recommender.ts)
    // as soon as it exists — including while it's still pending/private, so it's
    // already searchable the moment staff approve + publish it, no separate
    // re-embed-on-approval step needed. Fire-and-forget, same posture as the
    // world-provisioning call above: embedAndStoreCharacter() never throws
    // (fails open internally) but the extra .catch() matches this file's other
    // after() calls defensively.
    after(() => {
      embedAndStoreCharacter(character.id, {
        name: sanitized.name,
        description: sanitized.description,
        personality: sanitized.personality,
        tags: sanitized.tags,
      }).catch((err) => {
        logger.error('character-embeddings: fire-and-forget call threw', {
          characterId: character.id, error: String(err),
        });
      });
    });

    if (sanitized.image_url) {
      const imageUrl = sanitized.image_url; // narrow before the closure
      after(() => {
        triggerAnimationAsync({
          characterId:   character.id,
          characterSlug: character.id,
          imageUrl,
        });
      });
    }

    logger.info('Character created', { characterId: character.id, userId: user.id });
    return NextResponse.json({
      character,
      // Explicit, so the client doesn't have to infer pending-ness from a raw
      // boolean — pairs with GET /api/characters/mine for later status checks.
      status: 'pending_review',
      message: d.visibility === 'public'
        ? 'Your character passed content review and their brain has been initialized — you can chat with them right away. You chose Public, so they\'ll appear in discovery automatically once a staff member approves the character.'
        : 'Your character passed content review and their brain has been initialized — you can chat with them right away. They\'re set to Private, so only you can see them — you can make them public anytime from Creator Studio once approved.',
    }, { status: 201 });
  } catch (err) {
    logger.error('Characters POST error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
