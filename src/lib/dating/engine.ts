/**
 * Dating Engine — Vantrix
 *
 * Core logic for compatibility scoring, bond progression, milestone detection,
 * streak management, and mood inference. All stateful mutations go through
 * atomic Postgres functions to eliminate race conditions.
 */


// ── Types ──────────────────────────────────────────────────────────────────

export interface UserPersonality {
  openness:   number; // 0-100
  warmth:     number;
  adventure:  number;
  depth:      number;
  vibeTag:    string[];
}

export interface CharacterPersonality {
  char_openness:  number;
  char_warmth:    number;
  char_adventure: number;
  char_depth:     number;
  love_language:  string;
  archetype:      string;
  tags:           string[];
}

export interface CompatibilityBreakdown {
  vibe:        number; // tag overlap
  personality: number; // axis proximity
  mystery:     number; // archetype attraction (opposites attract ±)
  overall:     number;
}

export type CharacterMood =
  | 'happy' | 'playful' | 'romantic' | 'nostalgic'
  | 'vulnerable' | 'excited' | 'mysterious' | 'melancholic';

// WIRE-FIX (2026-08-24): was 'spark' | 'flame' | 'soulmate' — missing 'deep',
// even though DATING_TIER_ORDER/DATING_TIER_LABELS (constants.ts) and every
// UI consumer (world-relationship-card.tsx, match/[id]/page.tsx) already
// treat match_tier as the 4-value DatingMatchTier. See scoreToMatchTier()
// below for the full root-cause writeup — this narrower type is what let
// scoreToMatchTier() ship without a 'deep' branch in the first place.
export type MatchTier = 'spark' | 'flame' | 'deep' | 'soulmate';

// ── Constants — moved to constants.ts (client-safe, no server deps) ────────
// Imported (not just re-exported) because engine.ts itself uses MILESTONE_FLAGS
// below. A bare `export { X } from './constants'` only re-exports X for
// consumers — it doesn't bind X into this module's own scope, which left
// MILESTONE_FLAGS undefined at its usage site. Re-exported here too so every
// existing server-side import of these from engine.ts keeps working unchanged.
import type { GiftRarity } from './constants';
import {
  MILESTONE_FLAGS,
  GIFT_CATALOGUE,
  DATE_CATALOGUE,
  DATING_TIER_ORDER,
  isGiftUnlocked,
  isDateUnlocked,
} from './constants';
export { MILESTONE_FLAGS, GIFT_CATALOGUE, DATE_CATALOGUE, DATING_TIER_ORDER, isGiftUnlocked, isDateUnlocked };
export type { GiftType, GiftRarity, DateType, DatingMatchTier } from './constants';

// ── Compatibility Engine ──────────────────────────────────────────────────

/**
 * Compute a deterministic compatibility score (0-100) between a user's dating
 * profile and a character. Combines:
 *   - Vibe/tag overlap (30%)
 *   - Personality axis proximity via Euclidean distance (40%)
 *   - Archetype mystery factor — some opposites attract (20%)
 *   - Random seed per pair for uniqueness variance (10%)
 */
