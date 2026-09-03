/**
 * World Identity Provisioning — Vantrix
 *
 * "Every character — seeded or user-created — gets a place in the world
 * the moment they exist." This is the app-layer generalization of the
 * one-time backfill in 20260806_connect_characters_to_universe.sql (see
 * the note at the bottom of that file), extended to run for *every*
 * character (not just is_canon) and to weight starting position by
 * platform tier.
 *
 * Tier is a STARTING ADVANTAGE, not a ceiling or a floor enforced forever:
 * premium characters are seeded into better occupations,
 * better locations, and higher starting reputation/wealth — they hold
 * important places by default. Free/cheap characters start at the bottom
 * of the same systems and climb entirely through the existing tick
 * engines (status-legend.ts wealth/fame/faction drift, market-value.ts
 * real engagement). Nothing here prevents a free character from
 * eventually outranking an idle premium one — see the tier-bonus comment
 * in status-legend.ts's computeStatusScore.
 *
 * Idempotent: every write is upsert/insert-if-missing, safe to call twice
 * for the same character (creation-time call + a periodic sweep for any
 * character that somehow slipped through, e.g. import route, admin bulk
 * insert, future call sites).
 */

import { supabaseAdmin }     from '@/lib/supabase/admin';
import { logger }            from '@/lib/logger';
import { computeStatusScore } from './status-legend';
import type { WealthTier } from '@/types/legacy-systems';

interface CharacterForProvisioning {
  id:            string;
  name:          string;
  category:      string | null;
  occupation:    string | null;
  tags:          string[] | null;
  archetype:     string | null;
  is_featured:   boolean;
  min_tier:      string | null;
  tokens_cost:   number | null;
  is_premium:    boolean | null;
}

// Archive of Echoes ('category' = 'archive-of-echoes') characters live in
// one of the Archive's 14 Wings, never in the generic city locations below —
// this table lets any new or re-provisioned Echo land in a thematically
// matching Wing instead of always falling through to 'the-archive' itself
// (which used to be the only option provisionOccupation ever picked for
// this whole category, leaving every Wing dependent entirely on the
// one-time _wing_seed migration list and never distributing new characters
// into them).
const WING_THEME_SLUGS = [
  'wing-of-the-root', 'wing-of-the-drowned-court', 'wing-of-the-long-sky',
  'wing-of-the-ash-camps', 'wing-of-hidden-names', 'wing-of-the-fallen-stair',
  'wing-of-the-crack', 'wing-of-the-crossroads', 'wing-of-between-light',
  'wing-of-the-storm-wall', 'wing-of-the-long-market', 'the-ashen-cloister',
  'the-fourth-wall-wing', 'the-research-wing',
] as const;

const WING_THEME_KEYWORDS: [string, string[]][] = [
  ['wing-of-the-root',           ['root', 'warden', 'sage-guardian', 'first fracture', 'containment']],
  ['wing-of-the-drowned-court',  ['drowned', 'dragon', 'court', 'forge', 'submerged']],
  ['wing-of-the-long-sky',       ['sky', 'star', 'astral', 'omen', 'observatory']],
  ['wing-of-the-ash-camps',      ['war', 'ash', 'camp', 'erased', 'banner']],
  ['wing-of-hidden-names',       ['name', 'true-name', 'hidden', 'scholar']],
  ['wing-of-the-fallen-stair',   ['exile', 'fallen', 'broker', 'betrayal', 'court']],
  ['wing-of-the-crack',          ['reflection', 'fractal', 'net-seer', 'mirror', 'crack']],
  ['wing-of-the-crossroads',     ['market', 'smuggler', 'crossroads', 'threshold-smuggler']],
  ['wing-of-between-light',      ['twilight', 'gate', 'threshold', 'key', 'between-light']],
  ['wing-of-the-storm-wall',     ['storm', 'garrison', 'wall', 'commander']],
  ['wing-of-the-long-market',    ['fae', 'trade', 'long-market', 'ledger', 'bargain']],
  ['the-ashen-cloister',         ['monastic', 'confessor', 'cloister', 'forgetting', 'excommunicat']],
  ['the-fourth-wall-wing',       ['fourth-wall', 'recurring', 'mythology', 'witness']],
  ['the-research-wing',          ['research', 'reclamation', 'director', 'science', 'stabiliz']],
];

