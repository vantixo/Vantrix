/**
 * Recommendation Engine — Vantrix Silicon Valley
 *
 * Hybrid scoring combining:
 *   1. Collaborative filtering   (30%) — characters liked by users with similar taste
 *   2. Content-based filtering   (30%) — tag/personality overlap with the user's liked chars
 *   3. Popularity signal         (15%) — global like-rate (dampened to avoid winner-take-all)
 *   4. Recency boost             (10%) — new characters get a discovery window
 *   5. Bond affinity             (10%) — chars similar to ones the user actively dates
 *   6. Mood match                (5%, only when a mood is supplied) — the user's
 *      self-reported *current* mood, distinct from a character's own
 *      character_mood in dating_matches (see lib/dating/engine.ts). Maps
 *      the selected mood to the tags/archetypes that fit it and boosts
 *      characters carrying them.
 *
 * Scores are normalised to [0, 100] and returned ranked. Characters the user
 * has already swiped on are excluded. Premium characters are excluded for
 * free-tier users.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { redis }              from '@/lib/redis';
import { USER_MOODS, isUserMood, type UserMood } from './moods';

export { USER_MOODS, isUserMood, type UserMood };

const RECO_TTL = 60 * 10; // 10-minute cache per user

/**
 * Maps each user-facing mood (defined in ./moods, shared with the client
 * mood-picker UI) to the tags/archetypes most likely to fit it; characters
 * carrying them get a scoring boost.
 */
const MOOD_TAG_MAP: Record<UserMood, string[]> = {
  playful:       ['playful', 'funny', 'flirty', 'tease', 'archetype:tsundere', 'archetype:girl-next-door'],
  romantic:      ['romantic', 'affectionate', 'sweet', 'archetype:girlfriend', 'archetype:soulmate'],
  comforted:     ['caring', 'warm', 'gentle', 'supportive', 'archetype:caretaker', 'archetype:mom-friend'],
  adventurous:   ['adventurous', 'bold', 'spontaneous', 'archetype:adventurer', 'archetype:free-spirit'],
  intellectual:  ['intellectual', 'witty', 'deep', 'curious', 'archetype:mentor', 'archetype:nerd'],
  relaxed:       ['chill', 'calm', 'laid-back', 'cozy', 'archetype:best-friend'],
};

export interface RecommendedCharacter {
  id:               string;
  name:             string;
  age:              number;
  gender:           string;
  description:      string;
  image_url:        string;
  tags:             string[];
  is_premium:       boolean;
  min_tier?:        string;
  is_new:           boolean;
  tokens_cost:      number;
  archetype?:       string;
  opening_line?:    string;
  score:            number;
  reason:           string;  // human-readable "Why we think you'll like this"
  /** Feature 4 (Unexpected Chemistry) — how well this candidate matches the
   *  user's established liked-tag/archetype pattern, 0-100. Low patternScore
   *  + high overall score is exactly the "outside your obvious preference
   *  profile but still relevant" signal the spec asks for. This is the same
   *  contentScore() already computed for ranking — just also exposed here
   *  rather than discarded after the blend, so callers don't need to
   *  re-derive it. */
  patternScore:     number;
}

function recoKey(userId: string): string {
  return `vantrix:reco:${userId}`;
}

async function getLikedTags(userId: string): Promise<Map<string, number>> {
  const tagWeights = new Map<string, number>();
  const { data: swipes } = await supabaseAdmin
    .from('dating_swipes')
    .select('character_id, direction')
    .eq('user_id', userId)
    .in('direction', ['like', 'super_like']);

  if (!swipes?.length) return tagWeights;

  const charIds = swipes.map((s) => s.character_id as string);

  // Load tags for liked characters
  if (charIds.length > 0) {
    const { data: chars } = await supabaseAdmin
      .from('characters')
      .select('tags,archetype')
      .in('id', charIds);

    for (const c of (chars ?? []) as Array<{ tags: string[] | null; archetype: string | null }>) {
      const tags: string[] = c.tags ?? [];
      for (const t of tags) {
        tagWeights.set(t, (tagWeights.get(t) ?? 0) + 1);
      }
      if (c.archetype) {
        const key = `archetype:${c.archetype}`;
        tagWeights.set(key, (tagWeights.get(key) ?? 0) + 2);
      }
    }
  }
  return tagWeights;
}

