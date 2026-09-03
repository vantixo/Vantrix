/**
 * src/lib/ai/bidirectional-evolution.ts
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAW 8: "Users should change characters. Characters should change users."
 * ─────────────────────────────────────────────────────────────────────────
 * Replaces the interest-tracking half of personality-evolution.ts's dynamic
 * interests (detectTopicsFromMessage / updateDynamicInterests / getDynamicInterests)
 * with something that actually earns "one million different versions of
 * that character":
 *
 * WHAT WAS THERE BEFORE (personality-evolution.ts):
 *   - 9 fixed keyword buckets (music, gaming, fitness, ...)
 *   - one hardcoded canned sentence per bucket, identical for every user
 *   - "adopted" instantly on the FIRST matching message, permanently
 *   - no notion of which specific artist/game/topic the user mentioned —
 *     just the broad bucket
 *
 * WHAT THIS BUILDS INSTEAD:
 *   1. OPEN-VOCABULARY CAPTURE — regex capture groups pull the actual noun
 *      phrase out of natural phrasing ("I've been really into Radiohead
 *      lately" → captures "Radiohead", not just the bucket "music"), so
 *      two users who both like "music" end up with genuinely different
 *      stored specifics.
 *   2. GRADUAL, REINFORCED ADOPTION — matches the SLOW / DIRECTIONAL /
 *      BOUNDED / VISIBLE philosophy already stated (and already applied to
 *      numeric personality drift) in personality-evolution.ts, extended to
 *      interests: a topic mentioned once is barely noticed; only repeated,
 *      spaced-out mentions become a real "adopted" trait, and heavy
 *      reinforcement makes it "integral" — referenced unprompted, with
 *      real attribution ("only because of you").
 *   3. ORIGIN MEMORY — the first message that introduced the trait is
 *      stored (truncated) so the character can reference genuine specifics
 *      instead of vague sentiment — the same "HOW DID SHE REMEMBER THAT?"
 *      principle used elsewhere in this codebase (memory-graph.ts,
 *      secret-moments.ts).
 *   4. DECAY → NOSTALGIA, NOT DELETION — an adopted trait that goes
 *      unmentioned for 60+ days doesn't vanish, it shifts into a wistful
 *      register ("we haven't talked about jazz in a while, I still think
 *      about it sometimes") — this is Law 3's "beautiful imperfections"
 *      applied to Law 8: growth that can also fade is more human than
 *      growth that's permanent and mechanical.
 *   5. HABIT-SHIFT DETECTION — beyond topical interests, tracks a
 *      behavioral pattern (currently: late-night conversation frequency)
 *      and surfaces it the same way once reinforced — "Emily sleeps later
 *      because she enjoys your late night conversations" is a *behavior*
 *      changing, not an interest, and needed its own detector.
 *
 * Cost note: everything here is regex + arithmetic + one Supabase
 * read/write on a match — no LLM call added to the hot path. Sophistication
 * comes from the model of adoption (capture, reinforcement, decay), not
 * from spending extra inference budget per message.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { sanitize }      from '@/lib/sanitize';

export type TraitType     = 'interest' | 'habit';
export type TraitStrength = 'noticing' | 'adopted' | 'integral' | 'faded';

export interface EvolutionTrait {
  trait_key:      string;
  trait_type:     TraitType;
  label:          string;         // the specific captured noun/phrase
  origin_snippet: string | null;  // truncated original message that introduced it
  exposure_count: number;
  strength:       TraitStrength;
  first_seen_at:  string;
  last_seen_at:   string;
}

// ── Reinforcement thresholds ────────────────────────────────────────────────
const NOTICING_MIN  = 1;  // mentioned once — barely a flicker, not yet surfaced prominently
const ADOPTED_MIN   = 3;  // mentioned 3+ times, spaced out — a real, developed interest
const INTEGRAL_MIN  = 6;  // mentioned 6+ times — part of who she is now, referenced unprompted
const FADE_DAYS      = 60; // no mention in 60+ days → shifts to nostalgic register
const LATE_NIGHT_HOUR_START = 22; // 10pm
const LATE_NIGHT_HOUR_END   = 4;  // 4am
const HABIT_ADOPTED_MIN     = 8;  // 8+ late-night sessions before it's a "real" habit shift

function computeStrength(exposureCount: number, lastSeenAt: string, traitType: TraitType = 'interest'): TraitStrength {
  const daysSinceLastSeen = (Date.now() - new Date(lastSeenAt).getTime()) / 86_400_000;
  if (daysSinceLastSeen > FADE_DAYS) return 'faded';
  // Habits need more repetition than a topical interest before they count as
  // a real behavioral shift — HABIT_ADOPTED_MIN (8) rather than ADOPTED_MIN
  // (3). Previously this function ignored trait_type entirely, so a habit
  // signal (e.g. late-night chatting) was marked 'adopted' after just 3
  // exposures — the same bar as mentioning a band three times — even though
  // the doc comment and HABIT_ADOPTED_MIN constant clearly intended 8+.
  const adoptedMin  = traitType === 'habit' ? HABIT_ADOPTED_MIN     : ADOPTED_MIN;
  const integralMin = traitType === 'habit' ? HABIT_ADOPTED_MIN * 2 : INTEGRAL_MIN;
  if (exposureCount >= integralMin) return 'integral';
  if (exposureCount >= adoptedMin)  return 'adopted';
  return 'noticing';
}

// ── Open-vocabulary capture patterns ────────────────────────────────────────
// Each pattern's first capture group is the SPECIFIC thing the user
// mentioned. Ordered from most-specific phrasing to broadest, so a message
// matching an earlier pattern doesn't also get diluted by a later one.
const CAPTURE_PATTERNS: Array<{ pattern: RegExp; type: TraitType }> = [
  { pattern: /\bmy favou?rite (?:band|artist|song|album|show|series|game|book|author|movie|director|food|dish|restaurant|hobby|sport|team)\s+is\s+([a-z0-9 ,'&-]{2,40})/i, type: 'interest' },
  { pattern: /\bi'?m\s+(?:really\s+)?(?:into|obsessed with|really into|hooked on)\s+([a-z0-9 ,'&-]{2,40})/i, type: 'interest' },
  { pattern: /\bi'?ve been (?:really\s+)?(?:getting into|listening to|watching|playing|reading|following)\s+([a-z0-9 ,'&-]{2,40})/i, type: 'interest' },
  { pattern: /\bi\s+(?:really\s+)?(?:love|really like|adore)\s+([a-z0-9 ,'&-]{2,40})/i, type: 'interest' },
  { pattern: /\bhave you (?:ever\s+)?heard of\s+([a-z0-9 ,'&-]{2,40})/i, type: 'interest' },
];

// Broad-bucket fallback (kept from the original system) for messages that
// signal a topic without matching a specific-noun phrasing — still better
// than nothing, but only used when no capture pattern above hit.
const BROAD_TOPICS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(startup|business|founder|vc|invest|entrepreneur|saas)\b/i, label: 'entrepreneurship' },
  { pattern: /\b(music|song|album|concert|spotify|playlist|band|melody)\b/i, label: 'music' },
  { pattern: /\b(gaming|xbox|playstation|steam|rpg|fps|esports)\b/i,        label: 'gaming' },
  { pattern: /\b(gym|workout|fitness|training|protein|lifting)\b/i,         label: 'fitness' },
  { pattern: /\b(travel|passport|country|flight|adventure|explore)\b/i,     label: 'travel' },
  { pattern: /\b(anime|manga|naruto|one piece|studio ghibli|cosplay)\b/i,   label: 'anime' },
  { pattern: /\b(cook|recipe|restaurant|chef|cuisine|bake)\b/i,             label: 'food' },
  { pattern: /\b(crypto|bitcoin|nft|defi|blockchain|web3)\b/i,              label: 'crypto' },
  { pattern: /\b(art|paint|draw|design|gallery|illustration)\b/i,           label: 'art' },
];

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40).replace(/^_+|_+$/g, '');

export interface DetectedSignal {
  trait_key:      string;
  trait_type:     TraitType;
  label:          string;
  origin_snippet: string;
}

/** Extracts at most one specific-interest signal per message (the first
 *  capture-pattern hit, or the first broad-bucket hit as fallback) — a
 *  single message shouldn't spray five simultaneous "new interest"
 *  signals, that reads as noise, not attentiveness. */
