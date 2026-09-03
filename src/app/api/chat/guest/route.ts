import { NextRequest, NextResponse }   from 'next/server';
import { randomUUID }                  from 'crypto';
import { z }                           from 'zod';
import { logger }                      from '@/lib/logger';
import { supabaseAdmin }               from '@/lib/supabase/admin';
import { sanitize }                    from '@/lib/sanitize';
import { routeCompletion }             from '@/lib/ai/provider-router';
import { assembleCharacterPrompt }     from '@/lib/ai/prompt';
import { resolveLanguageState }        from '@/lib/ai/language-engine';
import { getClientIp }                 from '@/lib/network/get-client-ip';
import { flagIfSuspicious }            from '@/lib/security-guards/bot-shield';
import { redis }              from '@/lib/redis';
import { env }                         from '@/env';
import { checkCharacterAccessForGuest } from '@/lib/access/character-gate';
import { detectCrisisSignal, logCrisisEvent } from '@/lib/safety/crisis-detection';
import { buildCrisisReply }            from '@/lib/safety/crisis-response';
import { stripLeakedMeta }             from '@/lib/moderation/reply-guard';
import { watchKeywords }               from '@/lib/moderation/keyword-watch';
import { shouldUseSecureCookies }      from '@/lib/http/secure-cookies';

/**
 * POST /api/chat/guest
 *
 * Allows unauthenticated users to chat for a limited number of messages
 * (GUEST_MESSAGE_LIMIT env var, default 7).
 *
 * Rate-limited by IP + guest session ID stored in Redis.
 * After the limit is hit, returns { limitReached: true } so the client
 * can surface the EmotionalPeakPaywall.
 *
 * SEC-07 FIX: the per-guest session counter used to be keyed on the
 * client-supplied `guestId` body field with no server-side binding —
 * any caller could reset their own cap by sending a new random guestId
 * on every request (e.g. `crypto.randomUUID()` client-side), leaving the
 * 20/hour IP cap as the only real limit, which is itself trivial to
 * rotate via proxies. The session identity is now a server-issued
 * httpOnly cookie (`vtx_gid`) that the client cannot set or rotate via
 * JS; the request-body guestId is still accepted for client-side
 * bookkeeping (e.g. localStorage continuity) but is no longer trusted
 * for rate-limiting.
 *
 * Security:
 *   - No user data is persisted (no DB writes ever)
 *   - Character fetch is read-only via admin client
 *   - Input sanitized identical to the authenticated endpoint
 *   - IP-level hard cap: 20 guest requests/hour
 *   - Per-guest cap is bound to a server-issued httpOnly cookie, not a
 *     client-controlled value
 */

export const dynamic = 'force-dynamic';

const GUEST_MESSAGE_LIMIT = env.GUEST_MESSAGE_LIMIT;
const IP_HOURLY_CAP       = 20;
const GUEST_COOKIE_NAME   = 'vtx_gid';
const GUEST_COOKIE_MAX_AGE = 86_400; // 24h — matches the session counter window


const guestChatSchema = z.object({
  message:      z.string().min(1).max(2000),
  characterId:  z.string().uuid(),
  // No longer trusted as the rate-limit identity (see SEC-07 above) — kept
  // optional so older clients without a cookie yet don't fail validation.
  guestId:      z.string().min(8).max(64).optional(),
  history: z.array(z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string().max(1000),
  })).max(10).optional().default([]),
});

