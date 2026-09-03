/**
 * POST /api/dating/mood
 * Update character mood after a conversation session.
 *
 * DATING-3 (FIXED): ChatWindow now calls this endpoint on session end via
 *   the unmount/blur/visibility handlers added in chat-window.tsx.
 *
 * DATING-5 (FIXED): first_chat milestone now triggers here (totalMessages >= 1),
 *   not at swipe time in swipe/route.ts.
 *
 * OBS-2 (FIXED): The mood column update is now awaited separately with error
 *   handling. A failed mood update no longer silently returns 200 OK while
 *   leaving stale mood in the database.
 *
 * OBS-1 (FIXED): Emits a dating tracing event for observability.
 *
 * MILESTONE-CHAT-FIX (FIXED): first_chat/deep_talk/week_streak/soulmate now
 *   also call recordSurprise() when triggered, so they surface as an
 *   in-chat toast the same way gift- and date-triggered milestones do —
 *   previously only got a silent world-impact trace.
 */
import { NextRequest, NextResponse, after }  from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { z }                          from 'zod';
import { supabaseAdmin }              from '@/lib/supabase/admin';
import { inferMoodFromReply, computeBondDelta,
         checkMilestones, MILESTONE_FLAGS,
         type CharacterMood }         from '@/lib/dating/engine';
import { emitDatingEvent }            from '@/lib/tracing';
import { advancePrestige }            from '@/lib/dating/prestige-chapters';
import { bg, logger }                 from '@/lib/logger';
import { checkDatingActionLimit, resolveEffectiveTier } from '@/lib/rate-limit';
import { recordSurprise }             from '@/lib/ai/surprise-engine';

export const dynamic = 'force-dynamic';

// Mirrors the weighting the gifts route uses for its own milestone-triggered
// world-impact calls — kept here since these are relationship-progression
// milestones specifically, not the gift-rarity-driven ones. soulmate is
// deliberately >= the promotion threshold (65) in world-impact.ts: reaching
// it is meant to become permanent world history, not just a private log line.
const MILESTONE_IMPACT: Record<string, { title: string; weight: number }> = {
  first_chat:   { title: 'First real conversation',        weight: 20 },
  deep_talk:    { title: 'A conversation that went deep',   weight: 32 },
  week_streak:  { title: 'A full week, without missing a day', weight: 42 },
  soulmate:     { title: 'Recognized as a soulmate',        weight: 78 },
};

