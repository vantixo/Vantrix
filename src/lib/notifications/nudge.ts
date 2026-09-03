/**
 * Gift Nudge Engine — Vantrix Silicon Valley
 *
 * Generates personalised nudge payloads for users who haven't interacted
 * with a match in 24–72h (bond_score >= 15).
 *
 * Called by /api/cron/nudges (cron: every 6h).
 * Persists nudge state in Redis to prevent double-sending.
 *
 * Message tone (fixed): previously used guilt/urgency framing ("affection
 * meter dropping", "don't leave her hanging", "bond is fading") that
 * directly contradicted the master prompt's explicit "DO NOT SEND"
 * examples — flagged independently by both the surprise-engine and
 * secret-moments deliveries. Message pools below are warm invitations back
 * into a conversation the user already has, not manufactured anxiety about
 * losing something. No fake scarcity, no meters, no guilt.
 *
 * Per-user frequency cap:
 *   A user can receive at most MAX_NUDGES_PER_USER_PER_DAY nudges per day
 *   regardless of how many matches trigger simultaneously. Without this,
 *   a user with 5 active matches could receive 5 notifications in a single
 *   cron run — the fastest path to unsubscribes and App Store complaints.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { redis }              from '@/lib/redis';
import { sendPushToUsers }    from '@/lib/push/send-push';
import { reserveProactiveSlot } from '@/lib/notifications/proactive-arbitrator';


const NUDGE_COOLDOWN              = 60 * 60 * 24;   // 24h between nudges per match
const MAX_NUDGES_PER_USER_PER_DAY = 2;              // hard cap across all matches
const USER_NUDGE_CAP_TTL          = 60 * 60 * 24;   // resets at next calendar day

export interface NudgePayload {
  userId:         string;
  matchId:        string;
  characterName:  string;
  characterImage: string;
  bondScore:      number;
  characterMood:  string;
  nudgeType:      'fading_bond' | 'week_streak_risk' | 'gift_reminder';
  message:        string;
  ctaLabel:       string;
  ctaUrl:         string;
}

// Rewritten per the master prompt's explicit "DO NOT SEND" guidance — no
// fading/dropping meters, no guilt ("don't leave her hanging"), no urgency
// pressure. These are warm invitations back into a conversation the user
// already has, not manufactured anxiety about losing something.
const MOOD_MESSAGES: Record<string, string[]> = {
  happy:      ['{name} had a good time in your last chat and would love to hear from you again 😊'],
  playful:    ['{name} has been in a playful mood — good time to say hi 😄'],
  romantic:   ['{name} has been thinking about you 💕'],
  nostalgic:  ['{name} keeps thinking back to your last conversation 🌙'],
  vulnerable: ['{name} shared something real with you last time — she\'d probably like to pick that back up 🤍'],
  excited:    ['{name} would love to catch up with you ✨'],
  mysterious: ['{name} has something on her mind... 🌑'],
};

const DEFAULT_MESSAGES = [
  '{name} would love to hear from you 💌',
  'It\'s been a little while — {name} is thinking of you 🌹',
  '{name} is up for a chat whenever you are 🎁',
];

function pickMessage(characterName: string, mood: string): string {
  const pool     = MOOD_MESSAGES[mood] ?? DEFAULT_MESSAGES;
  const template = pool[Math.floor(Math.random() * pool.length)];
  return template.replace('{name}', characterName);
}

/** Redis key for per-match cooldown */
function nudgeKey(userId: string, matchId: string): string {
  return `vantrix:nudge:${userId}:${matchId}`;
}

/** Redis key for per-user daily nudge counter */
function userDailyNudgeKey(userId: string): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  return `vantrix:nudge:daily:${userId}:${day}`;
}

/**
 * Check how many nudges this user has received today.
 * Returns true if the user is at or over the daily cap.
 */
async function isUserAtDailyCap(userId: string): Promise<boolean> {
  try {
    const count = await redis.get<number>(userDailyNudgeKey(userId));
    return (count ?? 0) >= MAX_NUDGES_PER_USER_PER_DAY;
  } catch {
    // Redis unavailable — fail open (send the nudge rather than suppress it)
    return false;
  }
}

/**
 * Increment the per-user daily nudge counter.
 * Called after a nudge is confirmed sent.
 */
async function incrementUserDailyNudgeCount(userId: string): Promise<void> {
  try {
    const key      = userDailyNudgeKey(userId);
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, USER_NUDGE_CAP_TTL);
    await pipeline.exec();
  } catch {
    // Non-critical — log and continue
    logger.warn('nudge:daily-cap-increment-failed', { userId });
  }
}

