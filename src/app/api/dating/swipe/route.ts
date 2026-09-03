/**
 * POST /api/dating/swipe
 * Record a swipe (like / pass / super_like) and create a match on like.
 * Returns the match record and compatibility score.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { z }                         from 'zod';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { computeCompatibility, pairSeed, scoreToMatchTier, evaluateLikeResponse } from '@/lib/dating/engine';
import { invalidateRecommendations } from '@/lib/recommendations/engine';
import { getRelationship } from '@/lib/ai/relationship-engine';
import { checkMatureContentAccess } from '@/lib/access/character-gate';
import { emitDatingEvent }           from '@/lib/tracing';
import { bg }                        from '@/lib/logger';
import { checkSwipeLimit, resolveEffectiveTier } from '@/lib/rate-limit';
import { emitNotification } from '@/lib/notifications/emit';
import type { Json } from '@/types/supabase';

export const dynamic = 'force-dynamic';

const schema = z.object({
  characterId: z.string().uuid(),
  direction:   z.enum(['like', 'pass', 'super_like']),
});

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // PERF: validate the body before spending a profile fetch + a Redis round
  // trip on a request that's going to 400 anyway. Previously the rate-limit
  // check ran first and the schema was parsed after — a malformed request
  // still burned a swipe-limit slot and two DB/Redis calls for nothing.
  const raw    = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { characterId, direction } = parsed.data;
  const userId = user.id;

  // MED-3: Rate limit swipe endpoint to prevent swipe-farming and attachment manipulation
  // Dedicated daily swipe cap — previously checkChatLimit() here meant every
  // swipe consumed a chat-message quota slot, two unrelated actions sharing
  // one counter. See checkSwipeLimit() for the full rationale. Deliberately
  // independent of checkDailyMessageCap: dating is free-to-browse even after
  // a free user's 5 daily messages are gone — swiping never touches that
  // counter and never will.
  const { data: profile } = await supabaseAdmin.from('profiles').select('tier,role,is_admin').eq('id', user.id).single();
  const tier = resolveEffectiveTier(profile ?? {});
  const rl = await checkSwipeLimit(user.id, tier);
  if (!rl.allowed) {
    return NextResponse.json({
      error: 'Daily swipe limit reached — come back tomorrow or upgrade for more',
      code:  'SWIPE_LIMIT_EXCEEDED',
      used:  rl.used,
      limit: rl.limit,
    }, { status: 429 });
  }

  // Record the swipe (idempotent on duplicate)
  const { error: swipeErr } = await supabaseAdmin.from('dating_swipes').upsert(
    { user_id: userId, character_id: characterId, direction },
    { onConflict: 'user_id,character_id' }
  );
  if (swipeErr) return NextResponse.json({ error: 'Swipe failed' }, { status: 500 });

  // SWIPE-CACHE-FIX: the deck (GET /api/dating/deck -> getRecommendations)
  // caches per-user for 10 minutes and excludes already-swiped characters
  // at generation time — without invalidating on every swipe, a reload of
  // the deck within that window kept re-serving the pre-swipe list. Fire
  // this for every direction (including pass), since swipedIds filtering
  // applies regardless of direction.
  after(() => { invalidateRecommendations(userId).catch(bg('invalidateRecommendations.swipe')); });

  if (direction === 'pass') {
    return NextResponse.json({ matched: false, direction: 'pass' });
  }

  // Load character dating attributes + user dating profile
  const [charRes, profileRes] = await Promise.all([
    supabaseAdmin.from('characters')
      .select('id,name,char_openness,char_warmth,char_adventure,char_depth,love_language,archetype,tags,active,dating_enabled,is_nsfw')
      .eq('id', characterId).single(),
    supabaseAdmin.from('dating_profiles')
      .select('openness,warmth,adventure,depth,vibe_tags')
      .eq('user_id', userId).maybeSingle(),
  ]);

  const char    = charRes.data;
  const swipeUserProfile = profileRes.data;

  if (!char) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

  // ACTIVATION-FIX (P1): this route uses the service-role client and had no
  // check at all — a character that was never staff-activated, or that has
  // dating disabled, could still be swiped on and matched. Respond exactly
  // like "not found" rather than confirming a pending character exists.
  if (!char.active || !char.dating_enabled) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 });
  }

  // NSFW-GATE-FIX: discovery (/api/characters?dating=true,
  // recommendations/engine.ts) already filters is_nsfw characters out of
  // what an ungated user *sees* — but this write path never checked what a
  // client can *submit*. A characterId is client-supplied, so a direct
  // request here could still create a like/match on an NSFW character the
  // user was never shown. Reuse the same single source of truth the chat
  // routes use rather than re-deriving the rule. "Not found" here too, for
  // the same reason as the activation check above — don't confirm a
  // gated character's existence to a user who can't access it.
  const matureAccess = await checkMatureContentAccess(userId, char.is_nsfw === true, tier);
  if (!matureAccess.allowed) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 });
  }

  // Compute compatibility
  // Typed: swipeUserProfile has openness/warmth/adventure/depth/vibe_tags from .select()
  const swipeProfile = swipeUserProfile as {
    openness: number | null;
    warmth:   number | null;
    adventure: number | null;
    depth:    number | null;
    vibe_tags: string[] | null;
  } | null;

  const userPersonality = swipeProfile
    ? {
        openness:  Number(swipeProfile.openness  ?? 50),
        warmth:    Number(swipeProfile.warmth    ?? 50),
        adventure: Number(swipeProfile.adventure ?? 50),
        depth:     Number(swipeProfile.depth     ?? 50),
        vibeTag:   swipeProfile.vibe_tags        ?? [],
      }
    : { openness: 50, warmth: 50, adventure: 50, depth: 50, vibeTag: [] };

  const charPersonality = {
    char_openness: Number(char.char_openness ?? 50)  ?? 70,
    char_warmth:    char.char_warmth    ?? 75,
    char_adventure: char.char_adventure ?? 60,
    char_depth:     char.char_depth     ?? 65,
    love_language:  char.love_language  ?? 'words',
    archetype:      char.archetype      ?? 'romantic',
    tags:           char.tags           ?? [],
  };

  const seed    = pairSeed(userId, characterId);
  const compat  = computeCompatibility(userPersonality, charPersonality, seed);
  // Super like boosts score by 8 — kept for the compatibility breakdown /
  // eventual match tier; the reciprocation decision below applies its own
  // (larger) super_like weight separately.
  const finalScore = Math.min(100, compat.overall + (direction === 'super_like' ? 8 : 0));
  const matchTier  = scoreToMatchTier(finalScore);

  // Always persist the compatibility breakdown — useful even on a "no",
  // e.g. for a future retry or for compatibility-preview UI.
  await supabaseAdmin.from('dating_compatibility').upsert({
    user_id: userId, character_id: characterId,
    score: finalScore, breakdown: compat as unknown as Json, computed_at: new Date().toISOString(),
  }, { onConflict: 'user_id,character_id' });

  // ── Reciprocation gate ────────────────────────────────────────────────
  // Existing chat relationship (if the user has talked to this character
  // outside dating mode) makes reciprocation more likely — she's not
  // meeting a stranger.
  const priorRelationship = await getRelationship(userId, characterId);
  const priorChatBond     = priorRelationship?.bond_score ?? 0;

  const response = evaluateLikeResponse({
    compatibilityScore: finalScore,
    archetype:           charPersonality.archetype,
    direction,
    pairSeedValue:        seed,
    priorChatBond,
  });

  after(() => {
    emitDatingEvent({
      userId, operation: 'swipe', outcome: response.reciprocated ? 'success' : 'partial',
      meta: { direction, compatibility: finalScore, threshold: response.threshold, roll: response.roll, reciprocated: response.reciprocated },
    }).catch(bg('emitDatingEvent.swipeEvaluated'));
  });

  if (!response.reciprocated) {
    return NextResponse.json({
      matched:       false,
      direction,
      compatibility: { score: finalScore, breakdown: compat, tier: matchTier },
      reason:        response.reason,
    });
  }

  // DATA-LOSS FIX (Phase B audit, 2026-08-06): dating_matches was
  // previously upserted unconditionally with
  // bond_score: direction === 'super_like' ? 10 : 5 on EVERY reciprocated
  // like — including for a pair that already has a match row. Since
  // dating_swipes.upsert() above allows a swipe to be re-recorded for the
  // same (user_id, character_id) pair (e.g. a client retry, a stale swipe
  // deck showing an already-matched character again, or any repeat POST),
  // reaching this far a second time would silently reset bond_score back
  // to 5/10 — destroying however much real relationship progress (which
  // can be 80-100 after months of chatting, and drives compatibility,
  // prestige chapters, and mood) had accumulated since the original match.
  // Now: only set the initial bond_score on a genuine first-time insert;
  // an existing match's bond_score is left untouched, only its
  // compatibility/tier/last_interaction fields refresh.
  const { data: existingMatch } = await supabaseAdmin
    .from('dating_matches')
    .select('id')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .maybeSingle();

  let match;
  let matchErr;
  if (existingMatch) {
    ({ data: match, error: matchErr } = await supabaseAdmin
      .from('dating_matches')
      .update({
        compatibility_pct: finalScore,
        match_tier:        matchTier,
        last_interaction:  new Date().toISOString(),
      })
      .eq('id', existingMatch.id)
      .select()
      .single());
  } else {
    ({ data: match, error: matchErr } = await supabaseAdmin
      .from('dating_matches')
      .insert({
        user_id:           userId,
        character_id:      characterId,
        compatibility_pct: finalScore,
        match_tier:        matchTier,
        bond_score:        direction === 'super_like' ? 10 : 5,
        last_interaction:  new Date().toISOString(),
      })
      .select()
      .single());
  }

  if (matchErr || !match) return NextResponse.json({ error: 'Match creation failed' }, { status: 500 });

  // DATING-5 (FIXED): first_chat milestone removed from here — see mood/route.ts

  // OBS-1: Emit swipe tracing event
  after(() => {
    emitDatingEvent({
      userId, matchId: match.id, operation: 'match_created', outcome: 'success',
      meta: { direction, compatibility: finalScore, matchTier },
    }).catch(bg('emitDatingEvent.matchCreated'));

    // Inbox notification — only for a genuinely new match, not a re-swipe
    // on an existing one (which just refreshes compatibility/tier above).
    if (!existingMatch) {
      emitNotification({
        userId,
        type: 'dating_match',
        title: 'New match!',
        body: `You and ${char.name} matched.`,
        // ROUTE-FIX: the actual page is at /dating/match/[id]
        // (src/app/(main)/dating/match/[id]/page.tsx) — this was missing
        // the /match segment, so tapping a "New match!" notification 404'd.
        ctaUrl: `/dating/match/${match.id}`,
        urgency: 'high',
        icon: undefined,
        metadata: { matchId: match.id, characterId, characterName: char.name },
      }).catch(bg('emitNotification.datingMatch'));
    }
  });

  return NextResponse.json({
    matched:     true,
    match,
    compatibility: { score: finalScore, breakdown: compat, tier: matchTier },
    reason:        response.reason,
  });
}