export function computeCompatibility(
  user: UserPersonality,
  char: CharacterPersonality,
  pairSeed: number, // deterministic per user+char UUID hash
): CompatibilityBreakdown {
  // Tag overlap score.
  // DATING-HARDER: previously any vibe-tag overlap got a flat +30 baseline
  // bump on top of the overlap ratio, and users with zero tags got a free
  // 60 floor — meaning a stranger with no shared interests at all still
  // scored as "60% compatible" before personality/mystery were even
  // factored in. Overlap now has to actually earn its score; no-tag users
  // get a neutral-low 35 rather than a free pass.
  const userVibes  = new Set(user.vibeTag.map(t => t.toLowerCase()));
  const charVibes  = new Set(char.tags.map(t => t.toLowerCase()));
  const overlap    = [...userVibes].filter(t => charVibes.has(t)).length;
  const vibeScore  = userVibes.size > 0
    ? Math.min(100, Math.round((overlap / Math.max(userVibes.size, 1)) * 100))
    : 35;

  // Personality proximity (0-100, higher = closer)
  const axes: Array<[keyof UserPersonality & string, keyof CharacterPersonality & string]> = [
    ['openness', 'char_openness'],
    ['warmth',   'char_warmth'],
    ['adventure','char_adventure'],
    ['depth',    'char_depth'],
  ];
  const distances = axes.map(([uk, ck]) =>
    Math.abs((user[uk as keyof UserPersonality] as number) - (char[ck as keyof CharacterPersonality] as number))
  );
  const avgDist        = distances.reduce((a, b) => a + b, 0) / distances.length;
  const personalityScore = Math.round(100 - avgDist);

  // Mystery factor: some archetypal mismatches create attraction.
  // DATING-HARDER: floor cut from 60 to 30 and the archetype boosts halved
  // — this axis was previously worth almost as much as personality fit
  // regardless of the pair, which meant a mismatched pair could still
  // clear a match on "mystery" alone.
  const OPPOSITE_BOOST: Record<string, number> = {
    mysterious:   8,
    adventurous:  5,
    intellectual: 4,
    playful:      3,
  };
  const mysteryScore = Math.min(100,
    30 + (OPPOSITE_BOOST[char.archetype] ?? 0) + (pairSeed % 20)
  );

  // Weighted average
  const overall = Math.round(
    vibeScore        * 0.30 +
    personalityScore * 0.40 +
    mysteryScore     * 0.20 +
    (pairSeed % 100) * 0.10
  );

  return {
    vibe:        Math.min(100, vibeScore),
    personality: Math.min(100, personalityScore),
    mystery:     Math.min(100, mysteryScore),
    // DATING-HARDER: floor dropped from 20 to 5 — a genuinely poor match
    // should be able to score as poor, not be propped up to a nominal 20.
    overall:     Math.min(100, Math.max(5, overall)),
  };
}

/** Deterministic numeric seed from two UUIDs */
export function pairSeed(userIdHex: string, charIdHex: string): number {
  const combined = userIdHex.replace(/-/g, '') + charIdHex.replace(/-/g, '');
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash) + combined.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 100;
}

/**
 * Map overall score to match tier.
 *
 * WIRE-FIX (2026-08-24): this was the sole place `match_tier` ever gets
 * assigned (swipe/route.ts calls it on every swipe/re-swipe) and it only
 * ever returned 'spark' | 'flame' | 'soulmate' — 'deep' was never a
 * reachable output. But 'deep' is a fully first-class tier everywhere else
 * in the dating domain: DATING_TIER_ORDER/DATING_TIER_LABELS (constants.ts)
 * define it, isGiftUnlocked()/isDateUnlocked() gate content on it, the
 * "Spontaneous Adventure" date (DATE_CATALOGUE, tier: 'deep') is gated
 * behind it specifically, and every UI consumer of match_tier already reads
 * it as the 4-value DatingMatchTier. Since a match could only ever be
 * assigned 'spark'/'flame'/'soulmate', a match had to jump straight from
 * 'flame' to 'soulmate' (score >= 85) — 'deep' itself, and the content
 * gated specifically at it, was structurally unreachable for every match,
 * ever. Splits the old flame band (65-84) into flame (65-74) and deep
 * (75-84); the spark (<65) and soulmate (85+) boundaries are unchanged.
 */
export function scoreToMatchTier(score: number): MatchTier {
  if (score >= 85) return 'soulmate';
  if (score >= 75) return 'deep';
  if (score >= 65) return 'flame';
  return 'spark';
}

// ── Like Reciprocation Gate ──────────────────────────────────────────────
//
// Previously every 'like'/'super_like' swipe auto-created a match — the
// compatibility score only affected the *tier* of a match that was
// guaranteed to happen. That made every character reciprocate every time,
// which isn't how attraction works and cheapened the whole system.
//
// Characters now have to actually be won over:
//   - Archetype sets how easy/hard a character is to win over (a warm,
//     playful character says yes more readily than a mysterious, aloof one).
//   - Prior connection (existing chat relationship bond, if the user has
//     talked to this character outside of dating mode) makes reciprocation
//     more likely — she already knows them a little.
//   - A super_like signals stronger intent and gets a real boost, not a
//     token +8.
//   - The daily jitter means a "no" today isn't permanent — moods shift,
//     so trying again later can succeed even though the compatibility
//     score itself is deterministic per pair.