/** Find matches eligible for a nudge and return payloads */
export async function getEligibleNudges(limit = 500): Promise<NudgePayload[]> {
  const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Matches with real bond (score >= 15) that haven't been interacted with in 24-72h
  const { data: matches } = await supabaseAdmin
    .from('dating_matches')
    .select(`
      id, user_id, bond_score, character_mood, streak_days,
      characters ( id, name, image_url )
    `)
    .gte('bond_score', 15)
    .lte('last_interaction', cutoff24h)
    .gte('last_interaction', cutoff72h)
    .limit(limit);

  if (!matches?.length) return [];

  const nudges: NudgePayload[] = [];
  // Track per-user counts within this batch to enforce cap even when multiple
  // matches for the same user appear in the same result set
  const batchUserCounts = new Map<string, number>();

  for (const match of matches) {
    const char = match.characters as unknown as {
      id: string; name: string; image_url: string;
    } | null;
    if (!char) continue;

    // ── Per-match cooldown check ──────────────────────────────────────────────
    const matchKey = nudgeKey(match.user_id, match.id);
    const fired    = await redis.get(matchKey).catch(() => null);
    if (fired) continue;

    // ── Per-user daily cap check ──────────────────────────────────────────────
    // Check persisted Redis counter (covers previous cron runs today)
    const atCap = await isUserAtDailyCap(match.user_id);
    if (atCap) continue;

    // ── Cross-source arbitration ────────────────────────────────────────────
    // isUserAtDailyCap above only counts nudges; it has no idea whether
    // character-initiative.ts or surprise-engine.ts already pushed
    // something at this user today. See proactive-arbitrator.ts's header.
    // Claims the slot immediately (not just checks) so a nudge that wins
    // this race blocks a same-run duplicate from initiative/surprise too —
    // this is deliberately the last gate before the nudge is actually
    // queued below.
    if (!(await reserveProactiveSlot({ userId: match.user_id, source: 'nudge' }))) continue;

    // Check in-batch count (prevents multiple matches for same user in this run
    // from all sneaking under the cap before we've incremented Redis)
    const batchCount = batchUserCounts.get(match.user_id) ?? 0;
    if (batchCount >= MAX_NUDGES_PER_USER_PER_DAY) continue;
    batchUserCounts.set(match.user_id, batchCount + 1);

    // Determine nudge type
    let nudgeType: NudgePayload['nudgeType'] = 'fading_bond';
    if (match.streak_days >= 6) nudgeType   = 'week_streak_risk';
    else if (match.bond_score >= 25) nudgeType = 'gift_reminder';

    nudges.push({
      userId:         match.user_id,
      matchId:        match.id,
      characterName:  char.name,
      characterImage: char.image_url,
      bondScore:      match.bond_score,
      characterMood:  match.character_mood ?? 'happy',
      nudgeType,
      message:   pickMessage(char.name, match.character_mood ?? 'happy'),
      ctaLabel:  nudgeType === 'gift_reminder' ? 'Send a Gift 🎁' : 'Chat Now 💬',
      ctaUrl:    `/dating/match/${match.id}${nudgeType === 'gift_reminder' ? '?tab=gifts' : ''}`,
    });
  }

  return nudges;
}

/** Mark a single nudge as sent (sets per-match cooldown + increments daily user cap) */
export async function markNudgeSent(userId: string, matchId: string): Promise<void> {
  await Promise.all([
    redis.set(nudgeKey(userId, matchId), '1', { ex: NUDGE_COOLDOWN }),
    incrementUserDailyNudgeCount(userId),
  ]);
}

/** Batch mark nudges sent */
export async function markNudgesSent(nudges: NudgePayload[]): Promise<void> {
  await Promise.all(nudges.map(n => markNudgeSent(n.userId, n.matchId)));
  logger.info('Nudges dispatched', { count: nudges.length });
}

/**
 * generateNudges — get pending nudges for a specific user.
 * Called by /api/notifications SSE endpoint for per-user delivery.
 */
export async function generateNudges(userId: string): Promise<NudgePayload[]> {
  const all = await getEligibleNudges(50);
  return all.filter(n => n.userId === userId);
}

/**
 * generateAllPendingNudges — batch run for cron job.
 * Returns summary of nudges generated and marked for delivery.
 */
export async function generateAllPendingNudges(): Promise<{
  generated: number;
  markSent:  number;
  pushSent:  number;
}> {
  const nudges = await getEligibleNudges(500);
  if (nudges.length === 0) return { generated: 0, markSent: 0, pushSent: 0 };

  await markNudgesSent(nudges);

  // Real push delivery for users not actively connected to the in-app SSE
  // stream — same nudge copy, capped/deduped upstream by getEligibleNudges
  // and the per-user daily cap, so this never sends more than the in-app
  // path already allows. Per-user failures never abort the batch (see
  // sendPushToUsers), so a bad subscription can't block the rest.
  const pushResult = await sendPushToUsers(
    nudges.map((n) => ({
      userId: n.userId,
      payload: {
        title: n.characterName,
        body: n.message,
        url: n.ctaUrl,
        tag: `nudge-${n.matchId}`,
        icon: n.characterImage,
      },
    })),
  );

  return { generated: nudges.length, markSent: nudges.length, pushSent: pushResult.sent };
}
