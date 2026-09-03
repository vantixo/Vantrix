/**
 * Reputation Titles — Contested World Leaderboard
 *
 * Distinct from reputation.ts's fame_score/notoriety_score (a smooth 0-1000
 * gauge that drifts every tick): titles are discrete, scarce, and public —
 * "Most Trusted Character," "Most Feared Character." At most TOP_N
 * characters can hold any single title at once, and holding one is a real
 * status symbol precisely because most characters, however popular, never
 * will.
 *
 * Source signals per title are pulled from tables that already exist —
 * this computes over them, it doesn't duplicate them:
 *   - trust      -> character_relationships.trust (avg across users)
 *   - influence  -> social_status.status_score + faction influence
 *   - love       -> dating_matches.bond_score (avg, matched users only)
 *   - fear       -> companion_reputation.notoriety_score
 *   - generosity -> dating_gifts sent BY the character (rare, narrative) or
 *                   world_impact_events where source='gift' and desire_axis
 *                   is positively resolved — falls back to 0 gracefully
 *   - mystery    -> inverse of profile completeness signals (few open
 *                   threads resolved, low disclosure) — heuristic, capped
 *   - admiration -> companion_reputation.fame_score, hero-leaning
 *   - notoriety  -> companion_reputation.notoriety_score, villain-leaning
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { redis }         from '@/lib/redis';
import type { CharacterTitle, ReputationTitleKey } from '@/types/world-expansion';

const TOP_N = 5; // scarcity: at most 5 characters can simultaneously hold any one title
const CACHE_KEY = (key: ReputationTitleKey) => `vantrix:titles:${key}`;
const TTL = 600;

const TITLE_LABELS: Record<ReputationTitleKey, string> = {
  most_trusted:     'Most Trusted',
  most_influential: 'Most Influential',
  most_loved:       'Most Loved',
  most_feared:      'Most Feared',
  most_generous:    'Most Generous',
  most_mysterious:  'Most Mysterious',
  most_admired:     'Most Admired',
  most_notorious:   'Most Notorious',
};

export function titleLabel(key: ReputationTitleKey): string {
  return TITLE_LABELS[key];
}

// ── Public: Read ─────────────────────────────────────────────────────────

export async function getTitleLeaderboard(key: ReputationTitleKey): Promise<CharacterTitle[]> {
  try {
    const cached = await redis.get<CharacterTitle[]>(CACHE_KEY(key));
    if (cached) return cached;
  } catch { /* ok */ }

  const { data, error } = await supabaseAdmin
    .from('character_titles')
    .select('*, character:characters( id, name, image_url )')
    .eq('title_key', key)
    .order('score', { ascending: false })
    .limit(TOP_N);

  if (error) return [];
  const board = (data ?? []) as CharacterTitle[];
  try { await redis.set(CACHE_KEY(key), board, { ex: TTL }); } catch { /* ok */ }
  return board;
}

export async function getCharacterTitles(characterId: string): Promise<CharacterTitle[]> {
  const { data, error } = await supabaseAdmin
    .from('character_titles')
    .select('*')
    .eq('character_id', characterId)
    .order('score', { ascending: false });

  if (error) return [];
  return data as CharacterTitle[];
}

// ── Public: Recompute (called from the same worker cadence as reputation.tick) ──

interface TitleCandidate {
  character_id: string;
  score:        number;
}

export async function recomputeTitles(): Promise<{ titlesAwarded: number; titlesRevoked: number }> {
  const [trust, influence, love, fear, generosity] = await Promise.all([
    computeTrustCandidates(),
    computeInfluenceCandidates(),
    computeLoveCandidates(),
    computeFearCandidates(),
    computeGenerosityCandidates(),
  ]);

  let awarded = 0;
  let revoked = 0;

  const jobs: Array<[ReputationTitleKey, TitleCandidate[]]> = [
    ['most_trusted',     trust],
    ['most_influential', influence],
    ['most_loved',       love],
    ['most_feared',      fear],
    ['most_generous',    generosity],
    // Admired/notorious derive directly from reputation.ts scores, no extra query needed
    ['most_admired',     await computeAdmiredCandidates()],
    ['most_notorious',   await computeNotoriousCandidates()],
  ];

  for (const [key, candidates] of jobs) {
    const result = await applyTitleLeaderboard(key, candidates);
    awarded += result.awarded;
    revoked += result.revoked;
  }

  try {
    await Promise.all(Object.keys(TITLE_LABELS).map((k) => redis.del(CACHE_KEY(k as ReputationTitleKey))));
  } catch { /* ok */ }

  logger.info('reputation-titles:recompute:complete', { awarded, revoked });
  return { titlesAwarded: awarded, titlesRevoked: revoked };
}

