/**
 * getMatchesForUser / getMatchIdForCharacter / getGiftCatalogueAndHistory /
 * getChemistryForMatch / getForecastForMatch / getCompatibilityForMatch /
 * getPrestigeForMatch / getActiveDateSessionForMatch
 *
 * ROOT-CAUSE FIX (2026-08-25): (app)/dating/match/[id]/page.tsx — and every
 * lib/frontend/dating.ts helper it calls (getDatingMatch, getGiftShop,
 * getChemistry, getForecast, getCompatibility, getPrestigeStatus,
 * getActiveDateSession) — used to read all of this data via fetchInternal(),
 * an HTTP self-fetch back to this same `next dev` process. That is the exact
 * self-fetch architecture get-world-home.ts's header comment already
 * diagnosed and fixed for the "Your World" page: next.config.js's
 * `experimental.cpus: 1` / `workerThreads: false` serializes the dev
 * compiler, so the outer page request and the inner self-fetch contend for
 * the same single worker and the self-fetch loses — surfacing here as the
 * match page's own `catch { return <UnavailableState message="This match
 * couldn't be loaded..." /> }` firing on effectively every visit, plus the
 * chemistry/forecast/compatibility/prestige/gift/date sections silently
 * disappearing (they already failed soft to null on the same self-fetch
 * error).
 *
 * Same fix as get-world-home.ts: the real logic that used to live inline in
 * each route handler now lives here. Each `app/api/dating/*` route below
 * still exists and still works for any client-side/external caller — it
 * just calls the shared function and wraps the result in NextResponse.json
 * (a thin wrapper, per FRONTEND_DIRECTIVE §10). (app)/dating/match/[id]/
 * page.tsx (via lib/frontend/dating.ts) now calls these directly, in-process
 * — no HTTP hop, no absoluteUrl(), no cookie forwarding, nothing that can
 * lose the single-worker race.
 *
 * Each function returns `null` for "not found / not this user's match" the
 * same way the old route handlers returned a 404 — callers treat null as
 * "omit this section" (matching every pre-existing fail-soft pattern in
 * lib/frontend/dating.ts) rather than throwing, so a match that genuinely
 * doesn't exist still degrades the same way it always did. A real query
 * failure (Supabase down, etc.) is left to throw, same as before — the
 * match page's own try/catch around getMatchesForUser is what turns that
 * into the "couldn't be loaded" message.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveNsfwDiscoveryAccess } from '@/lib/access/character-gate';
import { getPsychology } from '@/lib/ai/attachment-engine';
import { computeCompatibilityState } from '@/lib/ai/compatibility-engine';
import { computeChemistryDimensions } from '@/lib/ai/chemistry-dimensions';
import type { CharacterData } from '@/lib/ai/prompt';
import type { UserFact } from '@/lib/ai/user-fact-graph';
import { computeRelationshipForecast, type CompatibilityBreakdown, GIFT_CATALOGUE } from '@/lib/dating/engine';
import { PRESTIGE_CHAPTERS, getCurrentChapter } from '@/lib/dating/prestige-chapters';

// ── Matches list / single-match lookup (mirrors api/dating/matches) ───────

export interface MatchCharacter {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  description: string | null;
  image_url: string | null;
  tags: string[] | null;
  love_language: string | null;
  archetype: string | null;
  opening_line: string | null;
  is_nsfw: boolean | null;
}

export interface RawMatch {
  id: string;
  compatibility_pct: number | null;
  match_tier: string | null;
  bond_score: number;
  milestones: number | null;
  last_interaction: string | null;
  streak_days: number | null;
  character_mood: string | null;
  created_at: string;
  character: MatchCharacter | null;
}

interface MilestoneRow {
  match_id: string;
  milestone_type: string;
  created_at: string;
}

export async function getMatchesForUser(
  userId: string
): Promise<Array<RawMatch & { milestones_log: MilestoneRow[] }>> {
  const [matchesRes, nsfwEnabled] = await Promise.all([
    supabaseAdmin
      .from('dating_matches')
      .select(
        `
        id, compatibility_pct, match_tier, bond_score, milestones,
        last_interaction, streak_days, character_mood, created_at,
        character:characters!dating_matches_character_id_fkey (
          id, name, age, gender, description, image_url, tags,
          love_language, archetype, opening_line, is_nsfw
        )
      `
      )
      .eq('user_id', userId)
      .order('bond_score', { ascending: false })
      .returns<RawMatch[]>(),
    resolveNsfwDiscoveryAccess(userId),
  ]);

  const { data: rawMatches, error: matchErr } = matchesRes;
  if (matchErr) throw new Error(`getMatchesForUser: ${matchErr.message}`);

  const matches = (rawMatches ?? []).filter((m) => nsfwEnabled || m.character?.is_nsfw !== true);

  const matchIds = matches.map((m) => m.id);
  const { data: milestonesData } = matchIds.length
    ? await supabaseAdmin
        .from('dating_milestones')
        .select('match_id, milestone_type, created_at')
        .in('match_id', matchIds)
        .order('created_at', { ascending: false })
        .returns<MilestoneRow[]>()
    : { data: [] as MilestoneRow[] };

  const milestoneByMatch: Record<string, MilestoneRow[]> = {};
  for (const ms of milestonesData ?? []) {
    if (!milestoneByMatch[ms.match_id]) milestoneByMatch[ms.match_id] = [];
    milestoneByMatch[ms.match_id]!.push(ms);
  }

  return matches.map((m) => ({
    ...m,
    milestones_log: (milestoneByMatch[m.id] ?? []).slice(0, 3),
  }));
}

export async function getMatchIdForCharacter(
  userId: string,
  characterId: string
): Promise<string | null> {
  const { data: match } = await supabaseAdmin
    .from('dating_matches')
    .select('id')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .maybeSingle();
  return match?.id ?? null;
}

// ── Gift catalogue + history (mirrors GET api/dating/gifts) ───────────────

export interface GiftCatalogueItem {
  type: string;
  name: string;
  emoji: string;
  bond: number;
  tokens: number;
  tier: string;
  rarity: 'common' | 'special' | 'legendary';
}

export async function getGiftCatalogueAndHistory(
  userId: string,
  matchId: string
): Promise<{ catalogue: GiftCatalogueItem[]; history: unknown[] } | null> {
  const { data: match } = await supabaseAdmin
    .from('dating_matches')
    .select('id')
    .eq('id', matchId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!match) return null;

  const { data: gifts } = await supabaseAdmin
    .from('dating_gifts')
    .select('*')
    .eq('match_id', matchId)
    .order('created_at', { ascending: false });

  return { catalogue: GIFT_CATALOGUE as unknown as GiftCatalogueItem[], history: gifts ?? [] };
}

// ── Chemistry (mirrors GET api/dating/chemistry) ───────────────────────────

export async function getChemistryForMatch(userId: string, matchId: string) {
  const { data: match, error } = await supabaseAdmin
    .from('dating_matches')
    .select('character_id, bond_score, streak_days, conversation_count')
    .eq('id', matchId)
    .eq('user_id', userId)
    .single();
  if (error || !match) return null;

  const [{ data: character }, psychology, { data: facts }] = await Promise.all([
    supabaseAdmin
      .from('characters')
      .select('name, description, personality, backstory, tags, archetype, values_list')
      .eq('id', match.character_id)
      .single(),
    getPsychology(userId, match.character_id),
    supabaseAdmin
      .from('user_facts')
      .select('category, key, value')
      .eq('user_id', userId)
      .eq('character_id', match.character_id)
      .limit(50),
  ]);
  if (!character) return null;

  const factRows: UserFact[] = (facts ?? []).map((f, i) => ({
    id: String(i),
    category: f.category as UserFact['category'],
    key: f.key,
    value: f.value,
    confidence: 1,
    source: 'heuristic' as const,
    learnedAt: '',
    lastUsed: null,
  }));

  const compatibility = computeCompatibilityState(character as unknown as CharacterData, factRows);
  const tags: string[] = Array.isArray(character.tags) ? (character.tags as string[]) : [];

  return computeChemistryDimensions({
    psychology,
    compatibility,
    characterTags: tags,
    archetype: character.archetype ?? 'romantic',
    bondScore: match.bond_score ?? 0,
    conversationCount: match.conversation_count ?? 0,
    streakDays: match.streak_days ?? 0,
  });
}

// ── Forecast (mirrors GET api/dating/forecast) ──────────────────────────────

export async function getForecastForMatch(userId: string, matchId: string) {
  const { data: match } = await supabaseAdmin
    .from('dating_matches')
    .select(
      'id,user_id,character_id,bond_score,match_tier,streak_days,conversation_count,milestones,last_interaction'
    )
    .eq('id', matchId)
    .eq('user_id', userId)
    .single();
  if (!match) return null;

  const { count: giftsGiven } = await supabaseAdmin
    .from('dating_gifts')
    .select('*', { count: 'exact', head: true })
    .eq('match_id', matchId);

  const { data: compat } = await supabaseAdmin
    .from('dating_compatibility')
    .select('breakdown')
    .eq('user_id', userId)
    .eq('character_id', match.character_id)
    .maybeSingle();

  const daysSinceLastInteraction = match.last_interaction
    ? Math.floor((Date.now() - new Date(match.last_interaction).getTime()) / 86_400_000)
    : null;

  return computeRelationshipForecast({
    bondScore: match.bond_score,
    matchTier: (match.match_tier ?? 'spark') as 'spark' | 'flame' | 'soulmate',
    streakDays: match.streak_days,
    conversationCount: match.conversation_count ?? 0,
    giftsGiven: giftsGiven ?? 0,
    milestonesBitmask: match.milestones,
    compatibilityBreakdown: (compat?.breakdown as CompatibilityBreakdown | null) ?? null,
    daysSinceLastInteraction,
  });
}

// ── Compatibility (mirrors GET api/dating/compatibility) ──────────────────

const ARCHETYPE_TOPICS: Record<string, string[]> = {
  romantic: ['love', 'relationships', 'emotions', 'connection', 'family'],
  adventurous: ['travel', 'sports', 'outdoor', 'adventure', 'fitness'],
  mysterious: ['philosophy', 'books', 'mystery', 'psychology', 'art'],
  playful: ['games', 'humor', 'entertainment', 'music', 'social'],
  dominant: ['ambition', 'career', 'leadership', 'success', 'power'],
  intellectual: ['technology', 'science', 'history', 'learning', 'debate'],
};
const RECOMPUTE_HOURS = 24;
const RECOMPUTE_CONVOS = 10;

async function computeCompatibility(
  userId: string,
  characterId: string,
  archetype: string,
  baseScore: number
): Promise<{ score: number; factors: Record<string, number> }> {
  const [psychology, factsRes, convCountRes] = await Promise.all([
    getPsychology(userId, characterId),
    supabaseAdmin
      .from('user_facts')
      .select('category, key, value')
      .eq('user_id', userId)
      .eq('character_id', characterId)
      .limit(50),
    supabaseAdmin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('character_id', characterId),
  ]);

  const psychScore = Math.round(
    psychology.trust * 0.35 + psychology.affection * 0.4 + psychology.attachment * 0.25
  );

  const archetypeTopics = ARCHETYPE_TOPICS[archetype?.toLowerCase() ?? ''] ?? [];
  const userTopics = (factsRes.data ?? []).map((f) => f.value.toLowerCase());
  let topicOverlap = 0;
  if (archetypeTopics.length > 0 && userTopics.length > 0) {
    const matches = archetypeTopics.filter((t) => userTopics.some((u) => u.includes(t)));
    topicOverlap = Math.min(100, Math.round((matches.length / archetypeTopics.length) * 100));
  }

  const convCount = convCountRes.count ?? 0;
  const engagementScore = Math.min(100, convCount * 5);

  const dynamicScore = Math.round(
    psychScore * 0.45 + topicOverlap * 0.25 + engagementScore * 0.15 + baseScore * 0.15
  );

  return {
    score: Math.max(10, Math.min(99, dynamicScore)),
    factors: { psychology: psychScore, topicOverlap, engagement: engagementScore, base: baseScore },
  };
}

export async function getCompatibilityForMatch(userId: string, matchId: string) {
  const { data: match, error } = await supabaseAdmin
    .from('dating_matches')
    .select(
      'character_id, compatibility_score, conversation_count, last_compatibility_update, compatibility_update_convo_count'
    )
    .eq('id', matchId)
    .eq('user_id', userId)
    .single();
  if (error || !match) return null;

  const { data: matchCharacter } = await supabaseAdmin
    .from('characters')
    .select('archetype')
    .eq('id', match.character_id)
    .single();

  const convCount = match.conversation_count ?? 0;
  const lastUpdate = match.last_compatibility_update;
  const prevScore = match.compatibility_score ?? 50;
  const archetype = matchCharacter?.archetype ?? 'romantic';

  const hoursSinceUpdate = lastUpdate
    ? (Date.now() - new Date(lastUpdate).getTime()) / 3_600_000
    : Infinity;
  const convsSinceUpdate = convCount - (match.compatibility_update_convo_count ?? 0);
  const shouldRecompute =
    !lastUpdate || hoursSinceUpdate >= RECOMPUTE_HOURS || convsSinceUpdate >= RECOMPUTE_CONVOS;
  const nextRecomputeIn = Math.max(0, RECOMPUTE_CONVOS - convsSinceUpdate);

  let currentScore = prevScore;
  let factors: Record<string, number> = {};
  let delta = 0;

  if (shouldRecompute) {
    const computed = await computeCompatibility(userId, match.character_id, archetype, prevScore);
    currentScore = computed.score;
    factors = computed.factors;
    delta = currentScore - prevScore;

    await supabaseAdmin
      .from('dating_matches')
      .update({
        compatibility_score: currentScore,
        last_compatibility_update: new Date().toISOString(),
        compatibility_update_convo_count: convCount,
      })
      .eq('id', matchId);
  }

  return {
    score: currentScore,
    previousScore: prevScore,
    delta,
    recomputed: shouldRecompute,
    factors: shouldRecompute ? factors : null,
    nextRecomputeIn,
    message:
      delta > 0
        ? `Your compatibility with her has grown from ${prevScore}% to ${currentScore}%`
        : delta < 0
          ? `Your compatibility dipped from ${prevScore}% to ${currentScore}%`
          : null,
  };
}

// ── Prestige (mirrors GET api/dating/prestige) ─────────────────────────────

export async function getPrestigeForMatch(userId: string, matchId: string) {
  const { data: match, error } = await supabaseAdmin
    .from('dating_matches')
    .select('bond_score, match_tier, chapter_number, chapter_beat, chapter_started_at')
    .eq('id', matchId)
    .eq('user_id', userId)
    .single();
  if (error || !match) return null;

  const isSoulmate = match.match_tier === 'soulmate';
  const inPrestige = isSoulmate && match.bond_score >= 100;
  const chapterNum = match.chapter_number ?? null;
  const { chapter, currentBeat, beatIndex } = getCurrentChapter(chapterNum, match.chapter_beat ?? 0);
  const nextChapter = chapterNum
    ? (PRESTIGE_CHAPTERS.find((c) => c.number === chapterNum + 1) ?? null)
    : (PRESTIGE_CHAPTERS[0] ?? null);

  return {
    inPrestige,
    isSoulmate,
    chapter: chapter
      ? {
          id: chapter.id,
          number: chapter.number,
          title: chapter.title,
          theme: chapter.theme,
          description: chapter.description,
          duration: chapter.duration,
          totalBeats: chapter.beats.length,
        }
      : null,
    currentBeat: currentBeat ? { id: currentBeat.id, day: currentBeat.day, title: currentBeat.title, description: currentBeat.description, beatIndex } : null,
    nextChapter: nextChapter ? { number: nextChapter.number, title: nextChapter.title, theme: nextChapter.theme } : null,
    unlocksAt: inPrestige ? null : { tier: 'soulmate', bond: 100 },
  };
}

// ── Active date session (mirrors GET api/dating/date/active) ──────────────

export async function getActiveDateSessionForMatch(userId: string, matchId: string) {
  const { data: session, error } = await supabaseAdmin
    .from('date_sessions')
    .select('id,date_type,opening_scene,status,created_at')
    .eq('match_id', matchId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`getActiveDateSessionForMatch: ${error.message}`);
  return session ?? null;
}