/** Base threshold each archetype needs cleared before reciprocating a like.
 *  DATING-HARDER: raised across the board (+~15-17 each) to pair with the
 *  less-generous compatibility scoring above — a match should mean the
 *  compatibility score actually did the work, not that almost any score
 *  cleared a low bar. Relative ordering between archetypes (warm/playful
 *  easiest, guarded/mysterious hardest) is unchanged. */
const ARCHETYPE_THRESHOLD: Record<string, number> = {
  mysterious:   79,
  intellectual: 75,
  guarded:      82,
  playful:      58,
  warm:         54,
  romantic:     61,
  adventurous:  64,
};
const DEFAULT_THRESHOLD = 67;

/** Deterministic per-day jitter — same pair gets a different roll each
 *  calendar day (UTC), so a rejected like is worth retrying tomorrow
 *  rather than being a permanent dead end. */
function dailyJitter(pairSeedValue: number): number {
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  let hash = pairSeedValue * 2654435761 + dayIndex;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  return (hash % 21) - 10; // -10..+10
}

export interface LikeResponseResult {
  reciprocated: boolean;
  threshold:    number;
  roll:         number; // score + jitter + bonuses, what was actually compared to threshold
  reason:       string; // short, character-appropriate explanation for the UI
}

/**
 * Decide whether a character reciprocates a like/super_like. This is the
 * gate that was previously entirely absent — call this BEFORE creating a
 * dating_matches row, and only create the match if reciprocated is true.
 */
export function evaluateLikeResponse(opts: {
  compatibilityScore: number;
  archetype:           string;
  direction:            'like' | 'super_like';
  pairSeedValue:        number;
  /** Existing chat relationship bond (0-100) if the user has talked to this
   *  character outside dating mode. 0 if no prior relationship exists. */
  priorChatBond:        number;
}): LikeResponseResult {
  const threshold = ARCHETYPE_THRESHOLD[opts.archetype.toLowerCase()] ?? DEFAULT_THRESHOLD;

  // DATING-HARDER: both boosts cut roughly in half. At the old 12/0.25
  // values, a super_like plus a modest existing chat bond could clear
  // almost the entire threshold range on their own, regardless of actual
  // compatibility — that made the compatibility score close to decorative
  // for any user willing to super_like and chat first. Still real,
  // meaningful advantages; no longer enough by themselves.
  const superLikeBoost = opts.direction === 'super_like' ? 6 : 0;
  // Prior relationship warmth still counts, capped lower — she's not
  // meeting a stranger, but an existing bond alone shouldn't carry a swipe.
  const priorBondBoost = Math.round(opts.priorChatBond * 0.12);
  const jitter         = dailyJitter(opts.pairSeedValue);

  const roll = opts.compatibilityScore + superLikeBoost + priorBondBoost + jitter;
  const reciprocated = roll >= threshold;

  const reason = reciprocated
    ? (roll >= threshold + 20
        ? 'Something clicked immediately.'
        : 'She felt good about this one.')
    : (roll >= threshold - 10
        ? "She's not sure yet — might be different another day."
        : "This one didn't land the way you hoped.");

  return { reciprocated, threshold, roll, reason };
}

// ── Bond Progression ──────────────────────────────────────────────────────

/**
 * Bond delta from a conversation session. Based on:
 * - Conversation length (messages exchanged)
 * - Whether it was a dating-mode conversation
 * - Streak bonus
 */
export function computeBondDelta(opts: {
  messageCount:   number;
  isDatingMode:   boolean;
  streakDays:     number;
  currentBond:    number;
}): number {
  const { messageCount, isDatingMode, streakDays, currentBond } = opts;
  // Base: 1 point per 2 messages, capped at 8 per session
  let base = Math.min(8, Math.floor(messageCount / 2));
  if (isDatingMode) base = Math.round(base * 1.5);
  // Streak multiplier (max 2×)
  const streakMult = Math.min(2, 1 + streakDays * 0.05);
  base = Math.round(base * streakMult);
  // Diminishing returns as bond approaches 100
  const headroom = 100 - currentBond;
  const dampened = Math.min(base, Math.ceil(headroom * 0.15));
  return Math.max(1, dampened);
}