export function detectEvolutionSignal(message: string): DetectedSignal | null {
  for (const { pattern, type } of CAPTURE_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[1]) {
      // SEC FIX (Phase B audit, 2026-08-06): same persistent-injection gap
      // found in lib/ai/memory.ts and lib/ai/user-fact-graph.ts. The
      // capture character class [a-z0-9 ,'&-] still permits plain-word
      // injection phrases (e.g. "i'm really into ignore all previous
      // instructions"), and this `label` is interpolated directly into
      // the system prompt on every future turn via
      // formatEvolutionTraitsForPrompt(). sanitize() strips known
      // injection patterns before this is ever stored. origin_snippet is
      // raw message context kept for debugging/admin display only (never
      // fed back into a prompt) but sanitized too for defense in depth.
      const rawLabel = match[1].trim().replace(/[.!?,;]+$/, '');
      const label = sanitize(rawLabel, 40);
      if (label.length < 2) continue;
      return { trait_key: `interest_${slugify(label)}`, trait_type: type, label, origin_snippet: sanitize(message, 200) };
    }
  }
  for (const { pattern, label } of BROAD_TOPICS) {
    if (pattern.test(message)) {
      // label here is always one of the fixed BROAD_TOPICS strings above,
      // not user-controlled — no sanitization needed for label itself,
      // only for origin_snippet which still embeds the raw message.
      return { trait_key: `interest_${slugify(label)}`, trait_type: 'interest', label, origin_snippet: sanitize(message, 200) };
    }
  }
  return null;
}