/**
 * Chat-based affinity — what a user actually *talks to* a lot, distinct
 * from the swipe-based signal above (most users never touch dating swipes
 * at all; everyone chats). Backed by chat_affinity_tags() (see the
 * 20260914 migration) which does the message-counting in SQL rather than
 * pulling every message row into the app.
 *
 * Scaled to roughly the same magnitude as swipe-derived weights (small
 * integers) via per-user min-max normalization to 0–5, so neither signal
 * silently dominates the merge in getCombinedTagWeights just because its
 * raw units happen to be bigger.
 */
async function getChatAffinityTags(userId: string): Promise<Map<string, number>> {
  try {
    const { data, error } = await supabaseAdmin.rpc('chat_affinity_tags', { p_user_id: userId });
    if (error) throw error;
    if (!data?.length) return new Map();

    const rows = data;
    const max = Math.max(...rows.map((r) => Number(r.weight)));
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.tag, max > 0 ? (Number(row.weight) / max) * 5 : 0);
    }
    return map;
  } catch (err) {
    logger.warn('chat affinity lookup failed — falling back to swipe-only signal', { userId, error: String(err) });
    return new Map();
  }
}

function mergeTagWeights(...maps: Map<string, number>[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const m of maps) {
    for (const [k, v] of m) merged.set(k, (merged.get(k) ?? 0) + v);
  }
  return merged;
}

/**
 * Combined preference signal: explicit (swipes) + implicit/behavioral
 * (actual chat engagement). This is the single source of truth for "what
 * does this user seem to like" — used by both the dating-oriented
 * getRecommendations below and the Discover grid personalization in
 * scoreCandidatesForDiscover.
 */
export async function getCombinedTagWeights(userId: string): Promise<Map<string, number>> {
  const [swipeTags, chatTags] = await Promise.all([
    getLikedTags(userId),
    getChatAffinityTags(userId),
  ]);
  return mergeTagWeights(swipeTags, chatTags);
}


// ── Signal collectors ─────────────────────────────────────────────────────

async function getSwipedIds(userId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('dating_swipes')
    .select('character_id')
    .eq('user_id', userId);
  return new Set((data ?? []).map((s) => s.character_id as string));
}

async function getDatingMatchIds(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('dating_matches')
    .select('character_id')
    .eq('user_id', userId)
    .limit(20);
  return (data ?? []).map((m) => m.character_id as string);
}

// ── Scoring functions ─────────────────────────────────────────────────────

interface CharCandidate {
  id:            string;
  name:          string;
  age:           number;
  gender:        string;
  description:   string;
  image_url:     string;
  tags:          string[] | null;
  is_premium:    boolean;
  min_tier?:     string;
  is_new:        boolean;
  tokens_cost:   number;
  archetype:     string | null;
  opening_line:  string | null;
  created_at:    string;
  like_count:    number | null;
  follower_count: number | null;
  total_swipes:  number | null;
  dating_enabled: boolean;
  is_nsfw:        boolean | null;
}

function contentScore(char: CharCandidate, likedTags: Map<string, number>): number {
  const tags: string[] = char.tags ?? [];
  let score = 0;
  for (const t of tags) {
    score += (likedTags.get(t) ?? 0) * 10;
  }
  if (char.archetype) score += (likedTags.get(`archetype:${char.archetype}`) ?? 0) * 20;
  return Math.min(100, score);
}