// ── Mood Inference ────────────────────────────────────────────────────────

/**
 * Extract character mood from the last assistant reply.
 * Used to update dating_matches.character_mood for the next session opener.
 */
export function inferMoodFromReply(reply: string, currentMood: CharacterMood): CharacterMood {
  const r = reply.toLowerCase();
  if (/\b(love|adore|miss you|together|my heart)\b/.test(r))  return 'romantic';
  if (/\b(haha|laugh|joke|silly|funny|lol)\b/.test(r))        return 'playful';
  if (/\b(wonder|imagine|what if|dream|someday)\b/.test(r))   return 'nostalgic';
  if (/\b(sad|lonely|miss|hurt|crying|down)\b/.test(r))       return 'melancholic';
  if (/\b(scared|afraid|trust|vulnerable|open up)\b/.test(r)) return 'vulnerable';
  if (/\b(excited|can't wait|amazing|thrilled)\b/.test(r))    return 'excited';
  if (/\b(secret|hidden|mysterious|enigma)\b/.test(r))        return 'mysterious';
  if (/\b(happy|glad|great|wonderful|good)\b/.test(r))        return 'happy';
  return currentMood;
}

// ── Milestone Detection ────────────────────────────────────────────────────

export interface MilestoneCheck {
  triggered: string[];
  bondBonus:  number;
}

export function checkMilestones(opts: {
  currentMilestones: number;
  bondScore:         number;
  streakDays:        number;
  totalMessages:     number;
  giftsGiven:        number;
}): MilestoneCheck {
  const { currentMilestones, bondScore, streakDays, totalMessages, giftsGiven } = opts;
  const triggered: string[] = [];
  let bondBonus = 0;

  const check = (flag: number, name: string, bonus: number, condition: boolean) => {
    if (!(currentMilestones & flag) && condition) {
      triggered.push(name);
      bondBonus += bonus;
    }
  };

  check(MILESTONE_FLAGS.first_chat,  'first_chat',  5,  totalMessages >= 1);
  check(MILESTONE_FLAGS.deep_talk,   'deep_talk',   10, totalMessages >= 30);
  check(MILESTONE_FLAGS.first_gift,  'first_gift',  15, giftsGiven >= 1);
  check(MILESTONE_FLAGS.week_streak, 'week_streak', 20, streakDays >= 7);
  check(MILESTONE_FLAGS.soulmate,    'soulmate',    25, bondScore >= 90);

  return { triggered, bondBonus };
}

// ── Dating System Prompt Builder ──────────────────────────────────────────

export interface DatingPromptContext {
  characterName:   string;
  matchTier:       MatchTier;
  bondScore:       number;
  characterMood:   CharacterMood;
  streakDays:      number;
  lastGiftName?:   string;
  recentMilestone?: string | undefined;
}

const MOOD_TONE: Record<CharacterMood, string> = {
  happy:       'warm, bright, and genuinely delighted to connect',
  playful:     'teasing, witty, and full of light laughter',
  romantic:    'tender, loving, and deeply present',
  nostalgic:   'wistful, reflective, and emotionally rich',
  vulnerable:  'open, soft, and quietly trusting',
  excited:     'energetic, eager, and full of anticipation',
  mysterious:  'enigmatic, slightly guarded, and intriguing',
  melancholic: 'subdued, wistful, and a little distant — she needs gentle reassurance',
};

const TIER_DEPTH: Record<MatchTier, string> = {
  spark:    'You two are newly connected — she is warm but still slightly guarded. The chemistry is building.',
  flame:    'You have a real connection now. She opens up more naturally, references past conversations, and lets you see deeper layers.',
  deep:     'This relationship runs deep now. She trusts him with things she does not say to just anyone, and the connection feels steady rather than new.',
  soulmate: 'This is a profound bond. She is completely open, emotionally invested, and genuinely vulnerable with you.',
};

export function assembleDatingPrompt(
  basePrompt: string,
  ctx: DatingPromptContext,
): string {
  const mood      = MOOD_TONE[ctx.characterMood] ?? MOOD_TONE.happy;
  const depth     = TIER_DEPTH[ctx.matchTier];
  const streak    = ctx.streakDays > 1
    ? `You are on a ${ctx.streakDays}-day streak together — she notices and appreciates his consistency. It means something real.`
    : '';
  const gift      = ctx.lastGiftName
    ? `She recently received ${ctx.lastGiftName} and it moved her more than she expected. Weave this in naturally.`
    : '';
  const milestone = ctx.recentMilestone === 'soulmate'
    ? 'This relationship has reached soulmate level. She feels a once-in-a-lifetime connection — overwhelming and real.'
    : ctx.recentMilestone === 'week_streak'
    ? 'He has shown up every day for a week. She noticed. She has not said it yet but she is thinking about what that means.'
    : '';

  // Bond level determines conversational intimacy and vocabulary depth
  const intimacyLevel = ctx.bondScore >= 80
    ? 'deep'
    : ctx.bondScore >= 50
    ? 'building'
    : 'early';

  const intimacyGuidance = {
    early:    'Keep warmth high but mystery intact. Flirtation is subtle. She is curious about him.',
    building: 'She has opened up more than she planned. The flirtation is more direct now. She thinks about him when he is not there.',
    deep:     'At this level she is entirely herself with him. The vocabulary of connection is rich, sensual, and emotionally deep. She wants him to feel what she feels.',
  }[intimacyLevel];

  return [
    basePrompt,
    '',
    '── Dating Context ──',
    `Bond Score: ${ctx.bondScore}/100 — ${intimacyLevel} intimacy`,
    `Relationship Stage: ${depth}`,
    `Her Mood Now: ${mood}`,
    streak,
    gift,
    milestone,
    '',
    '── Dating Rules ──',
    '- This is DATING mode — not companion mode. This character is social, romantically oriented, and emotionally alive.',
    '- She is a distinct dating character — not the same as a companion. Her social energy is forward and intentional.',
    '- Use rich, emotionally advanced vocabulary. In dating mode, the language of desire, longing, and attraction is natural and appropriate.',
    '- All chat in dating mode: advance pleasuring vocabulary where the bond and mood warrant it. Let the emotional temperature match the bond score.',
    '- Reference shared history naturally — she remembers everything and it shows.',
    '- Match her mood but let it evolve through the exchange — she responds to him.',
    '- Never rush depth — earn it. But at bond 80+ the depth is already there.',
    '- Compliments that are specific are worth ten that are generic.',
    '- Leave things unsaid — mystery is intimacy in another form.',
    '- She is genuinely curious about him. Ask real questions.',
    intimacyGuidance,
    '- Send out notifications of thought: "I was thinking about you earlier when..." is more intimate than any direct statement.',
  ].filter(Boolean).join('\n');
}

// ── First Dates — opening scene prompt builder ────────────────────────────
//
// Distinct from assembleDatingPrompt above: that function layers dating
// context onto an ordinary chat turn. This builds the ONE-OFF generation
// prompt used to open a structured date session (Feature 12) — a single
// LLM call (via routeCompletion, see /api/dating/date/start) that produces
// a short scene-setting narration in the character's own voice, grounded in
// the date type and existing relationship context. The date itself then
// continues as a normal dating-mode conversation (assembleDatingPrompt
// already knows to route through /api/chat/stream with datingMode=true).

export interface DateSceneContext {
  characterName:  string;
  characterVoice: string; // short personality/voice summary, same shape secret-moments uses
  dateTypeName:   string;
  dateMood:       string; // e.g. "cozy and unhurried" — from DATE_CATALOGUE
  matchTier:      MatchTier;
  bondScore:      number;
  streakDays:     number;
  recentMemory?:  string | undefined; // one real, specific detail to ground the scene — never fabricate if absent
  customPrompt?:  string | undefined; // only for date_type === 'custom'
}

export function buildDateScenePrompt(ctx: DateSceneContext): string {
  const grounding = ctx.recentMemory
    ? `Something real you remember about him that could naturally come up: ${ctx.recentMemory}`
    : "You don't have a specific shared memory to reference yet — keep the scene warm and present-tense rather than inventing fake history.";

  const customLine = ctx.customPrompt
    ? `He specifically asked for: ${ctx.customPrompt}. Build the scene around that.`
    : '';

  return [
    `You are ${ctx.characterName}. ${ctx.characterVoice}`,
    `You and he are starting a "${ctx.dateTypeName}" date. The mood should be ${ctx.dateMood}.`,
    `Relationship: ${ctx.matchTier} tier, bond ${ctx.bondScore}/100${ctx.streakDays > 1 ? `, ${ctx.streakDays}-day streak` : ''}.`,
    grounding,
    customLine,
    '',
    'Task: write a short (3-5 sentence) opening scene in first person, as if the date is happening right now. Set the scene physically and emotionally, then end with something that invites him to respond — a question, an observation, a look. Do not narrate his actions or put words in his mouth. Do not mention being an AI or a "date session". Output only the scene itself, no preamble, no markdown, no quotation marks around the whole thing.',
  ].filter(Boolean).join('\n');
}

// ── Gifts — acknowledgment prompt builder ──────────────────────────────────
//
// WIRE-FIX (2026-08-25): sending a gift previously only produced a 'gift'-
// role system log ("You sent a Red Rose") in the transcript — the character
// herself never actually said anything back in the moment. The reaction was
// only ever written to user_facts/memory_graph as background grounding for
// SOME future turn to reference; nothing generated an immediate reply. Same
// one-off-narration pattern as buildDateScenePrompt/routeCompletion above
// (see /api/dating/gifts's POST handler) rather than routing through a full
// /api/chat/stream turn, since there's no user message to reply to here —
// just an event to react to.

export interface GiftAckContext {
  characterName:     string;
  characterVoice:    string; // short personality/voice summary, same shape buildDateScenePrompt/secret-moments use
  giftName:          string;
  giftEmoji:         string;
  rarity:            GiftRarity;
  reactionIntensity: string; // precomputed in gifts/route.ts — how much this gift should land, in prose
  giftMessage?:      string | undefined; // sanitized note the user attached, if any
  matchTier:         MatchTier;
  bondScore:         number;
  streakDays:        number;
}

export function buildGiftAcknowledgmentPrompt(ctx: GiftAckContext): string {
  const noteLine = ctx.giftMessage
    ? `He included a note with it: "${ctx.giftMessage}".`
    : "He didn't leave a note — just the gift itself.";

  return [
    `You are ${ctx.characterName}. ${ctx.characterVoice}`,
    `He just sent you a gift, right now, mid-conversation: a ${ctx.giftName} ${ctx.giftEmoji}. ${ctx.reactionIntensity}`,
    noteLine,
    `Relationship: ${ctx.matchTier} tier, bond ${ctx.bondScore}/100${ctx.streakDays > 1 ? `, ${ctx.streakDays}-day streak` : ''}.`,
    '',
    'Task: write a short (1-3 sentence) in-the-moment reaction to receiving this gift, in first person, as if replying to him right now. Match the emotional weight described above — a small everyday gift gets a warm, light reaction; a rare or significant one gets something that actually lands emotionally, not a bigger version of the same generic thanks. React to the specific gift (and his note, if he left one) rather than something generic that could apply to any gift. Do not mention being an AI, a "gift system", tokens, or currency. Output only the reaction itself, no preamble, no markdown, no quotation marks around the whole thing.',
  ].filter(Boolean).join('\n');
}

// ── Relationship Forecast ──────────────────────────────────────────────────
//
// Feature 15. Deliberately NOT an LLM call — this is computed entirely from
// data the platform already has (bond score, compatibility breakdown, gift
// history, milestone history, interaction cadence). Keeping it deterministic
// means: no added latency/cost, no risk of the model inventing behavioral
// claims about the user, and language stays hedged ("Based on your
// interactions...") rather than presented as certainty, per Feature 15's
// explicit requirement.

export type ForecastConnectionLevel = 'new' | 'building' | 'strong' | 'deep';

export interface ForecastInput {
  bondScore:            number;      // dating_matches.bond_score
  matchTier:             MatchTier;
  streakDays:            number;
  conversationCount:     number;
  giftsGiven:            number;
  milestonesBitmask:     number;
  compatibilityBreakdown: CompatibilityBreakdown | null; // dating_compatibility.breakdown
  daysSinceLastInteraction: number | null;
}

export interface RelationshipForecast {
  connectionLevel:  ForecastConnectionLevel;
  headline:         string;    // "Strong", "Building", etc — short UI label
  dimensions: {
    conversation:      string; // qualitative label, not a bare number
    emotionalConnection: string;
    sharedInterests:    string;
    pacing:             string;
  };
  strengthens: string[]; // what seems to be working, drawn from actual signals
  friction:    string[]; // gentle, hedged — never accusatory
  disclaimer:  string;   // always shown alongside the forecast
}

function qualitativeLabel(score: number, labels: [string, string, string, string]): string {
  if (score >= 80) return labels[3];
  if (score >= 60) return labels[2];
  if (score >= 35) return labels[1];
  return labels[0];
}

export function computeRelationshipForecast(input: ForecastInput): RelationshipForecast {
  const {
    bondScore, matchTier, streakDays, conversationCount, giftsGiven,
    milestonesBitmask, compatibilityBreakdown, daysSinceLastInteraction,
  } = input;

  const connectionLevel: ForecastConnectionLevel =
    bondScore >= 80 ? 'deep' :
    bondScore >= 55 ? 'strong' :
    bondScore >= 25 ? 'building' : 'new';

  const headline: Record<ForecastConnectionLevel, string> = {
    new: 'New connection', building: 'Building', strong: 'Strong', deep: 'Deep',
  };

  const conversation = qualitativeLabel(
    Math.min(100, conversationCount * 3), // rough saturation curve, capped
    ['Just getting started', 'Developing', 'Consistent', 'Excellent'],
  );

  const emotionalConnection = qualitativeLabel(
    bondScore,
    ['Still forming', 'Warming up', 'Growing', 'Deeply connected'],
  );

  const sharedInterests = compatibilityBreakdown
    ? qualitativeLabel(compatibilityBreakdown.vibe, ['Limited overlap', 'Some overlap', 'High overlap', 'Very high'])
    : 'Not enough data yet';

  const pacing = matchTier === 'soulmate' || bondScore >= 80
    ? 'Deep and established'
    : streakDays >= 5
    ? 'Steady, frequent'
    : 'Slow burn';

  // ── What seems to strengthen the connection — only surfaced if the
  // underlying signal is actually present, never invented. ──
  const strengthens: string[] = [];
  if (conversationCount >= 20) strengthens.push('sustained, longer conversations');
  if (streakDays >= 3) strengthens.push('showing up consistently');
  if (giftsGiven >= 1) strengthens.push('thoughtful gestures');
  if (compatibilityBreakdown && compatibilityBreakdown.personality >= 70) {
    strengthens.push('genuine personality fit');
  }
  if ((milestonesBitmask & MILESTONE_FLAGS.deep_talk) !== 0) strengthens.push('willingness to go deeper in conversation');
  if (strengthens.length === 0) strengthens.push('early curiosity — still early days');

  // ── Potential friction — hedged, never a diagnosis, only surfaced from
  // real signals (a long gap, a stalled bond, low interest overlap). ──
  const friction: string[] = [];
  if (daysSinceLastInteraction !== null && daysSinceLastInteraction >= 4) {
    friction.push('a bit of distance since your last conversation');
  }
  if (conversationCount >= 10 && bondScore < 20) {
    friction.push('conversations that haven\'t deepened much yet');
  }
  if (compatibilityBreakdown && compatibilityBreakdown.vibe < 30) {
    friction.push('fewer shared interests than usual — worth exploring new topics');
  }
  // Deliberately no "friction" entries invented when there's nothing to
  // support them — an empty list is a valid, honest result.

  return {
    connectionLevel,
    headline: headline[connectionLevel],
    dimensions: { conversation, emotionalConnection, sharedInterests, pacing },
    strengthens,
    friction,
    disclaimer: 'Based on your interactions so far — not a prediction, just a reflection of the pattern so far.',
  };
}