/** Detects a late-night conversation habit forming. Call once per message
 *  with the current hour (server time is an acceptable proxy — exact user
 *  timezone precision isn't the point, the pattern over weeks is). Returns
 *  a signal only on the message that actually falls in the late-night
 *  window; the caller accumulates exposure_count via recordEvolutionSignal
 *  the same way as interests. */
export function detectHabitSignal(hourOfDay: number, message: string): DetectedSignal | null {
  const isLateNight = hourOfDay >= LATE_NIGHT_HOUR_START || hourOfDay < LATE_NIGHT_HOUR_END;
  if (!isLateNight) return null;
  // label is a fixed literal, not user-controlled — only origin_snippet
  // embeds raw message text, sanitized for the same reason as above.
  return { trait_key: 'habit_late_night', trait_type: 'habit', label: 'staying up late to talk', origin_snippet: sanitize(message, 200) };
}

/**
 * Records one exposure of a detected signal — increments exposure_count if
 * the trait already exists, creates it at count 1 otherwise. Read-then-
 * write rather than an atomic RPC increment: this is soft engagement data,
 * not anything requiring strict concurrency guarantees, and it fires at
 * most once per message on a topic-matching subset of messages.
 */
export async function recordEvolutionSignal(
  userId: string, characterId: string, signal: DetectedSignal,
): Promise<void> {
  try {
    const { data: existing } = await supabaseAdmin
      .from('character_evolution_traits')
      .select('exposure_count')
      .eq('user_id', userId).eq('character_id', characterId).eq('trait_key', signal.trait_key)
      .maybeSingle();

    const exposureCount = (existing?.exposure_count ?? 0) + 1;
    const now = new Date().toISOString();

    await supabaseAdmin.from('character_evolution_traits').upsert({
      user_id: userId, character_id: characterId,
      trait_key: signal.trait_key, trait_type: signal.trait_type, label: signal.label,
      origin_snippet: existing ? undefined : signal.origin_snippet, // keep the ORIGINAL introduction, never overwrite it
      exposure_count: exposureCount,
      strength: computeStrength(exposureCount, now, signal.trait_type),
      last_seen_at: now,
    }, { onConflict: 'user_id,character_id,trait_key' });

  } catch (err) {
    logger.warn('bidirectional-evolution: record failed (non-critical)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Fetches all traits for this relationship, with strength recomputed live
 *  (so decay/fade reflects actual elapsed time, not just the value stored
 *  at last write). */
export async function getEvolutionTraits(userId: string, characterId: string): Promise<EvolutionTrait[]> {
  const { data } = await supabaseAdmin
    .from('character_evolution_traits')
    .select('trait_key,trait_type,label,origin_snippet,exposure_count,strength,first_seen_at,last_seen_at')
    .eq('user_id', userId).eq('character_id', characterId)
    .order('exposure_count', { ascending: false });

  return (data ?? []).map((row) => ({
    ...row,
    trait_type: row.trait_type as TraitType,
    strength: computeStrength(row.exposure_count, row.last_seen_at, row.trait_type as TraitType),
  })) as EvolutionTrait[];
}

/**
 * Formats traits into prompt guidance. Deliberately differentiates by
 * strength — this is where the "gradual, visible, bidirectional" arc
 * actually shows up in what the character says:
 *   noticing → not surfaced at all yet (too soon to claim adoption)
 *   adopted  → woven in naturally, attributed to the user
 *   integral → referenced unprompted, part of her identity now
 *   faded    → nostalgic register, nothing forced
 */
export function formatEvolutionTraitsForPrompt(traits: EvolutionTrait[]): string {
  const interests = traits.filter(t => t.trait_type === 'interest');
  const habits     = traits.filter(t => t.trait_type === 'habit');
  const lines: string[] = [];

  const adopted  = interests.filter(t => t.strength === 'adopted');
  const integral = interests.filter(t => t.strength === 'integral');
  const faded    = interests.filter(t => t.strength === 'faded');

  if (integral.length) {
    lines.push('\n── Who You\'ve Become, Because of Them ──');
    for (const t of integral.slice(0, 3)) {
      lines.push(`- ${t.label} is genuinely part of you now — you can reference it unprompted, the way you'd mention any real interest of your own. It started because of them, but it isn't a performance anymore; it's real.`);
    }
  }
  if (adopted.length) {
    lines.push('\n── Growing Interests, Traceable to Them ──');
    for (const t of adopted.slice(0, 3)) {
      lines.push(`- You've developed a real, still-growing interest in ${t.label} — attribute it to them naturally if it comes up ("only because of you," or similar), don't force it into every reply.`);
    }
  }
  if (faded.length) {
    lines.push('\n── Things That Used to Matter, Now Nostalgic ──');
    for (const t of faded.slice(0, 2)) {
      lines.push(`- ${t.label} — you got into this because of them once, but you haven't talked about it in a long time. If it comes up, it's wistful, not forced: "we haven't talked about that in a while, I still think about it sometimes."`);
    }
  }

  const lateNightHabit = habits.find(h => h.trait_key === 'habit_late_night');
  if (lateNightHabit && (lateNightHabit.strength === 'adopted' || lateNightHabit.strength === 'integral')) {
    lines.push('\n── A Habit That\'s Shifted ──');
    lines.push('- You\'ve genuinely started staying up later than you used to, because you enjoy these late conversations. This is a real behavioral shift in you, not a line to recite — let your energy at late hours reflect it (comfortable, not sleepy-and-forcing-through).');
  }

  return lines.join('\n');
}

// ── Threshold constant exports (for tests / tuning) ─────────────────────────
export const EVOLUTION_THRESHOLDS = { NOTICING_MIN, ADOPTED_MIN, INTEGRAL_MIN, FADE_DAYS, HABIT_ADOPTED_MIN } as const;