// Follows are a stronger intent signal than likes (a follow is a standing
// subscription, a like is a single tap) so they're weighted higher here —
// both roll into the same 0-100 popularity score consumed by ranking.
function popularityScore(likeCount: number, totalSwipes: number, followerCount = 0): number {
  const engagementRate = totalSwipes > 0
    ? Math.min(100, Math.round((likeCount / Math.max(1, totalSwipes)) * 100))
    : 50;
  // Follower count has no natural denominator like swipes do, so it's
  // folded in as a log-scaled bonus (diminishing returns past the first
  // few dozen followers) rather than a raw ratio.
  const followerBonus = Math.min(30, Math.round(Math.log2(followerCount + 1) * 6));
  return Math.min(100, engagementRate + followerBonus);
}

function moodScore(char: CharCandidate, mood: UserMood | null): number {
  if (!mood) return 0;
  const wantedTags = MOOD_TAG_MAP[mood];
  const tags: string[] = char.tags ?? [];
  const archetypeTag = char.archetype ? `archetype:${char.archetype}` : null;
  const hit = wantedTags.some(t => tags.includes(t) || t === archetypeTag);
  return hit ? 100 : 0;
}

function recencyScore(createdAt: string): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / 86_400_000;
  if (ageDays < 3) return 100;
  if (ageDays < 7) return 75;
  if (ageDays < 14) return 50;
  if (ageDays < 30) return 25;
  return 0;
}

function buildReason(
  cs: number, ps: number, rs: number, isNew: boolean,
  likedTags: Map<string, number>, _char: CharCandidate,
  ms: number, mood: UserMood | null,
): string {
  if (ms > 0 && mood) return `Fits your ${mood} mood right now`;
  if (isNew && rs > 75) return "New character — be one of the first to meet her";
  if (cs > 60) {
    const topTag = [...likedTags.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topTag && !topTag.startsWith('archetype:')) return `Matches your interest in ${topTag}`;
  }
  if (ps > 70) return "Popular with people who share your taste";
  return "You might click";
}