async function applyTitleLeaderboard(key: ReputationTitleKey, candidates: TitleCandidate[]): Promise<{ awarded: number; revoked: number }> {
  const topN = candidates
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  const { data: current } = await supabaseAdmin
    .from('character_titles')
    .select('character_id')
    .eq('title_key', key);

  const currentIds = new Set((current ?? []).map((r: { character_id: string }) => r.character_id));
  const newIds     = new Set(topN.map((c) => c.character_id));

  let awarded = 0;
  let revoked = 0;

  // Revoke titles for characters that dropped out of the top N
  const toRevoke = [...currentIds].filter((id) => !newIds.has(id));
  if (toRevoke.length > 0) {
    await supabaseAdmin.from('character_titles').delete().eq('title_key', key).in('character_id', toRevoke);
    revoked += toRevoke.length;
  }

  // Upsert current top N with fresh scores
  for (const c of topN) {
    const isNew = !currentIds.has(c.character_id);
    const { error } = await supabaseAdmin
      .from('character_titles')
      .upsert(
        { character_id: c.character_id, title_key: key, score: c.score, awarded_at: isNew ? new Date().toISOString() : undefined },
        { onConflict: 'character_id,title_key' },
      );
    if (!error && isNew) awarded++;
  }

  return { awarded, revoked };
}

// ── Signal computation (reads existing tables, never duplicates them) ──────

async function computeTrustCandidates(): Promise<TitleCandidate[]> {
  // trust lives on character_psychology (per-user relationship state), not
  // character_relationships (which tracks stage/xp/health, no trust column).
  const { data, error } = await supabaseAdmin
    .from('character_psychology')
    .select('character_id, trust')
    .gt('trust', 0);
  if (error || !data) return [];
  return aggregateAvg(data as { character_id: string; trust: number }[], 'trust');
}

async function computeInfluenceCandidates(): Promise<TitleCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from('social_status')
    .select('character_id, status_score');
  if (error || !data) return [];
  return (data as { character_id: string; status_score: number }[])
    .map((r) => ({ character_id: r.character_id, score: r.status_score }));
}

async function computeLoveCandidates(): Promise<TitleCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from('dating_matches')
    .select('character_id, bond_score');
  if (error || !data) return [];
  return aggregateAvg(data as { character_id: string; bond_score: number }[], 'bond_score');
}

async function computeFearCandidates(): Promise<TitleCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from('companion_reputation')
    .select('character_id, notoriety_score')
    .gt('notoriety_score', 0);
  if (error || !data) return [];
  return (data as { character_id: string; notoriety_score: number }[])
    .map((r) => ({ character_id: r.character_id, score: r.notoriety_score }));
}

async function computeAdmiredCandidates(): Promise<TitleCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from('companion_reputation')
    .select('character_id, fame_score, reputation_type')
    .in('reputation_type', ['hero', 'celebrity'])
    .gt('fame_score', 0);
  if (error || !data) return [];
  return (data as { character_id: string; fame_score: number }[])
    .map((r) => ({ character_id: r.character_id, score: r.fame_score }));
}

async function computeNotoriousCandidates(): Promise<TitleCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from('companion_reputation')
    .select('character_id, notoriety_score, reputation_type')
    .in('reputation_type', ['villain', 'outlaw'])
    .gt('notoriety_score', 0);
  if (error || !data) return [];
  return (data as { character_id: string; notoriety_score: number }[])
    .map((r) => ({ character_id: r.character_id, score: r.notoriety_score }));
}

async function computeGenerosityCandidates(): Promise<TitleCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from('world_impact_events')
    .select('character_id, weight')
    .eq('source', 'gift');
  if (error || !data) return [];
  return aggregateSum(data as { character_id: string; weight: number }[], 'weight');
}

// ── Aggregation helpers ─────────────────────────────────────────────────────

function aggregateAvg<T extends { character_id: string }>(rows: T[], field: keyof T): TitleCandidate[] {
  const grouped = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const val = Number(row[field]) || 0;
    const entry = grouped.get(row.character_id) ?? { sum: 0, count: 0 };
    entry.sum += val;
    entry.count += 1;
    grouped.set(row.character_id, entry);
  }
  return [...grouped.entries()].map(([character_id, { sum, count }]) => ({
    character_id, score: count > 0 ? sum / count : 0,
  }));
}

function aggregateSum<T extends { character_id: string }>(rows: T[], field: keyof T): TitleCandidate[] {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const val = Number(row[field]) || 0;
    grouped.set(row.character_id, (grouped.get(row.character_id) ?? 0) + val);
  }
  return [...grouped.entries()].map(([character_id, score]) => ({ character_id, score }));
}

// ── Public: Prompt Formatter ────────────────────────────────────────────────

export async function formatTitlesForPrompt(characterId: string): Promise<string> {
  const titles = await getCharacterTitles(characterId);
  if (titles.length === 0) return '';

  const lines = titles.map((t) => `You are publicly known as "${titleLabel(t.title_key)}" across the world.`);
  return `[Titles Held]\n${lines.join('\n')}`;
}