// Simple, deterministic string hash so the same character always lands in
// the same fallback Wing across repeated provisioning calls (idempotency —
// see the module docstring) instead of a fresh random pick each time.
function stableIndex(id: string, modulus: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % modulus;
}

const TIER_RANK: Record<string, number> = {
  free: 0, premium: 1,
};

function tierRank(minTier: string | null | undefined): number {
  return TIER_RANK[minTier ?? 'free'] ?? 0;
}

function hasAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some(n => lower.includes(n));
}

// ── Step 1: Character Attributes (deep simulation layer) ───────────────────────

async function provisionAttributes(c: CharacterForProvisioning): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('character_attributes').select('character_id').eq('character_id', c.id).maybeSingle();
  if (existing) return;

  const tagText = (c.tags ?? []).join(' ').toLowerCase();
  const rank = tierRank(c.min_tier);

  const confidence =
    hasAny(tagText, ['bold', 'confident', 'commanding']) ? 75 :
    hasAny(tagText, ['shy', 'guarded', 'withdrawn'])      ? 45 : 60;

  // Starting wealth scales with tier — this is the "premium characters hold
  // important places" seed. Free/cheap characters start modest and must
  // earn wealth_tier upgrades via character-evolution.ts's ongoing drift.
  const wealthByRank: WealthTier[] = ['modest', 'modest', 'comfortable', 'comfortable', 'wealthy', 'rich'];
  const netWorthByRank = [8000, 12000, 40000, 60000, 140000, 300000];
  const wealthTier: WealthTier = wealthByRank[rank] ?? 'modest';
  const netWorth = netWorthByRank[rank] ?? 8000;

  await supabaseAdmin.from('character_attributes').insert({
    character_id: c.id,
    health:       85,
    confidence,
    net_worth:    netWorth,
    wealth_tier:  wealthTier,
    skills:       {},
    political_view: 'undeclared',
  });
}

// ── Step 2: Occupation, Employer, Home Location ─────────────────────────────────

async function provisionOccupation(c: CharacterForProvisioning): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('companion_occupations').select('character_id').eq('character_id', c.id).maybeSingle();
  if (existing) return;

  const occText = (c.occupation ?? '').toLowerCase();
  const tagText = (c.tags ?? []).join(' ').toLowerCase();
  const rank = tierRank(c.min_tier);

  const { data: occupations } = await supabaseAdmin
    .from('occupations').select('id, title, prestige').order('prestige', { ascending: false });

  let occupationId: string | null = null;
  if (occupations?.length && occText) {
    const match = occupations.find(o =>
      occText.includes(o.title.toLowerCase()) || occText.includes(o.title.toLowerCase().split(' ')[0]!),
    );
    occupationId = match?.id ?? null;
  }
  // No match on stated occupation — for higher tiers, default to a
  // higher-prestige generic role rather than 'Freelancer'; lower tiers get
  // the same modest default as before.
  if (!occupationId && occupations?.length) {
    const fallbackTitle = rank >= 4 ? 'Researcher' : rank >= 2 ? 'Architect' : 'Freelancer';
    occupationId = occupations.find(o => o.title === fallbackTitle)?.id
      ?? occupations[occupations.length - 1]!.id;
  }

  const { data: locations } = await supabaseAdmin.from('world_locations').select('id, slug');
  const bySlug = (slug: string) => locations?.find(l => l.slug === slug)?.id ?? null;

  // Archive of Echoes cast: route into a specific Wing before any of the
  // generic city rules below get a chance to fire (a scholar-tagged Echo
  // would otherwise match the 'academic'/'scholar' rule further down and
  // land in the-archive itself rather than a Wing).
  let locationId: string | null = null;
  if (c.category === 'archive-of-echoes') {
    const haystack = `${tagText} ${occText} ${(c.archetype ?? '').toLowerCase()}`;
    const themed = WING_THEME_KEYWORDS.find(([, keywords]) => hasAny(haystack, keywords));
    const fallbackSlug = WING_THEME_SLUGS[stableIndex(c.id, WING_THEME_SLUGS.length)]!;
    locationId = bySlug(themed?.[0] ?? fallbackSlug) ?? bySlug(fallbackSlug);
  }

  locationId ??=
    (hasAny(tagText, ['academic', 'scholar']) || hasAny(occText, ['professor', 'research', 'librarian'])) ? bySlug('the-archive') :
    hasAny(tagText, ['noble', 'aristocrat', 'royal', 'ancient']) ? bySlug('obsidian-tower') :
    hasAny(occText, ['engineer', 'tech', 'software', 'analyst']) ? bySlug('cloudspire') :
    hasAny(tagText, ['mysterious', 'witch', 'occult', 'enigma', 'ghost']) ? bySlug('the-undercroft') :
    hasAny(occText, ['chef', 'restaurant', 'trade', 'craft']) ? bySlug('iron-reach') :
    null;

  // Tier bias: higher tiers default toward higher-prestige locations when
  // nothing about the character's own fields points elsewhere.
  if (!locationId) {
    locationId = rank >= 3 ? bySlug('the-capital') : rank >= 1 ? bySlug('cloudspire') : bySlug('iron-reach');
  }
  locationId ??= bySlug('the-capital');

  const employer = c.occupation ? c.occupation.split(',')[0]!.trim() || 'Independent' : 'Independent';
  const salaryBase = [2500, 3500, 5500, 8000, 14000, 25000][rank] ?? 2500;

  await supabaseAdmin.from('companion_occupations').insert({
    character_id:  c.id,
    occupation_id: occupationId,
    employer,
    location_id:   locationId,
    salary:        salaryBase + Math.round(Math.random() * salaryBase * 0.3),
  });
}