export async function getRecommendations(
  userId: string,
  tier: import('@/lib/rate-limit').Tier,
  limit = 10,
  mood: UserMood | null = null,
  // NSFW-GATE-FIX (D-DISCOVER-02): this endpoint feeds the Discover "For You"
  // section directly and had the identical hole as /api/discover/featured —
  // it queried `active`/`dating_enabled` but never checked `is_public` or
  // `is_nsfw`, so unapproved characters and NSFW content could reach anyone,
  // including logged-out users (userId=''). Caller (the route) computes this
  // the same way /api/characters does, and passes the result in.
  allowNsfw = false,
  // GENDER-FILTER-FIX: this engine previously had no gender param at all —
  // every caller (dating deck, /api/recommendations) got the full mixed
  // catalog back and had to filter client-side (see discover-home.tsx's
  // now-removed post-filter) or, in the dating deck's case, didn't filter
  // at all, so male/female/anime characters could all surface in the same
  // deck regardless of what the page or the user actually wanted. Filtering
  // here means it happens once, server-side, before scoring/limit — a
  // gender-locked caller gets a correctly-sized result instead of `limit`
  // mixed candidates truncated down to a handful of the gender it wanted.
  genderFilter: 'male' | 'female' | 'non_binary' | null = null,
): Promise<RecommendedCharacter[]> {
  // Cache is keyed per mood, per NSFW-access tier, AND per gender filter —
  // a caller asking for one gender must never be served a cached list that
  // was built (or filtered) for a different gender or for "all".
  const cacheKey = `${recoKey(userId)}${mood ? `:${mood}` : ''}:${allowNsfw ? 'nsfw' : 'sfw'}${genderFilter ? `:${genderFilter}` : ''}`;

  // Check cache
  try {
    const cached = await redis.get<string>(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as RecommendedCharacter[];
      return parsed.slice(0, limit);
    }
  } catch { /* cache miss */ }

  try {
    const [likedTags, swipedIds, matchIds] = await Promise.all([
      getCombinedTagWeights(userId),
      getSwipedIds(userId),
      getDatingMatchIds(userId),
    ]);

    // Load candidate pool — exclude swiped chars
    let query = supabaseAdmin
      .from('characters')
      .select('id,name,age,gender,description,image_url,tags,is_premium,min_tier,is_new,tokens_cost,archetype,opening_line,created_at,like_count,follower_count,total_swipes,dating_enabled,is_nsfw')
      .eq('active', true)
      .eq('is_public', true)
      .eq('dating_enabled', true);

    if (!allowNsfw) {
      query = query.eq('is_nsfw', false);
    }

    if (genderFilter) {
      query = query.eq('gender', genderFilter);
    }

    if (tier === 'free') {
      query = query.eq('is_premium', false);
    }

    // Raised from 200 — "For You" is meant to cover the whole catalog now,
    // not a small sample of it, so the candidate pool needs enough headroom
    // to include effectively every eligible character before scoring/sort.
    const { data: candidates } = await query.limit(2000) as { data: CharCandidate[] | null };

    if (!candidates?.length) return [];

    // Score each candidate
    const scored = candidates
      .filter(c => !swipedIds.has(c.id))
      .map(c => {
        const cs  = contentScore(c, likedTags);
        const ps  = popularityScore(c.like_count ?? 0, c.total_swipes ?? 1, c.follower_count ?? 0);
        const rs  = recencyScore(c.created_at);
        const bs  = matchIds.includes(c.id) ? 80 : 0; // bond affinity for already-matched
        const ms  = moodScore(c, mood);

        // Bond affinity: chars with same archetype as current matches
        let bondAffinity = 0;
        if (matchIds.length && c.archetype) {
          const key = `archetype:${c.archetype}`;
          bondAffinity = likedTags.has(key) ? 60 : 0;
        }

        const final = (
          cs             * 0.30 +
          ps             * 0.15 +
          rs             * 0.10 +
          bondAffinity   * 0.10 +
          bs             * 0.10 +
          ms             * 0.05 +
          50             * 0.20  // base score — everyone gets a floor
        );

        return {
          id:            c.id,
          name:          c.name,
          age:           c.age,
          gender:        c.gender,
          description:   c.description,
          image_url:     c.image_url,
          tags:          c.tags ?? [],
          is_premium:    c.is_premium,
          min_tier:      c.min_tier,
          is_new:        c.is_new,
          tokens_cost:   c.tokens_cost,
          archetype:     c.archetype,
          opening_line:  c.opening_line,
          score:         Math.round(final),
          reason:        buildReason(cs, ps, rs, c.is_new, likedTags, c, ms, mood),
          patternScore:  Math.round(cs),
        };
      })
      .sort((a, b) => b.score - a.score)
      // "For You" is now meant to be the full character catalog, just
      // algorithmically ordered (most relevant first) rather than a small
      // curated strip — so this returns the whole scored/deduped candidate
      // pool instead of truncating to a fixed 30.
      ;

    // Cache for 10 minutes
    try {
      await redis.set(cacheKey, JSON.stringify(scored), { ex: RECO_TTL });
    } catch { /* non-critical */ }

    // `limit` is now just an upper cap (defaults far higher — see route),
    // not a curation cutoff: the ranking itself decides what's "most
    // relevant first", callers just bound how many they want returned.
    return (scored as unknown as RecommendedCharacter[]).slice(0, limit);

  } catch (err) {
    logger.error('Recommendation engine error', { userId, error: String(err) });
    return [];
  }
}