const schema = z.object({
  matchId:      z.string().uuid(),
  lastReply:    z.string().max(2000),
  messageCount: z.number().int().min(1),
});

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });


  // MED-3: Rate limit mood endpoint to prevent XP/streak farming via rapid mood resets
  const { data: profile } = await supabaseAdmin.from('profiles').select('tier,role,is_admin').eq('id', user.id).single();
  const tier = resolveEffectiveTier(profile ?? {});
  const rl = await checkDatingActionLimit(user.id, tier);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  const raw    = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 });

  const { matchId, lastReply, messageCount } = parsed.data;

  const { data: match } = await supabaseAdmin
    .from('dating_matches')
    .select('id,character_id,bond_score,milestones,streak_days,character_mood,user_id,relationship_state')
    .eq('id', matchId).eq('user_id', user.id).single();

  if (!match) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const newMood   = inferMoodFromReply(lastReply, match.character_mood as CharacterMood);
  const bondDelta = computeBondDelta({
    messageCount,
    isDatingMode:  true,
    streakDays:    match.streak_days,
    currentBond:   match.bond_score,
  });

  // OBS-2 (FIXED): Bond and streak RPCs run in parallel (fast path).
  // Mood column update runs separately with explicit error handling so a failure
  // is surfaced rather than silently dropped inside a Promise.all ignore slot.
  // WIRE-FIX (2026-08-24): conversation_count now advances alongside bond/
  // streak, via the same atomic-RPC convention — see
  // 20261125_dating_conversation_count_wiring.sql's header comment for the
  // full root-cause writeup. This is the one and only place a dating
  // session's conversation gets counted; nothing else in the app ever
  // touched this column before.
  const [bondRes, streakRes, convCountRes] = await Promise.all([
    supabaseAdmin.rpc('update_bond_score', { p_match_id: matchId, p_delta: bondDelta }),
    supabaseAdmin.rpc('update_dating_streak', { p_match_id: matchId }),
    supabaseAdmin.rpc('increment_conversation_count', { p_match_id: matchId }),
  ]);

  // OBS-2: Mood update is awaited with error handling — a failure is now visible
  const { error: moodErr } = await supabaseAdmin
    .from('dating_matches')
    .update({ character_mood: newMood })
    .eq('id', matchId);

  if (moodErr) {
    // Non-fatal but logged — mood is cosmetic, bond/streak are the critical state
    logger.error('mood: failed to update character_mood', { error: moodErr.message });
  }

  const newBond   = bondRes.data ?? match.bond_score;
  const newStreak = streakRes.data ?? match.streak_days;
  if (convCountRes.error) {
    // Non-fatal, same treatment as the mood-column failure above — bond/
    // streak are the critical state, conversation_count only feeds display
    // (chemistry/compatibility/forecast), so a failure here shouldn't fail
    // the whole mood-sync request.
    logger.error('mood: failed to increment conversation_count', { error: convCountRes.error.message });
  }

  // ── Estrangement state — relationship tension mechanics ───────────────────
  // If bond drops below 20 AND mood is melancholic, enter estrangement.
  // If bond hits 0, formally estranged. Recovery is a multi-day story arc.
  // This is the mechanic that makes stakes feel real (Tamagotchi principle).
  const ESTRANGED_THRESHOLD = 5;
  const TENSION_THRESHOLD   = 20;
  if (newBond <= ESTRANGED_THRESHOLD) {
    // Mark match as estranged so chat system can adapt character tone
    await supabaseAdmin
      .from('dating_matches')
      .update({ relationship_state: 'estranged' })
      .eq('id', matchId);
  } else if (newBond <= TENSION_THRESHOLD && newMood === 'melancholic') {
    await supabaseAdmin
      .from('dating_matches')
      .update({ relationship_state: 'tension' })
      .eq('id', matchId);
  } else if (match.relationship_state === 'estranged' && newBond > TENSION_THRESHOLD) {
    // Recovering from estrangement — clear state
    await supabaseAdmin
      .from('dating_matches')
      .update({ relationship_state: 'healthy' })
      .eq('id', matchId);
  }

  // Count totals for milestone check.
  // BUG-A FIX: messages are linked to conversations, not directly to matches.
  //   conversations has a match_id column — find conversation IDs for this match,
  //   then count their messages. Previously .eq('conversation_id', matchId) was wrong
  //   because matchId is a dating_matches.id, not a conversations.id, so it always
  //   returned 0 and fell through to the client-supplied messageCount.
  // BUG-B FIX: totalMessages now comes only from the verified DB count.
  //   Client-supplied messageCount is no longer used for milestone gating — a client
  //   could send messageCount=999 to trigger all message-count-gated milestones.
  //   We default to 0 on DB error (safe: milestones fire on the next correct count).
  // BUG-C FIX (2026-08-24, MOOD-SYNC-FIX follow-up): BUG-A's fix moved the
  //   filter from the wrong column (conversation_id) to the right *name*
  //   (match_id) but conversations.match_id is never actually written by any
  //   code path — /api/conversations/ensure, chat/[id]/page.tsx's
  //   find-or-create, dating/date/start, and dating/scene all create/look up
  //   the standing conversation by (user_id, character_id) only, exactly like
  //   this route's own `match` lookup already resolves character_id for us.
  //   The result: this query always returned zero rows, totalMsgs stayed 0
  //   forever, and first_chat (totalMessages>=1) / deep_talk
  //   (totalMessages>=30) could never trigger — silently, for every match,
  //   since the day this route shipped. Only surfaced now because
  //   MOOD-SYNC-FIX (use-dating-mood-sync.ts) just made this route actually
  //   get called from real chat sessions instead of never. Filtering by
  //   character_id instead of the dead match_id column fixes it without
  //   needing a backfill or a new write path.
  const [{ data: convRows }, { count: totalGifts }] = await Promise.all([
    supabaseAdmin.from('conversations')
      .select('id')
      .eq('character_id', match.character_id)
      .eq('user_id', user.id),
    supabaseAdmin.from('dating_gifts')
      .select('*', { count: 'exact', head: true })
      .eq('match_id', matchId),
  ]);

  let totalMsgs = 0;
  if (convRows && convRows.length > 0) {
    const convIds = convRows.map((c: { id: string }) => c.id);
    const { count } = await supabaseAdmin.from('messages')
      .select('*', { count: 'exact', head: true })
      .in('conversation_id', convIds);
    totalMsgs = count ?? 0;
  }

  const ms = checkMilestones({
    currentMilestones: match.milestones,
    bondScore:         newBond,
    streakDays:        newStreak,
    // DATING-5: server-verified message count — never trust client-supplied value
    totalMessages:     totalMsgs,
    giftsGiven:        totalGifts ?? 0,
  });

  let newMilestones = match.milestones;
  if (ms.triggered.length > 0) {
    for (const name of ms.triggered) {
      newMilestones |= MILESTONE_FLAGS[name as keyof typeof MILESTONE_FLAGS];
      await supabaseAdmin.from('dating_milestones').insert({
        match_id: matchId, user_id: user.id, milestone: name, bond_bonus: ms.bondBonus,
      });
    }
    await supabaseAdmin.from('dating_matches')
      .update({ milestones: newMilestones })
      .eq('id', matchId);
    // MILESTONE-CHAT-FIX: mirrors gifts/route.ts's identical fix. Now that
    // MOOD-SYNC-FIX actually calls this route from real chat sessions,
    // first_chat/deep_talk/week_streak/soulmate fire far more often than
    // gift-triggered milestones ever did — but until now they only got the
    // silent world-impact trace below, never a user-facing surface at all
    // (no bell notification, no in-chat toast). recordSurprise() is what
    // the in-chat MilestoneToastStack subscribes to (see gifts/route.ts's
    // comment for why emitNotification alone wouldn't reach it either —
    // not added here since, unlike a gift, there's no natural bell-inbox
    // deep-link for a mood-sync milestone to carry).
    const { data: moodCharacter } = await supabaseAdmin
      .from('characters').select('name').eq('id', match.character_id).single();
    const charName = moodCharacter?.name ?? 'her';
    for (const name of ms.triggered) {
      recordSurprise(
        user.id, match.character_id, 'milestone_unlocked',
        `You just hit a milestone with ${charName}: ${name.replace(/_/g, ' ')}.`,
      ).catch(bg('recordSurprise.moodMilestone'));
    }
    // WORLD-IMPACT-FIX: milestones triggered here (via normal chatting —
    // first_chat/deep_talk/week_streak/soulmate) previously had no durable
    // trace at all; only gift-triggered milestones did (see gifts/route.ts).
    // Since these fire far more often through conversation than through a
    // gift-send, this was the larger gap of the two. Fire-and-forget, same
    // as the gifts route — never blocks the mood-update response.
    after(() => {
      for (const name of ms.triggered) {
        const impact = MILESTONE_IMPACT[name];
        if (!impact) continue;
        import('@/lib/universe/world-impact').then(({ recordWorldImpact }) =>
          recordWorldImpact({
            characterId: match.character_id,
            userId:      user.id,
            source:      'milestone',
            title:       impact.title,
            description: `${impact.title.charAt(0).toLowerCase()}${impact.title.slice(1)} with this person.`,
            publicSummary: impact.title,
            weight:      impact.weight,
          }),
        ).catch((err) => logger.error('mood: world-impact write failed (non-critical)', {
          milestone: name, error: err instanceof Error ? err.message : String(err),
        }));
      }
    });
  }

  // OBS-1: Emit tracing event
  after(() => {
    emitDatingEvent({
      userId: user.id, matchId, operation: 'mood_updated', outcome: 'success',
      meta: { newMood, bondDelta, newStreak, milestones: ms.triggered },
    }).catch(bg('emitDatingEvent.moodUpdated'));

    // WIRE-FIX: advancePrestige's own doc comment says it's meant to be
    // "called by cron or mood update" — nothing called it from either.
    // advancePrestige no-ops cheaply (one read, no writes) for any match
    // not yet in prestige, so calling it unconditionally on every mood
    // update is safe — the eligibility check lives inside it.
    advancePrestige(supabaseAdmin, user.id, matchId).catch(bg('advancePrestige'));
  });

  return NextResponse.json({
    mood:       newMood,
    bondScore:  newBond,
    bondDelta,
    streak:     newStreak,
    milestones: ms.triggered,
  });
}
