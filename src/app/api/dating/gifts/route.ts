/**
 * POST /api/dating/gifts
 * Send a gift to a matched character.
 *
 * DATING-2 (FIXED): Token deduction, gift insert, and bond update now execute
 *   inside the atomic send_gift() Postgres function. Partial failure is
 *   impossible — either all three succeed or none do.
 *
 * BILLING-2 (FIXED): deduct_tokens (called inside send_gift) now raises
 *   'insufficient_tokens' on balance failure, eliminating the TOCTOU race.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { z }                         from 'zod';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { GIFT_CATALOGUE, MILESTONE_FLAGS, checkMilestones, buildGiftAcknowledgmentPrompt } from '@/lib/dating/engine';
import type { MatchTier } from '@/lib/dating/engine';
import { routeCompletion }           from '@/lib/ai/provider-router';
import { emitDatingEvent }           from '@/lib/tracing';
import { bg, logger }                 from '@/lib/logger';
import { checkDatingActionLimit, resolveEffectiveTier } from '@/lib/rate-limit';
import { sanitize } from '@/lib/sanitize';
import { emitNotification } from '@/lib/notifications/emit';
import { recordSurprise } from '@/lib/ai/surprise-engine';
import { getGiftCatalogueAndHistory } from '@/lib/dating/get-match-detail';

export const dynamic = 'force-dynamic';

// Same generation-timeout convention as dating/date/start/route.ts's
// GENERATION_TIMEOUT_MS — this call runs entirely inside a fire-and-forget
// block (never awaited by the POST handler), so it never adds latency to
// the gift response itself; the cap just bounds how long a hung provider
// call can sit before the fallback line takes over.
const GIFT_ACK_TIMEOUT_MS = 6000;

// Derived from the catalogue itself so the two can never drift apart again —
// adding a gift to GIFT_CATALOGUE is now sufficient to make it purchasable.
const VALID_GIFT_TYPES = GIFT_CATALOGUE.map(g => g.type) as [string, ...string[]];

const schema = z.object({
  matchId:   z.string().uuid(),
  giftType:  z.enum(VALID_GIFT_TYPES),
  message:   z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });


  // MED-3: Rate limit gift endpoint — token balance check alone doesn't prevent rapid automation
  // GIFT-RATE-FIX: was checkChatLimit(), which shares the chat message
  // burst bucket — see checkDatingActionLimit's doc comment for why that silently
  // broke gift sends after a normal amount of chatting.
  const { data: profile } = await supabaseAdmin.from('profiles').select('tier,role,is_admin').eq('id', user.id).single();
  const tier = resolveEffectiveTier(profile ?? {});
  const rl = await checkDatingActionLimit(user.id, tier);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  const raw    = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const { matchId, giftType, message } = parsed.data;
  const gift = GIFT_CATALOGUE.find(g => g.type === giftType);
  if (!gift) return NextResponse.json({ error: 'Unknown gift type' }, { status: 400 });

  // Load match — scoped to this user
  const { data: match } = await supabaseAdmin
    .from('dating_matches')
    .select('id,user_id,character_id,bond_score,milestones,streak_days,match_tier')
    .eq('id', matchId)
    .eq('user_id', user.id)
    .single();

  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

  // Tier lock enforcement — gift must be unlocked by match tier
  const { isGiftUnlocked } = await import('@/lib/dating/engine');
  const matchTier = match.match_tier ?? 'spark';
  if (!isGiftUnlocked(gift.tier, matchTier)) {
    return NextResponse.json({
      error: `Reach ${gift.tier} tier to unlock ${gift.name}`,
      code: 'GIFT_LOCKED',
      requiredTier: gift.tier,
    }, { status: 403 });
  }


  // ── Atomic gift send (DATING-2) ──────────────────────────────────────────
  // All three mutations (deduct_tokens, insert gift, update bond) execute in
  // one Postgres transaction — partial failure is impossible.
  const { data: newBond, error: giftErr } = await supabaseAdmin.rpc('send_gift', {
    p_user_id:    user.id,
    p_match_id:   matchId,
    p_char_id:    match.character_id,
    p_gift_type:  giftType,
    p_gift_name:  gift.name,
    p_bond_bonus: gift.bond,
    p_token_cost: gift.tokens,
    p_message:    message ?? undefined,
  });

  if (giftErr) {
    // Surface insufficient_tokens as 402, all other errors as 500
    if (giftErr.message?.includes('insufficient_tokens')) {
      return NextResponse.json(
        { error: 'Insufficient Vantrix Coin', required: gift.tokens },
        { status: 402 },
      );
    }
    return NextResponse.json({ error: 'Gift send failed', details: giftErr.message }, { status: 500 });
  }

  const finalBond = ((newBond as unknown) as number) ?? match.bond_score + gift.bond;

  // Hoisted above both fire-and-forget blocks below (chat acknowledgment +
  // memory writes) that both need it — was previously computed only down
  // in the memory-writes section, which worked for that block (same tick,
  // see note there) but meant the chat-acknowledgment block above it would
  // have had to duplicate or awkwardly forward-reference it.
  const rarity = gift.rarity ?? 'common';
  // Reaction intensity scales with significance — this is what both the
  // prompt layer (assembleFullPrompt → flat memory facts, for FUTURE turns)
  // and the immediate chat acknowledgment below (for THIS turn) surface to
  // the character, so the character's own words about the gift reflect how
  // much it mattered, not a single fixed sentence for everything from a
  // coffee to a diamond ring.
  const reactionIntensity =
    rarity === 'legendary' ? 'It caught her completely off guard — the kind of gift she will bring up again unprompted, weeks from now.'
    : rarity === 'special'  ? 'It genuinely moved her — she lit up receiving it and it is sitting with her.'
    : 'It was a small, sweet gesture that made her smile.';

  // ── Surface the gift in chat, and have her react to it (GIFT-CHAT-FIX,
  //    GIFT-ACK-FIX) ─────────────────────────────────────────────────────
  // Gifts were only ever written to dating_gifts/memory_graph, so a user
  // opening the chat thread had no visible record of what they'd sent
  // (GIFT-CHAT-FIX). Find (or create) the standing conversation with this
  // character and drop a 'gift' role message into it — the chat UI renders
  // 'gift' rows as a distinct system-style card in the timeline.
  //
  // GIFT-ACK-FIX (2026-08-25): that log line was as far as it went — the
  // character herself never actually said anything back. reactionIntensity
  // above was written into user_facts/memory_graph either way, so SOME
  // future turn might eventually reference the gift, but nothing produced
  // an immediate in-character reply, which is the entire point of a gift
  // landing "in the moment." Generates one via the same one-off-narration
  // pattern dating/date/start/route.ts uses for opening scenes
  // (buildXPrompt + routeCompletion + timeout + non-LLM fallback), then
  // inserts it as a normal 'assistant' row right after the gift line —
  // same conversation, same transcript, no separate delivery mechanism to
  // build or for the client to know about.
  (async () => {
    try {
      let convId: string | null = null;
      const { data: existingConv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('user_id', user.id)
        .eq('character_id', match.character_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingConv) {
        convId = existingConv.id;
      } else {
        const { data: newConv } = await supabaseAdmin
          .from('conversations')
          .insert({ user_id: user.id, character_id: match.character_id, title: 'New conversation' })
          .select('id')
          .single();
        convId = newConv?.id ?? null;
      }

      if (convId) {
        const rarityTag = rarity === 'legendary' ? ' 👑' : rarity === 'special' ? ' 🌟' : '';
        // SEC FIX (Phase B audit, 2026-08-06): `message` is raw client
        // free text (up to 500 chars) that was interpolated into giftLine
        // and inserted as a 'gift'-role row in `messages` with NO
        // sanitization. chat/stream/route.ts's entire history-trust model
        // rests on "history is always sourced from the DB, pre-sanitized
        // on insert" — its history.map() blindly casts every stored role
        // (including 'gift') to 'user'/'assistant' and feeds `content`
        // straight into the LLM's prompt on every future turn, with no
        // per-role filtering. This insert path never sanitized, so it
        // silently broke that invariant — a persistent prompt-injection
        // vector identical in effect to the memory/fact-graph/evolution
        // fixes earlier in this audit, just via the gift-message field
        // instead of a regex-captured "fact". sanitize() closes it here,
        // at the point of insert, consistent with every other messages
        // insert in the codebase (see chat/stream/route.ts's own
        // `content: sanitize(message)` on its two insert sites).
        const safeMessage = message ? sanitize(message, 500) : undefined;
        const giftLine = safeMessage
          ? `You sent a ${gift.name}${rarityTag} — "${safeMessage}"`
          : `You sent a ${gift.name}${rarityTag}`;
        await supabaseAdmin.from('messages').insert({
          conversation_id: convId,
          role:            'gift',
          content:         giftLine,
        });
        await supabaseAdmin.from('conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', convId);

        // Character's own reply, right after the gift line.
        const { data: character } = await supabaseAdmin
          .from('characters')
          .select('name,description,personality')
          .eq('id', match.character_id)
          .single();

        if (character) {
          const characterVoice = [character.description, character.personality]
            .filter(Boolean).join(' ').slice(0, 400) || 'A warm, distinct personality.';
          const prompt = buildGiftAcknowledgmentPrompt({
            characterName:     character.name,
            characterVoice,
            giftName:          gift.name,
            giftEmoji:         gift.emoji,
            rarity,
            reactionIntensity,
            giftMessage:       safeMessage,
            matchTier:         (match.match_tier as MatchTier) ?? 'spark',
            bondScore:         finalBond,
            streakDays:        match.streak_days,
          });

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), GIFT_ACK_TIMEOUT_MS);
          let ackReply: string;
          try {
            const response = await routeCompletion({
              messages:    [{ role: 'system', content: prompt }],
              modelTier:   'SMART',
              maxTokens:   150,
              temperature: 0.9,
              signal:      controller.signal,
            });
            ackReply = response.reply?.trim() || '';
            if (!ackReply) throw new Error('empty response');
          } catch (err) {
            // Non-LLM fallback (same approach as date/start/route.ts) —
            // still an in-character line, not a silent no-op, if
            // generation fails or times out.
            logger.warn('gift: acknowledgment generation failed, using fallback', {
              userId: user.id, matchId, giftType,
              error: err instanceof Error ? err.message : String(err),
            });
            ackReply = rarity === 'legendary'
              ? `I don't even know what to say — this is incredible. Thank you.`
              : rarity === 'special'
              ? `This actually means a lot to me. Thank you.`
              : `Aw, thank you — that's sweet.`;
          } finally {
            clearTimeout(timer);
          }

          await supabaseAdmin.from('messages').insert({
            conversation_id: convId,
            role:            'assistant',
            content:         ackReply,
          });
          await supabaseAdmin.from('conversations')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', convId);
        }
      }
    } catch (err) {
      // Non-critical — the gift itself was already sent atomically above.
      logger.error('gift: chat-message write failed (non-critical)', { error: err instanceof Error ? err.message : String(err) });
    }
  })();

  // Count total gifts for milestone check
  const { count: giftCount } = await supabaseAdmin
    .from('dating_gifts').select('*', { count: 'exact', head: true })
    .eq('match_id', matchId);

  const milestoneCheck = checkMilestones({
    currentMilestones: match.milestones,
    bondScore:         finalBond,
    streakDays:        match.streak_days,
    totalMessages:     999,
    giftsGiven:        giftCount ?? 1,
  });

  let newMilestones = match.milestones;
  if (milestoneCheck.triggered.length > 0) {
    // MILESTONE-CHAT-FIX: emitNotification() alone only reaches the global
    // bell/toast (see notifications/route.ts's 2026-08-20 header note —
    // Realtime is what drives that now, not this route's SSE stream).
    // Chat-triggered milestones (message counts, streaks, level-ups in
    // chat/stream/route.ts) additionally call recordSurprise(), which is
    // what the in-chat MilestoneToastStack actually subscribes to — gift
    // milestones never did, so unlocking one mid-conversation produced a
    // bell notification but nothing in the conversation itself. Fetching
    // the character name once here (not selected on `match` above) to
    // match chat/stream's own surprise-message wording.
    const { data: giftCharacter } = await supabaseAdmin
      .from('characters').select('name').eq('id', match.character_id).single();
    const charName = giftCharacter?.name ?? 'her';

    for (const ms of milestoneCheck.triggered) {
      const flag = MILESTONE_FLAGS[ms as keyof typeof MILESTONE_FLAGS];
      newMilestones |= flag;
      await supabaseAdmin.from('dating_milestones').insert({
        match_id: matchId, user_id: user.id,
        milestone: ms, bond_bonus: milestoneCheck.bondBonus,
      });
      emitNotification({
        userId: user.id,
        type: 'milestone_unlocked',
        title: 'Milestone unlocked',
        body: `You unlocked "${ms}" with a character.`,
        // ROUTE-FIX: page lives at /dating/match/[id], not /dating/[id]
        // (see dating/swipe/route.ts for the same fix) — was 404'ing.
        ctaUrl: `/dating/match/${matchId}`,
        urgency: 'medium',
        metadata: { matchId, milestone: ms, bondBonus: milestoneCheck.bondBonus },
      }).catch(bg('emitNotification.milestoneUnlocked'));
      recordSurprise(
        user.id, match.character_id, 'milestone_unlocked',
        `You just hit a milestone with ${charName}: ${ms.replace(/_/g, ' ')}.`,
      ).catch(bg('recordSurprise.giftMilestone'));
    }
    await supabaseAdmin.from('dating_matches')
      .update({ milestones: newMilestones })
      .eq('id', matchId);
    if (milestoneCheck.bondBonus > 0) {
      await supabaseAdmin.rpc('update_bond_score', {
        p_match_id: matchId, p_delta: milestoneCheck.bondBonus,
      });
    }
  }

  // ── Gift memory writes (fire-and-forget) ─────────────────────────────────
  // Write to user_facts so the character can naturally reference this gift
  // in future conversations without being prompted. This is what makes
  // a gift feel like it actually mattered.
  const giftDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const giftMessage = message ? `They wrote: "${message}"` : '';
  // rarity/reactionIntensity: hoisted above (see comment there) — reused
  // as-is here rather than recomputed, so the memory write and the live
  // chat acknowledgment always agree on how significant this gift was.

  Promise.all([
    // user_facts — surfaces in character prompt assembly as memory
    supabaseAdmin.from('user_facts').upsert({
      user_id:      user.id,
      character_id: match.character_id,
      category:     'relationship',
      key:          `gift_${giftType}_${Date.now()}`,
      value:        `${match.character_id} received a ${gift.name} on ${giftDate}. ${giftMessage} ${reactionIntensity}`,
      confidence:   0.95,
      source:       'gift_system',
    }, { onConflict: 'user_id,character_id,key' }),

    // memory_graph — emotional weight scales with gift significance.
    // BUG-4 FIX: schema uses title/description/tags, not content/source.
    // The previous insert silently failed on every gift because Supabase
    // rejected the unknown columns inside the fire-and-forget .catch().
    supabaseAdmin.from('memory_graph').insert({
      user_id:          user.id,
      character_id:     match.character_id,
      event_type:       'gift',
      title:            `${gift.name} received`,
      description:      `Received a ${gift.name}${message ? `: "${message}"` : ''}`,
      tags:             ['gift', giftType],
      emotional_weight: gift.bond >= 25 ? 9 : gift.bond >= 15 ? 7 : 5,
    }),
  ]).catch((err) => {
    // Non-critical — gift was already sent atomically; memory write failure is acceptable
    logger.error('gift: memory write failed (non-critical)', { error: err instanceof Error ? err.message : String(err) });
  });

  // ── Permanent world impact (WORLD-IMPACT) ─────────────────────────────────
  // Only gifts significant enough to matter leave a durable mark — common
  // gifts already get their due via user_facts/memory_graph above. Special
  // and legendary gifts, or any gift that triggered a real milestone, are
  // exactly the "actions should permanently change the world" moments: they
  // get logged to world_impact_events and, if weighty enough, promoted into
  // universe_memory (visible in the character's public history/biography).
  if (rarity !== 'common' || milestoneCheck.triggered.length > 0) {
    after(() => {
      import('@/lib/universe/world-impact').then(({ recordWorldImpact }) =>
        recordWorldImpact({
          characterId: match.character_id,
          userId:      user.id,
          source:      'gift',
          title:       `Given a ${gift.name}`,
          description: `Was given a ${gift.name}${message ? `, with the words: "${message}"` : ''}. ${reactionIntensity}`,
          publicSummary: `Received a ${gift.name}.`,
          weight:      rarity === 'legendary' ? 80 : rarity === 'special' ? 55 : 35,
          characterName: undefined,
        }),
      ).catch((err) => logger.error('gift: world-impact write failed (non-critical)', { error: err instanceof Error ? err.message : String(err) }));
    });
  }

  // OBS-1: Emit tracing event for gift send
  after(() => {
    emitDatingEvent({ userId: user.id, matchId, operation: 'gift_sent', outcome: 'success',
      meta: { giftType, tokenCost: gift.tokens, newBond: finalBond } }).catch(bg('emitDatingEvent.giftSent'));
  });

  return NextResponse.json({
    success:      true,
    gift:         { ...gift, message },
    newBondScore: finalBond,
    tokensSpent:  gift.tokens,
    milestones:   milestoneCheck.triggered,
  });
}

// ROOT-CAUSE FIX (2026-08-25): the matchId-scoped catalogue+history lookup
// now lives in lib/dating/get-match-detail.ts (getGiftCatalogueAndHistory),
// so (app)/dating/match/[id]/page.tsx can call it in-process instead of
// self-fetching this route — see that file's header comment. The IDOR
// ownership check (match must belong to the requesting user) moved with it,
// unchanged. This handler is now a thin wrapper, still serving any
// client-side/external caller.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get('matchId');
  if (!matchId) return NextResponse.json({ catalogue: GIFT_CATALOGUE });

  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await getGiftCatalogueAndHistory(user.id, matchId);
  if (!result) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

  return NextResponse.json(result);
}