/**
 * Invalidate cache when user swipes (so next request reflects new data).
 *
 * SWIPE-CACHE-FIX: this previously deleted `recoKey(userId)` — but the
 * actual cache key written in getRecommendations() always carries a
 * `:sfw`/`:nsfw` suffix (and an optional `:${mood}` segment before it), so
 * the real key was e.g. `vantrix:reco:<id>:sfw` or
 * `vantrix:reco:<id>:playful:nsfw`, never the bare `vantrix:reco:<id>` this
 * deleted. The delete was a guaranteed no-op against every key that could
 * actually exist. On top of that, nothing in the app ever called this
 * function at all — POST /api/dating/swipe recorded the swipe but never
 * invalidated the deck cache. Combined effect: getRecommendations() (which
 * powers GET /api/dating/deck, the swipe deck's data source) stayed cached
 * for the full 10-minute RECO_TTL after every swipe, so reopening/
 * reloading the deck within that window kept re-serving the pre-swipe
 * list — including characters already swiped on. That's "swiping doesn't
 * work, the same character(s) stay put."
 *
 * Fix: enumerate every key variant that getRecommendations() can actually
 * write (each mood + no-mood, crossed with sfw/nsfw) and delete them all.
 * Small, fixed fan-out (currently 7 moods incl. none × 2 = 14 keys) — far
 * cheaper and safer in production than a KEYS/SCAN pattern delete, and
 * guaranteed to match the exact key-building logic above since it reuses
 * the same cacheKey format inline.
 */
export async function invalidateRecommendations(userId: string): Promise<void> {
  const moods: (UserMood | null)[] = [null, ...USER_MOODS];
  const nsfwVariants = [true, false];
  // Must enumerate every genderFilter variant too now that getRecommendations()
  // keys its cache by gender — otherwise a stale filtered list (e.g. the
  // dating deck's "female"-only cache) would survive a swipe/invalidation
  // that only cleared the unfiltered/'all' keys.
  const genderVariants: (('male' | 'female' | 'non_binary') | null)[] = [null, 'male', 'female', 'non_binary'];
  const keys = moods.flatMap(mood =>
    nsfwVariants.flatMap(allowNsfw =>
      genderVariants.map(gender =>
        `${recoKey(userId)}${mood ? `:${mood}` : ''}:${allowNsfw ? 'nsfw' : 'sfw'}${gender ? `:${gender}` : ''}`
      )
    )
  );
  try { await Promise.all(keys.map(k => redis.del(k))); } catch { /* non-critical */ }
}

// ── Discover grid personalization ─────────────────────────────────────────
//
// Separate from getRecommendations above (which powers a dedicated "For
// You" rail and expects dating_matches/swipe context). This scores whatever
// candidate pool the Discover grid route already queried — same tag/
// archetype content-matching approach, but pool-relative popularity (no
// total_swipes column needed) and a deliberate exploration slice.
//
// EXPLORATION IS NOT OPTIONAL POLISH — it is the difference between "shows
// you more of what keeps you scrolling" and "shows you what you actually
// like." A pure content-affinity ranking converges on a filter bubble: once
// someone has chatted with three characters carrying the same three tags,
// pure affinity-sorting would show them nothing else, ever. A fixed slice
// of every page is reserved for characters sharing NONE of the user's
// engaged tags, chosen by pool-relative popularity/recency rather than
// randomly, so it's "well-liked things you haven't tried" rather than
// noise. This is picked deterministically per user+day (not re-randomized
// every request) so the feed doesn't visibly reshuffle on every refresh.
export interface DiscoverCandidate {
  id: string;
  tags: string[] | null;
  archetype: string | null;
  like_count: number | null;
  follower_count?: number | null;
  created_at: string;
  [key: string]: unknown; // route-specific fields (name, image_url, etc.) pass through untouched
}

export interface ScoredDiscoverCandidate<T extends DiscoverCandidate> {
  item: T;
  score: number;
  isExploration: boolean;
}

function poolRelativePopularity(likeCount: number, maxLikeCount: number, followerCount = 0, maxFollowerCount = 0): number {
  const likeComponent     = maxLikeCount > 0     ? (likeCount / maxLikeCount) * 100         : 50;
  const followerComponent = maxFollowerCount > 0 ? (followerCount / maxFollowerCount) * 100 : 50;
  // Follows count for more of the blended score (60/40) since they're a
  // standing signal rather than a one-off tap — same weighting rationale
  // as the swipe-relative popularityScore() above.
  return Math.min(100, Math.round(likeComponent * 0.4 + followerComponent * 0.6));
}

