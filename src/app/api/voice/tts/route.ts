/**
 * POST /api/voice/tts — Character Voice Message Generation
 *
 * Generates an audio file of the character's reply using ElevenLabs TTS
 * (when ELEVENLABS_API_KEY is configured), falling back to the browser's
 * Web Speech Synthesis API only if ElevenLabs is unavailable, circuit-open,
 * or fails. Voice adapts emotional tone and pacing based on message content
 * and the character's per-character voice profile.
 *
 * AUDIO PIPELINE (cache-first, URL-backed):
 *   1. Text is cleaned (markdown/emoji stripped — see text-cleanup.ts) both
 *      to improve pronunciation and to cut billed ElevenLabs characters.
 *   2. A cache key is derived from the cleaned text + voice + tone params.
 *      Redis is checked first — a hit returns the existing R2 URL with no
 *      ElevenLabs call at all (same line said twice, e.g. a repeated
 *      greeting or a retried message, is now free and instant).
 *   3. On a miss, the ElevenLabs call is wrapped in a circuit breaker so a
 *      degraded/down ElevenLabs fails fast (and falls back to Web Speech)
 *      instead of every concurrent request hanging on the same timeout.
 *   4. The generated audio is uploaded to R2 and its public URL is cached
 *      in Redis, then returned to the client as `audioUrl` — NOT a base64
 *      blob. `<audio src="...">` streams natively from R2 (progressive
 *      playback, byte-range support, browser HTTP caching) instead of the
 *      client waiting for the entire JSON payload (with a base64-inflated
 *      body) to arrive before a single sample can play.
 *
 * Voice ID resolution, in priority order:
 *   1. An explicit voiceId from the client — used by the Studio voice
 *      picker to audition a candidate voice before it's saved, and by
 *      admin/preview tooling. Never used in normal chat playback (see
 *      use-voice-playback.ts — it only ever sends text+characterId).
 *   2. The character's own characters.elevenlabs_voice_id — assigned
 *      deterministically at creation by digital-person-bootstrap.ts (see
 *      voice-library.ts's resolveVoiceId()), or set manually by the
 *      creator in Studio. This is what makes every character actually
 *      sound like a distinct person instead of the app's one shared
 *      default voice.
 *   3. DEFAULT_ELEVENLABS_VOICE_IDS, gender-bucketed off the character's
 *      own characters.gender column (not the request body's `gender`,
 *      which the client never actually sends in normal chat flow) — the
 *      fallback for characters created before this column existed and
 *      not yet backfilled.
 *
 * Token cost: 2 tokens per voice message (unrelated to subscription tier —
 * this app has no tier gating; tokens are the app's separate pay-per-use
 * currency, untouched here). A cache hit still costs tokens — the user is
 * paying for the voice message, not for the specific ElevenLabs call.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { isAdminProfile } from '@/lib/auth/admin';
import { checkMatureContentAccess } from '@/lib/access/character-gate';
import { resolveEffectiveTier } from '@/lib/rate-limit';
import { z }                          from 'zod';
import { supabaseAdmin }              from '@/lib/supabase/admin';
import { toErrorBody, CircuitOpenError, errorLogFields } from '@/lib/errors';
import { logger }                     from '@/lib/logger';
import { detectEmotionalTone }        from '@/lib/voice/tone-detector';
import { cleanTextForSpeech }         from '@/lib/voice/text-cleanup';
import { toTtsParams, type VoiceProfile } from '@/lib/ai/writing-style';
import { DEFAULT_ELEVENLABS_VOICE_IDS } from '@/lib/ai/voice-library';
import { getCircuitBreaker }          from '@/lib/circuit-breaker';
import { redis }                      from '@/lib/redis';
import { uploadBufferToR2 }           from '@/lib/storage/r2';
import { env }                        from '@/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOKEN_COST = 2;

// Real, stable ElevenLabs premade-voice-library IDs, used as the default
// per-gender voice when a character has no specific elevenlabs_voice_id
// set yet (pre-migration rows). See voice-library.ts — same constant,
// re-exported from there so the Studio voice picker and this route can
// never drift out of sync on what "the default female voice" means.

// ElevenLabs circuit breaker — separate from the `ai:*` LLM breakers in
// provider-router.ts. A short timeout (this is a synchronous, user-facing
// request — no point queuing behind a 25s AI-completion-style window) and
// a slightly lower failure threshold, since a bad ElevenLabs incident
// should trip fast and push everyone to the still-fine Web Speech fallback
// rather than each request individually eating a multi-second timeout.
const ELEVENLABS_BREAKER_CONFIG = { failureThreshold: 3, timeout: 15_000 } as const;

// How long a generated line stays cached. 30 days comfortably covers
// repeated greetings/common lines within a character's active lifetime
// without holding R2 storage for cold characters indefinitely — the R2
// object itself is left in place (cheap, no TTL), only the Redis index
// entry expires, so a stale-cache miss just re-generates and re-caches.
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

// ElevenLabs bills/streams mp3 in several bitrates; mp3_44100_128 is the
// highest quality tier available on the standard plan (vs. the 44.1kHz/64kbps
// default) — meaningfully clearer on anything but a tinny phone speaker, for
// no added latency since it's still mp3 over the same streaming response.
const OUTPUT_FORMAT = 'mp3_44100_128';

const schema = z.object({
  text:        z.string().min(1).max(2000),
  characterId: z.string().uuid(),
  // Voice profile set at character creation
  voiceId:     z.string().max(100).optional(),  // ElevenLabs voice ID
  gender:      z.enum(['female', 'male', 'anime']).optional().default('female'),
});

function cacheKeyFor(text: string, voiceId: string, stability: number, style: number): string {
  // Round the continuous params into the key so near-duplicate float noise
  // (e.g. 0.549999999 vs 0.55 from different call sites) doesn't fragment
  // the cache — two decimal places is more precision than audibly matters.
  const hash = createHash('sha256')
    .update(`${text}::${voiceId}::${stability.toFixed(2)}::${style.toFixed(2)}::${OUTPUT_FORMAT}`)
    .digest('hex');
  return `voice:cache:${hash}`;
}

export async function POST(req: NextRequest) {
  // Hoisted so the outer catch can refund a reservation made mid-request —
  // see the token-reservation block below and the refund in the catch.
  let reservationUserId: string | null = null;
  let tokensReserved = false;
  try {
    const { supabase, user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const raw    = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid request', code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      }, { status: 400 });
    }

    const { text, characterId, voiceId: rawRequestedVoiceId, gender } = parsed.data;

    const { data: profile } = await supabase
      .from('profiles').select('tier,tokens,role,is_admin').eq('id', user.id).single();
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

    // SEC (voice override authorization): a client-supplied voiceId lets the
    // caller pick ANY ElevenLabs voice for ANY character, bypassing the
    // character's assigned voice_id — that's a legitimate need for the
    // Studio voice picker (auditioning a candidate voice before it's saved)
    // and admin/preview tooling, but every normal chat client only ever
    // sends text+characterId (see use-voice-playback.ts) and has no
    // business overriding it. Silently drop the override for anyone who
    // isn't an admin, rather than trusting an authenticated-but-ordinary
    // user's request body — this endpoint has no other notion of
    // "Studio/creator flow" to check yet, so admin is the correct floor
    // until one exists.
    const requestedVoiceId = isAdminProfile(profile) ? rawRequestedVoiceId : undefined;

    // ADMIN-FREE-TIER: admins bypass the token wallet, not just the
    // (now-removed) tier-gate.
    if (!isAdminProfile(profile) && profile.tokens < TOKEN_COST) {
      return NextResponse.json({
        error: `Need ${TOKEN_COST} VC for voice message`,
        code:  'INSUFFICIENT_TOKENS',
        tokensRequired: TOKEN_COST,
      }, { status: 402 });
    }

    // ── Clean text for synthesis ────────────────────────────────────────────
    // Tone detection runs on the ORIGINAL text (emoji/punctuation like "!!"
    // are meaningful emotional signals), but only the cleaned text is ever
    // sent to ElevenLabs or hashed into the cache key.
    const tone = detectEmotionalTone(text);
    const cleanedText = cleanTextForSpeech(text);
    if (!cleanedText) {
      return NextResponse.json({ error: 'Nothing to speak after cleanup', code: 'EMPTY_TEXT' }, { status: 400 });
    }

    // ── Per-character voice — the real, distinct ElevenLabs voice id
    // assigned at creation (see voice-library.ts), plus the abstract
    // voice_profile (pitch/pace/warmth) used below for tone-shaping on
    // top of it. gender is the character's own row, used only as the
    // last-resort bucket if elevenlabs_voice_id hasn't been backfilled.
    const { data: voiceRow } = await supabaseAdmin
      .from('characters').select('voice_profile,elevenlabs_voice_id,gender,is_nsfw').eq('id', characterId).maybeSingle();

    // SEC: `text` is client-supplied and voiced as-is — a user could send
    // arbitrary mature text through any character's voice, bypassing the
    // age-verification / nsfw_enabled gate other generation surfaces
    // enforce. Same gate as /api/chat/image and /api/chat/video.
    const matureGate = await checkMatureContentAccess(user.id, !!voiceRow?.is_nsfw, resolveEffectiveTier(profile));
    if (!matureGate.allowed) {
      return NextResponse.json({
        error: matureGate.reason ?? 'This character has mature content and is currently unavailable',
        code: 'MATURE_CONTENT_BLOCKED',
      }, { status: 403 });
    }

    // ── Atomic token reservation ────────────────────────────────────────────
    // TOKEN-RACE FIX: this used to check profile.tokens (a stale read) up
    // front, generate the audio, and only deduct tokens AFTER a successful
    // generation. Two concurrent requests from the same user could both
    // pass the stale check and both generate (two real, billed ElevenLabs
    // calls) before either deduction ran — deduct_tokens() is itself atomic
    // per-call, so the balance never went negative, but the SECOND paid
    // generation was handed to the user for free (its deduct_tokens() call
    // failed with insufficient_tokens, which was only logged, never
    // refused). Reserving the charge atomically BEFORE generation closes
    // that window: deduct_tokens()'s `WHERE tokens >= p_amount` makes the
    // check-and-deduct a single atomic statement, so of two concurrent
    // requests only one can ever win the reservation for the last 2 tokens.
    // If everything after this point fails outright (not the ElevenLabs ->
    // Web Speech fallback, which still delivers a voice message), the
    // reservation is refunded in the outer catch below.
    if (!isAdminProfile(profile)) {
      try {
        await supabaseAdmin.rpc('deduct_tokens', {
          p_user_id: user.id, p_amount: TOKEN_COST, p_reason: 'voice_tts',
        });
        tokensReserved = true;
        reservationUserId = user.id;
      } catch (reserveErr) {
        return NextResponse.json({
          error: `Need ${TOKEN_COST} VC for voice message`,
          code:  'INSUFFICIENT_TOKENS',
          tokensRequired: TOKEN_COST,
        }, { status: 402 });
      }
    }

    const characterVoice = (voiceRow?.voice_profile as unknown as VoiceProfile | null) ?? null;
    const ttsParams = characterVoice ? toTtsParams(characterVoice) : null;

    const genderBucket: 'female' | 'male' | 'anime' =
      voiceRow?.gender === 'male' ? 'male' : voiceRow?.gender === 'anime' ? 'anime' : gender;
    const voiceId =
      requestedVoiceId ??
      voiceRow?.elevenlabs_voice_id ??
      DEFAULT_ELEVENLABS_VOICE_IDS[genderBucket];

    const stability = ttsParams
      ? Math.max(0.3, Math.min(1, ttsParams.warmth / 100))
      : Math.max(0.3, tone.stability);
    const style = tone.style;

    // ── Premium path: cache-first, circuit-breaker-wrapped ElevenLabs TTS ───
    const elevenLabsKey = env.ELEVENLABS_API_KEY;
    // VOICE-FIX (2026-09-01): this used to fall through to Web Speech with
    // zero logging when the key was missing/placeholder — every character
    // silently sounding the same produced no signal anywhere. env.ts now
    // hard-requires this key in production, so reaching this branch there
    // means either a stale deploy or an env override; log it loudly either
    // way so it shows up in alerts instead of only in a user complaint.
    if (!elevenLabsKey || elevenLabsKey === 'placeholder-elevenlabs-key') {
      logger.error('voice:elevenlabs-key-missing-serving-web-speech-fallback', {
        userId: user.id, characterId,
      });
    }
    if (elevenLabsKey && elevenLabsKey !== 'placeholder-elevenlabs-key' && voiceId) {
      const cacheKey = cacheKeyFor(cleanedText, voiceId, stability, style);

      try {
        const cachedUrl = await redis.get<string>(cacheKey);
        if (cachedUrl) {
          // Tokens already reserved above — a cache hit still costs tokens
          // (see file header), it just doesn't need a second charge here.
          logger.info('voice:cache-hit', { userId: user.id, characterId, tone: tone.emotion });
          return NextResponse.json({
            mode:      'audio',
            audioUrl:  cachedUrl,
            mimeType:  'audio/mpeg',
            tone:      tone.emotion,
            tokenCost: TOKEN_COST,
            cached:    true,
          });
        }
      } catch (cacheErr) {
        // Redis being down should never block voice generation — just skip
        // straight to a live ElevenLabs call as if it was a cache miss.
        logger.warn('voice:cache-read-failed', { error: String(cacheErr) });
      }

      try {
        const breaker = getCircuitBreaker(`voice:elevenlabs:${voiceId}`, ELEVENLABS_BREAKER_CONFIG);

        const audioBuffer = await breaker.execute(async () => {
          const ttsRes = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`,
            {
              method:  'POST',
              headers: {
                'xi-api-key':   elevenLabsKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                text: cleanedText,
                model_id: 'eleven_turbo_v2_5',
                voice_settings: {
                  stability,
                  similarity_boost: 0.85,
                  style,
                  use_speaker_boost: true,
                },
              }),
              signal: AbortSignal.timeout(ELEVENLABS_BREAKER_CONFIG.timeout),
            }
          );
          if (!ttsRes.ok) {
            throw new Error(`elevenlabs_${ttsRes.status}`);
          }
          return Buffer.from(await ttsRes.arrayBuffer());
        });

        // Upload to R2 for permanent, URL-streamable storage — keyed by the
        // same hash as the cache key so identical lines dedupe on disk too.
        const r2Key = `voice-cache/${cacheKey.replace('voice:cache:', '')}.mp3`;
        const upload = await uploadBufferToR2(audioBuffer, r2Key, 'audio/mpeg');

        if (!upload.success || !upload.r2Url) {
          throw new Error(`r2_upload_failed:${upload.error ?? 'unknown'}`);
        }

        // Index the URL in Redis for future cache hits. Awaited, but a
        // write failure here just means future requests re-generate — the
        // audio itself is already safely in R2 and already returned below.
        await redis.set(cacheKey, upload.r2Url, { ex: CACHE_TTL_SECONDS }).catch(err =>
          logger.warn('voice:cache-write-failed', { error: String(err) })
        );

        // Tokens already reserved above.
        logger.info('voice:elevenlabs-generated', {
          userId: user.id, characterId, tone: tone.emotion,
        });

        return NextResponse.json({
          mode:      'audio',
          audioUrl:  upload.r2Url,
          mimeType:  'audio/mpeg',
          tone:      tone.emotion,
          tokenCost: TOKEN_COST,
          cached:    false,
        });
      } catch (elevenErr) {
        if (elevenErr instanceof CircuitOpenError) {
          logger.warn('voice:elevenlabs-circuit-open-fallback', { voiceId, details: elevenErr.details });
        } else {
          logger.warn('voice:elevenlabs-failed-fallback', { error: String(elevenErr) });
        }
        // Fall through to Web Speech params
      }
    }

    // ── MVP path: Web Speech Synthesis parameters ─────────────────────────────
    // Client uses these with window.speechSynthesis to speak the text locally.
    // Zero server cost, instant response — also the no-key/no-cache/circuit-
    // open fallback target either way.
    // Same fix as the ElevenLabs path above: use the character's actual
    // gender for the Web Speech voiceHint too, not the request body's
    // `gender` (which normal chat playback never sends and which
    // defaults to 'female' regardless of who the character is).
    let speechParams = buildSpeechParams(genderBucket, tone);
    if (ttsParams) {
      speechParams = {
        ...speechParams,
        rate:  Math.max(0.5, Math.min(2, speechParams.rate * ttsParams.speaking_rate)),
        pitch: Math.max(0.5, Math.min(2, speechParams.pitch + ttsParams.pitch_semitones / 40)),
      };
    }

    // Tokens already reserved above (even for client-side speech — it's a
    // paid feature, and the reservation happened before we knew which path
    // — ElevenLabs or Web Speech — we'd end up on).
    logger.info('voice:speech-params-generated', {
      userId: user.id, characterId, tone: tone.emotion,
    });

    return NextResponse.json({
      mode:        'speech-synthesis',
      text:        cleanedText,
      speechParams,
      tone:        tone.emotion,
      tokenCost:   TOKEN_COST,
    });

  } catch (err) {
    // A token reservation was taken above but this request is failing
    // outright (no audio of any kind is being returned) — refund it so the
    // user isn't charged for a voice message they never received.
    if (tokensReserved && reservationUserId) {
      // REFUND-ERROR-HANDLING FIX: try/catch alone only covers a
      // network-level throw — Supabase's RPC builder resolves a DB-level
      // refund_tokens() failure as `{ error }` rather than rejecting, so
      // that case was silently going unlogged. Checking the returned
      // `error` field alongside the catch covers both failure modes.
      try {
        const { error: refundError } = await supabaseAdmin.rpc('refund_tokens', {
          p_user_id: reservationUserId, p_amount: TOKEN_COST, p_reason: 'voice_tts_failed_refund',
        });
        if (refundError) {
          logger.error('voice:tts:refund-failed', {
            userId: reservationUserId, tokenCost: TOKEN_COST, error: refundError.message,
          });
        }
      } catch (refundErr) {
        logger.error('voice:tts:refund-failed', {
          userId: reservationUserId, tokenCost: TOKEN_COST, error: String(refundErr),
        });
      }
    }
    logger.error('voice:tts-error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

interface SpeechParams {
  rate:  number;   // 0.5 – 2.0
  pitch: number;   // 0.5 – 2.0
  lang:  string;
  // Hint to client for voice selection
  voiceHint: 'female-soft' | 'female-warm' | 'female-assertive' | 'male-warm' | 'male-deep';
}

function buildSpeechParams(
  gender: 'female' | 'male' | 'anime',
  tone:   ReturnType<typeof detectEmotionalTone>,
): SpeechParams {
  const base: SpeechParams = {
    rate:      1.0,
    pitch:     gender === 'male' ? 0.8 : 1.15,
    lang:      'en-US',
    voiceHint: gender === 'male' ? 'male-warm' : 'female-warm',
  };

  // Adapt rate and pitch to emotional tone
  switch (tone.emotion) {
    case 'playful':
      return { ...base, rate: 1.1, pitch: base.pitch + 0.1, voiceHint: gender === 'male' ? 'male-warm' : 'female-soft' };
    case 'romantic':
      return { ...base, rate: 0.9, pitch: base.pitch - 0.05, voiceHint: gender === 'male' ? 'male-warm' : 'female-warm' };
    case 'assertive':
      return { ...base, rate: 1.05, pitch: base.pitch - 0.1, voiceHint: gender === 'male' ? 'male-deep' : 'female-assertive' };
    case 'warm':
      return { ...base, rate: 0.95, pitch: base.pitch, voiceHint: gender === 'male' ? 'male-warm' : 'female-warm' };
    case 'excited':
      return { ...base, rate: 1.15, pitch: base.pitch + 0.15, voiceHint: gender === 'male' ? 'male-warm' : 'female-soft' };
    default:
      return base;
  }
}