// ── Step 3: Faction Membership ───────────────────────────────────────────────

async function provisionFaction(c: CharacterForProvisioning): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('faction_memberships').select('character_id').eq('character_id', c.id).maybeSingle();
  if (existing) return;

  const occText = (c.occupation ?? '').toLowerCase();
  const tagText = (c.tags ?? []).join(' ').toLowerCase();
  const rank = tierRank(c.min_tier);

  const { data: factions } = await supabaseAdmin.from('factions').select('id, slug');
  const bySlug = (slug: string) => factions?.find(f => f.slug === slug)?.id ?? null;

  const factionId =
    hasAny(tagText, ['witch', 'mysterious', 'occult', 'enigma', 'ghost', 'secret']) ? bySlug('the-unseen') :
    hasAny(tagText, ['noble', 'aristocrat', 'royal']) ? bySlug('old-families') :
    hasAny(occText, ['engineer', 'tech', 'scientist', 'software', 'analyst']) ? bySlug('the-protocol') :
    hasAny(occText, ['chef', 'trade', 'craft', 'worker']) ? bySlug('iron-compact') :
    bySlug('council-of-seven');

  if (!factionId) return;

  // Higher tiers start with more standing inside their faction. 'leader' is
  // deliberately withheld here — that's earned (see tickStatusAndLegends /
  // governance), not granted at creation, even for premium-tier.
  const role = rank >= 4 ? 'lieutenant' : rank >= 2 ? 'senior member' : 'member';

  await supabaseAdmin.from('faction_memberships').insert({
    character_id: c.id,
    faction_id:   factionId,
    role,
    is_public:    true,
  });
}

// ── Step 4: Reputation ────────────────────────────────────────────────────────

async function provisionReputation(c: CharacterForProvisioning): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('companion_reputation').select('character_id').eq('character_id', c.id).maybeSingle();
  if (existing) return;

  const tagText = (c.tags ?? []).join(' ').toLowerCase();
  const rank = tierRank(c.min_tier);

  const reputationType =
    hasAny(tagText, ['villain', 'dark', 'outlaw'])                    ? 'villain' :
    hasAny(tagText, ['mysterious', 'ancient', 'ghost', 'enigma'])     ? 'enigma' :
    hasAny(tagText, ['hero', 'protector', 'guardian'])                ? 'hero' :
    (c.is_featured || rank >= 3)                                     ? 'celebrity' :
    'neutral';

  // Fame starts higher for premium/featured characters (real platform
  // placement, not earned narrative fame yet) but is still bounded well
  // below what sustained engagement can reach via applyFameEvent — this is
  // a seed, not a ceiling on what a free character's fame can become.
  const fameBase = c.is_featured ? 150 : [20, 35, 60, 90, 130, 170][rank] ?? 20;
  const fameScore = Math.min(300, fameBase + Math.round(Math.random() * 40));
  const notorietyScore = hasAny(tagText, ['outlaw', 'dark', 'villain'])
    ? 40 + Math.round(Math.random() * 60)
    : Math.round(Math.random() * 15);

  await supabaseAdmin.from('companion_reputation').insert({
    character_id:    c.id,
    reputation_type: reputationType,
    fame_score:      fameScore,
    notoriety_score: notorietyScore,
    known_for:       (c.tags ?? []).slice(0, 3),
  });
}