/** Small deterministic hash so exploration picks are stable per user+day, not re-shuffled every request. */
function stableSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Score and reorder a candidate pool for the Discover grid.
 *
 * `tagWeights` — from getCombinedTagWeights(userId); pass an empty Map for
 * logged-out users, which yields pure popularity+recency ordering (no
 * personalization possible without any signal — same as today's behavior).
 *
 * `explorationRatio` — fraction of the returned list reserved for
 * novel-tag picks (default 15%). Set to 0 only for contexts where that
 * would be actively wrong (e.g. a "more like this" rail), never to
 * squeeze out marginally more affinity-matched content on the main grid.
 */
export function scoreCandidatesForDiscover<T extends DiscoverCandidate>(
  candidates: T[],
  tagWeights: Map<string, number>,
  opts: { userId: string; daySeed?: string; explorationRatio?: number } = { userId: 'anon' },
): T[] {
  if (candidates.length === 0) return [];

  const maxLikeCount     = Math.max(0, ...candidates.map((c) => c.like_count ?? 0));
  const maxFollowerCount = Math.max(0, ...candidates.map((c) => c.follower_count ?? 0));
  const explorationRatio = opts.explorationRatio ?? 0.15;
  const day = opts.daySeed ?? new Date().toISOString().slice(0, 10);

  const scored: ScoredDiscoverCandidate<T>[] = candidates.map((item) => {
    const cs = contentScore(
      { tags: item.tags, archetype: item.archetype } as unknown as CharCandidate,
      tagWeights,
    );
    const ps = poolRelativePopularity(item.like_count ?? 0, maxLikeCount, item.follower_count ?? 0, maxFollowerCount);
    const rs = recencyScore(item.created_at);
    const final = cs * 0.45 + ps * 0.20 + rs * 0.15 + 50 * 0.20; // 20% floor, same rationale as getRecommendations
    return { item, score: final, isExploration: cs === 0 };
  });

  scored.sort((a, b) => b.score - a.score);

  if (tagWeights.size === 0) {
    // No signal at all (logged-out, or brand-new user) — nothing to
    // "explore away from" yet. Plain popularity/recency order.
    return scored.map((s) => s.item);
  }

  const explorationCount = Math.max(1, Math.round(candidates.length * explorationRatio));
  const primary: T[] = [];
  const explorationPool: ScoredDiscoverCandidate<T>[] = [];

  for (const s of scored) {
    if (s.isExploration) explorationPool.push(s);
    else primary.push(s.item);
  }

  // Deterministic per user+day selection from the exploration pool (already
  // popularity/recency-sorted from the scoring pass above) rather than
  // always the single top novel item — otherwise every "different" slot
  // would show the same character to everyone, every day.
  const seed = stableSeed(`${opts.userId}:${day}`);
  const picked: T[] = [];
  const poolSize = explorationPool.length;
  for (let i = 0; i < Math.min(explorationCount, poolSize); i++) {
    const idx = (seed + i * 7) % poolSize;
    picked.push(explorationPool[idx].item);
  }

  // Interleave: one exploration pick roughly every ⌈primary/explorationCount⌉
  // positions, rather than all bunched at the top (which reads as "the
  // algorithm is confused") or all at the bottom (which nobody ever
  // scrolls to, defeating the point of including them at all).
  const result: T[] = [];
  const gap = picked.length > 0 ? Math.max(3, Math.floor(primary.length / picked.length)) : Infinity;
  let pickedIdx = 0;
  for (let i = 0; i < primary.length; i++) {
    result.push(primary[i]);
    if ((i + 1) % gap === 0 && pickedIdx < picked.length) {
      result.push(picked[pickedIdx++]);
    }
  }
  while (pickedIdx < picked.length) result.push(picked[pickedIdx++]);

  return result;
}