export async function POST(request: NextRequest) {
  // No CAPTCHA on the guest-chat entry point by design — this queues
  // suspicious traffic for review instead of gating the request itself.
  // Fire-and-forget: never awaited, cannot add latency or fail the request.
  flagIfSuspicious(request, { kind: 'guest_chat' });

  // BUG FIX (2026-08-08): getClientIp() returning null (no proxy header —
  // e.g. running via a bare `next start` with no reverse proxy in front)
  // used to fall back to a hardcoded "127.0.0.1", so every guest on such a
  // deployment shared one IP_HOURLY_CAP (20/hr) bucket instead of each
  // getting their own — the 21st guest message from *anyone* would 429
  // *everyone* for up to an hour. null now means "skip this specific
  // check," not "pretend everyone is the same client."
  const ip = getClientIp(request);

  try {
    const body   = await request.json();
    const parsed = guestChatSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const { message, characterId, history } = parsed.data;

    // ── Server-issued guest identity (SEC-07) ─────────────────────────────────
    // Read the existing cookie if present; otherwise mint a fresh one. This
    // value — never the request body — is what the per-guest cap is keyed on.
    const existingCookie = request.cookies.get(GUEST_COOKIE_NAME)?.value;
    const cookieIsValid  = !!existingCookie && /^[a-f0-9-]{8,64}$/i.test(existingCookie);
    const guestSessionId = cookieIsValid ? existingCookie! : randomUUID();

    // ── Crisis check (SAFETY-01) ──────────────────────────────────────────────
    // Must run before rate limiting, the character fetch, or any model call —
    // guests are the least identifiable, least supported population in the
    // product (no account, no memory, no human review context beyond IP), so
    // this is the single most important place in the app to not let a
    // distressed message reach an in-character reply. Does not consume the
    // guest message quota and is not itself rate-limited.
    const crisisCheck = detectCrisisSignal(message);
    if (crisisCheck.level === 'detected') {
      logCrisisEvent({
        userId:         null,
        characterId:    characterId ?? null,
        conversationId: null,
        category:       crisisCheck.category!,
        messageExcerpt: message,
      });
      const crisisResponse = NextResponse.json({
        reply:                  buildCrisisReply(),
        guestMessagesUsed:      0,
        guestMessagesRemaining: GUEST_MESSAGE_LIMIT,
        limitReached:           false,
        limit:                  GUEST_MESSAGE_LIMIT,
        crisis:                 true,
      });
      setGuestCookie(crisisResponse, guestSessionId, cookieIsValid, request.headers);
      return crisisResponse;
    }

    // ── IP-level hourly rate cap ─────────────────────────────────────────────
    // Skipped when we can't resolve a real per-client IP (see note above) —
    // the per-guest-session cap right below still applies regardless, so
    // this isn't a wide-open gap, just not double-covered in that case.
    if (ip !== null) {
      const ipKey   = `guest:ip:${ip}`;
      const ipCount = await redis.incr(ipKey);
      if (ipCount === 1) await redis.expire(ipKey, 3600);
      if (ipCount > IP_HOURLY_CAP) {
        return NextResponse.json(
          { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
          { status: 429 },
        );
      }
    }

    // ── Per-guest session message count (now keyed on the server-issued
    // cookie identity, not the client-supplied guestId — see SEC-07) ───────
    const sessionKey    = `guest:session:${guestSessionId}`;
    const sessionMsgNum = await redis.incr(sessionKey);
    if (sessionMsgNum === 1) await redis.expire(sessionKey, GUEST_COOKIE_MAX_AGE);

    // Return limit sentinel BEFORE calling AI if already over limit
    if (sessionMsgNum > GUEST_MESSAGE_LIMIT) {
      const limitResponse = NextResponse.json({
        limitReached:  true,
        messagesUsed:  sessionMsgNum - 1,
        limit:         GUEST_MESSAGE_LIMIT,
      });
      setGuestCookie(limitResponse, guestSessionId, cookieIsValid, request.headers);
      return limitResponse;
    }

    // ── Fetch character (read-only, no RLS) ──────────────────────────────────
    // ACTIVATION-FIX (P0): filter on `active` directly — this route uses the
    // service-role client (bypasses RLS) and has no notion of a "creator"
    // (guests are anonymous), so an inactive/pending character must simply be
    // unreachable here, with no exception.
    const { data: character, error: charErr } = await supabaseAdmin
      .from('characters')
      .select('id,name,description,personality,scenario,backstory,gender,tags,age,origin,occupation,values_list,fears,dreams,flaws,speech_style,current_goal,daily_routine,friends_list,char_openness,char_warmth,char_adventure,char_depth')
      .eq('id', characterId)
      .eq('active', true)
      .single();

    if (charErr || !character) {
      return NextResponse.json(
        { error: 'Character not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Premium/VIP + mature-content gate — guests are floor-tier ('free')
    // and never eligible for is_nsfw characters (checkCharacterAccessForGuest
    // enforces both). ────────────────────────────────────────────────────
    const gate = await checkCharacterAccessForGuest(characterId);
    if (!gate.allowed) {
      const isMatureGate = gate.reason?.toLowerCase().includes('age verification')
        || gate.reason?.toLowerCase().includes('mature content');
      return NextResponse.json(
        {
          error: gate.reason ?? 'This character requires an account and a paid plan',
          code:  isMatureGate ? 'MATURE_CONTENT_GATE' : 'PREMIUM_CHARACTER_REQUIRED',
        },
        { status: 403 },
      );
    }

    // ── Build system prompt (no per-user memory for guests) ──────────────────
    // WIRE-FIX: guests previously got a flat 6-line concat with none of the
    // actor-quality layers (Core Rules, Confidant Standard, Human Themes,
    // Inner Thoughts, speech style, life domains) that authed chat gets from
    // assembleFullPrompt. That made a stranger's very first message a
    // noticeably worse, more "chatbot" experience than what they'd get one
    // click later after signing up. assembleCharacterPrompt runs the same
    // identity/world/voice/rules stack — only the per-user layers that
    // require an account (psychology, memory graph, relationship, emotion
    // history) are absent, since guests have none yet.
    // Auto-detect only for guests — no account, so no preferred_language to
    // pin to. Keyed on the server-issued session cookie (same identity
    // sessionKey above uses) so smoothing still works across a guest's
    // messages without needing a real userId. Fails open to '' (English).
    let guestLanguagePrompt = '';
    try {
      const languageState = await resolveLanguageState(`guest:${guestSessionId}`, characterId, message, null);
      guestLanguagePrompt = languageState.promptBlock;
    } catch (err) {
      logger.warn('guest chat: language engine failed', { error: String(err) });
    }

    const systemPrompt = [
      assembleCharacterPrompt(character as Parameters<typeof assembleCharacterPrompt>[0]),
      guestLanguagePrompt,
      '\n── Guest Session ──',
      '- Keep responses warm, personal, genuine, and under 120 words.',
      '- This is a first-time guest, not a returning user — do not reference shared history that does not exist yet.',
      '- Make them feel welcome and eager to create an account and keep talking.',
    ].join('\n');

    const safeMessage = sanitize(message);

    // Log-only, non-blocking — see keyword-watch.ts. Guests have no
    // userId/conversationId (both nullable on keyword_watch_hits); the
    // characterId is still enough for an admin to trace a hit.
    watchKeywords({
      text: safeMessage, direction: 'user_message',
      userId: null, characterId: characterId ?? null, conversationId: null,
    });

    // SEC FIX (Phase B audit, 2026-08-06): sanitize() strips prompt-injection
    // patterns (see INJECTION_PATTERNS in lib/sanitize.ts) — critical for
    // anything reaching the model as conversation content. It was only
    // applied to the new `message` below; `history` items are equally
    // client-supplied (a guest controls this array directly, unauthenticated,
    // no persistence to cross-check against) and were passed straight into
    // providerMessages, completely bypassing injection-pattern stripping.
    const safeHistory = history.map(m => ({ role: m.role, content: sanitize(m.content) }));

    // Build message array: system prompt + prior history + new user message
    const providerMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt },
      ...safeHistory,
      { role: 'user', content: safeMessage },
    ];

    // ── Call AI via provider router (FAST tier = cheapest / fastest model) ───
    const result = await routeCompletion({
      messages:    providerMessages,
      modelTier:   'FAST',
      maxTokens:   256,
      temperature: 0.85,
      stream:      false,
    });

    const reply = stripLeakedMeta(result.reply || "I'm here. Tell me more…");

    // Log-only, non-blocking — see keyword-watch.ts. Runs after
    // stripLeakedMeta so hits are checked against the final reply text.
    watchKeywords({
      text: reply, direction: 'character_reply',
      userId: null, characterId: characterId ?? null, conversationId: null,
    });

    const remaining = Math.max(0, GUEST_MESSAGE_LIMIT - sessionMsgNum);

    const response = NextResponse.json({
      reply,
      guestMessagesUsed:      sessionMsgNum,
      guestMessagesRemaining: remaining,
      limitReached:           remaining === 0,
      limit:                  GUEST_MESSAGE_LIMIT,
    });
    setGuestCookie(response, guestSessionId, cookieIsValid, request.headers);
    return response;

  } catch (err) {
    logger.error('api/chat/guest error', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: 'Something went wrong', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * Set the server-issued guest identity cookie. No-op if the request already
 * carried a valid one — avoids rewriting the cookie (and resetting its
 * max-age) on every single message.
 */
function setGuestCookie(
  response: NextResponse,
  guestSessionId: string,
  alreadyValid: boolean,
  requestHeaders: Headers,
): void {
  if (alreadyValid) return;
  response.cookies.set({
    name:     GUEST_COOKIE_NAME,
    value:    guestSessionId,
    httpOnly: true,
    secure:   shouldUseSecureCookies(requestHeaders),
    sameSite: 'lax',
    path:     '/',
    maxAge:   GUEST_COOKIE_MAX_AGE,
  });
}