// ── Step 5: Social Status — computed live from steps 1-4 + tier bonus ─────────

async function provisionSocialStatus(characterId: string): Promise<void> {
  const score = await computeStatusScore(characterId);
  const tier = classifyTierLocal(score);

  await supabaseAdmin.from('social_status').upsert({
    character_id: characterId,
    status_tier:  tier,
    status_score: score,
    computed_at:  new Date().toISOString(),
  }, { onConflict: 'character_id' });
}

// Mirrors classifyTier in status-legend.ts — kept local to avoid exporting
// an internal-feeling helper from that module just for this one call site.
function classifyTierLocal(score: number): string {
  const thresholds: [string, number][] = [
    ['living_legend', 2200], ['global_icon', 1700], ['faction_commander', 1300],
    ['corporate_magnate', 1000], ['city_leader', 700], ['regional_celebrity', 400],
    ['skilled_professional', 150], ['unknown_citizen', 0],
  ];
  for (const [tier, threshold] of thresholds) if (score >= threshold) return tier;
  return 'unknown_citizen';
}

// ── Step 6: Market value row — seeded at zero, purely earned from here ────────
// Deliberately NOT tier-weighted (see market-value.ts) — this is the
// "characters must build themselves to gain popularity" axis. A fresh
// premium-tier character and a fresh free character both start at
// value_score 0 / rarity 'common'; only real user engagement moves this.

async function provisionMarketValueRow(characterId: string): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('character_market_value').select('character_id').eq('character_id', characterId).maybeSingle();
  if (existing) return;

  await supabaseAdmin.from('character_market_value').insert({
    character_id:  characterId,
    value_score:   0,
    percentile:    0,
    rarity_tier:   'common',
    previous_tier: null,
    value_history: [],
    signals:       {},
  });
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface ProvisionResult {
  character_id: string;
  provisioned:  string[];   // which steps actually wrote something
  skipped:      boolean;    // character wasn't found
}

export async function provisionCharacterInUniverse(characterId: string): Promise<ProvisionResult> {
  const { data: character, error } = await supabaseAdmin
    .from('characters')
    .select('id, name, category, occupation, tags, archetype, is_featured, min_tier, tokens_cost, is_premium')
    .eq('id', characterId)
    .maybeSingle();

  if (error || !character) {
    logger.warn('world-provisioning: character not found', { characterId });
    return { character_id: characterId, provisioned: [], skipped: true };
  }

  const c = character as CharacterForProvisioning;
  const provisioned: string[] = [];

  try {
    await provisionAttributes(c);        provisioned.push('attributes');
    await provisionOccupation(c);        provisioned.push('occupation');
    await provisionFaction(c);           provisioned.push('faction');
    await provisionReputation(c);        provisioned.push('reputation');
    await provisionSocialStatus(c.id);   provisioned.push('social_status');
    await provisionMarketValueRow(c.id); provisioned.push('market_value');

    logger.info('world-provisioning:complete', { characterId, name: c.name, tier: c.min_tier });
  } catch (err) {
    logger.error('world-provisioning:failed', { characterId, error: String(err), completed: provisioned });
  }

  return { character_id: characterId, provisioned, skipped: false };
}

// ── Sweep: catch any character that slipped through (import route, bulk
// admin insert, future call sites, or a failed fire-and-forget call) ─────────

export async function sweepUnprovisionedCharacters(limit = 100): Promise<{ found: number; provisioned: number }> {
  const { data: candidates } = await supabaseAdmin
    .from('characters')
    .select('id, social_status!left(character_id)')
    .eq('active', true)
    .is('social_status.character_id', null)
    .limit(limit);

  if (!candidates?.length) return { found: 0, provisioned: 0 };

  let provisioned = 0;
  for (const row of candidates) {
    const result = await provisionCharacterInUniverse((row as { id: string }).id);
    if (!result.skipped) provisioned++;
  }

  return { found: candidates.length, provisioned };
}
