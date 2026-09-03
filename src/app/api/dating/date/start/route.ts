/**
 * POST /api/dating/date/start
 *
 * Feature 12 — First Dates. Begins a structured date session: validates the
 * match and date-type unlock, deducts tokens, generates a short opening
 * scene in the character's voice (grounded in real relationship context via
 * memory-graph, mirroring secret-moments.ts's grounding approach), and
 * persists the session atomically via start_date_session().
 *
 * Deliberately reuses existing infra rather than duplicating it:
 *   - token deduction + insert: atomic Postgres fn (same pattern as send_gift)
 *   - narration: routeCompletion (same LLM entrypoint as secret-moments)
 *   - moderation/sanitization for the free-text 'custom' date: same helpers
 *     already used by /api/dating/scene for its customPrompt field
 *   - the date then continues as an ordinary dating-mode chat turn via the
 *     existing /api/chat/stream (datingMode=true) — this route does NOT
 *     create a second chat pipeline.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { isAdminProfile } from '@/lib/auth/admin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkDatingActionLimit, resolveEffectiveTier } from '@/lib/rate-limit';
import { DATE_CATALOGUE, isDateUnlocked, buildDateScenePrompt } from '@/lib/dating/engine';
import { routeCompletion } from '@/lib/ai/provider-router';
import { getMemoryGraph } from '@/lib/ai/memory-graph';
import { sanitizeField } from '@/lib/sanitize';
import { moderateCharacter } from '@/lib/moderation';
import { checkMatureContentAccess } from '@/lib/access/character-gate';
import { logger } from '@/lib/logger';
import { toErrorBody, errorLogFields } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GENERATION_TIMEOUT_MS = 6000;

const schema = z.object({
  matchId:      z.string().uuid(),
  dateType:     z.string(),
  customPrompt: z.string().max(300).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 });
    }
    const { matchId, dateType, customPrompt } = parsed.data;

    const dateDef = DATE_CATALOGUE.find(d => d.type === dateType);
    if (!dateDef) return NextResponse.json({ error: 'Unknown date type', code: 'NOT_FOUND' }, { status: 404 });
    if (dateDef.type === 'custom' && !customPrompt) {
      return NextResponse.json({ error: 'customPrompt required for this date type', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles').select('tier,tokens,role,is_admin').eq('id', user.id).single();
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

    const tier = resolveEffectiveTier(profile);
    const rl = await checkDatingActionLimit(user.id, tier);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
    }

    // Match must belong to this user.
    const { data: match } = await supabaseAdmin
      .from('dating_matches')
      .select('id,user_id,character_id,bond_score,match_tier,streak_days,character_mood')
      .eq('id', matchId)
      .eq('user_id', user.id)
      .single();
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

    const matchTier = match.match_tier ?? 'spark';
    if (!isDateUnlocked(dateDef.tier, matchTier)) {
      return NextResponse.json({
        error: `Reach ${dateDef.tier} tier to unlock ${dateDef.name}`,
        code:  'DATE_LOCKED',
        requiredTier: dateDef.tier,
      }, { status: 403 });
    }

    if (!isAdminProfile(profile) && profile.tokens < dateDef.tokens) {
      return NextResponse.json({
        error: 'Not enough Vantrix Coin for this date',
        code:  'INSUFFICIENT_TOKENS',
        tokensRequired: dateDef.tokens,
        tokensAvailable: profile.tokens,
      }, { status: 402 });
    }

    // Reject a second concurrent active date on the same match (also
    // enforced by the DB's partial unique index — this just gives a
    // friendlier error before hitting that constraint).
    const { data: activeDate } = await supabaseAdmin
      .from('date_sessions')
      .select('id')
      .eq('match_id', matchId)
      .eq('status', 'active')
      .maybeSingle();
    if (activeDate) {
      return NextResponse.json({
        error: 'A date is already in progress with this match',
        code:  'DATE_ALREADY_ACTIVE',
        sessionId: activeDate.id,
      }, { status: 409 });
    }

    const { data: character } = await supabaseAdmin
      .from('characters')
      .select('id,name,description,personality,archetype,is_nsfw')
      .eq('id', match.character_id)
      .single();
    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

    // SEC: date sessions generate character narration same as chat — a
    // user with a match id could otherwise start a date with an NSFW
    // character without ever passing age-verification / nsfw_enabled.
    // Same gate as /api/chat/stream.
    const matureGate = await checkMatureContentAccess(user.id, !!character.is_nsfw, tier);
    if (!matureGate.allowed) {
      return NextResponse.json({
        error: matureGate.reason ?? 'This character has mature content and is currently unavailable',
        code: 'MATURE_CONTENT_BLOCKED',
      }, { status: 403 });
    }

    // Sanitize/moderate free-text custom prompt before it touches the LLM.
    let safeCustomPrompt: string | undefined;
    if (customPrompt) {
      safeCustomPrompt = sanitizeField(customPrompt, 300);
      const modResult = await moderateCharacter({ name: 'date', description: safeCustomPrompt });
      if (!modResult.allowed) {
        return NextResponse.json({
          error: modResult.reason ?? 'That request was rejected by content moderation',
          code:  'CONTENT_POLICY_VIOLATION',
        }, { status: 422 });
      }
    }

    // Ground the opening scene in one real memory, if one exists — never
    // fabricate shared history (mirrors secret-moments.ts's approach).
    const memories = await getMemoryGraph(user.id, match.character_id, 3);
    const recentMemory = memories[0] ? `${memories[0].title}: ${memories[0].description}` : undefined;

    const characterVoice = [character.description, character.personality]
      .filter(Boolean).join(' ').slice(0, 400) || 'A warm, distinct personality.';

    const prompt = buildDateScenePrompt({
      characterName:  character.name,
      characterVoice,
      dateTypeName:   dateDef.name,
      dateMood:       dateDef.mood,
      matchTier:      matchTier as 'spark' | 'flame' | 'soulmate',
      bondScore:      match.bond_score,
      streakDays:     match.streak_days,
      recentMemory,
      customPrompt:   safeCustomPrompt,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
    let openingScene: string;
    try {
      const response = await routeCompletion({
        messages:    [{ role: 'system', content: prompt }],
        modelTier:   'SMART',
        maxTokens:   220,
        temperature: 0.9,
        signal:      controller.signal,
      });
      openingScene = response.reply?.trim() || '';
      if (!openingScene) throw new Error('empty response');
    } catch (err) {
      logger.warn('dating-date:generation-failed, using fallback', {
        userId: user.id, matchId, dateType,
        error: err instanceof Error ? err.message : String(err),
      });
      openingScene = `${character.name} looks up as you arrive for your ${dateDef.name.toLowerCase()} — ${dateDef.mood}. "I've been looking forward to this," she says.`;
    } finally {
      clearTimeout(timer);
    }

    // Standing conversation for this character, if any — the date continues
    // there as an ordinary dating-mode turn.
    const { data: convo } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('user_id', user.id)
      .eq('character_id', match.character_id)
      .maybeSingle();

    const tokenCost = isAdminProfile(profile) ? 0 : dateDef.tokens;
    const bondBonus = 6; // modest — the real bond growth comes from the conversation that follows, not from starting a date

    const { data: sessionId, error: startErr } = await supabaseAdmin.rpc('start_date_session', {
      p_user_id:         user.id,
      p_match_id:        matchId,
      p_char_id:          match.character_id,
      p_date_type:        dateDef.type,
      p_opening_scene:    openingScene,
      p_token_cost:       tokenCost,
      p_bond_bonus:       bondBonus,
      p_conversation_id:  convo?.id ?? undefined,
    });

    if (startErr) {
      if (startErr.message?.includes('insufficient_tokens')) {
        return NextResponse.json({ error: 'Insufficient Vantrix Coin', required: dateDef.tokens }, { status: 402 });
      }
      logger.error('dating-date:start-failed', { userId: user.id, matchId, error: startErr.message });
      return NextResponse.json({ error: 'Could not start date', details: startErr.message }, { status: 500 });
    }

    logger.info('dating-date:started', { userId: user.id, matchId, dateType, sessionId, tokenCost });

    return NextResponse.json({
      sessionId,
      dateType: dateDef.type,
      dateName: dateDef.name,
      openingScene,
      tokenCost,
      conversationId: convo?.id ?? null,
    });
  } catch (err) {
    logger.error('dating-date:error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
