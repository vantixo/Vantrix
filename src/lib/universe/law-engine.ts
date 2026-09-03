/**
 * Law Engine — Legal System & Justice Culture
 *
 * Note: distinct from src/lib/universe/laws.ts, which handles the
 * mechanical proposal/vote/pass lifecycle of individual proposed_laws
 * rows. This engine narrates the surrounding legal *culture* — how a
 * city's justice system is perceived, enforcement posture, precedent,
 * and reform pressure — reading city_governance for context (laws on
 * the books, corruption, stability) and writing world_events so it's
 * visible in prompt context without touching the voting mechanics.
 *
 * Provides getJusticePosture(), consumed by crime-engine.ts (enforcement
 * pressure affects incident odds) and court-engine.ts (backlog/severity
 * flavor for verdicts).
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

const EXPIRY_DAYS           = 12;
const LOCATION_SAMPLE_LIMIT = 12;

interface GovernanceRow {
  location_id: string;
  corruption:  number;
  stability:   number;
  laws:        string[] | null;
}

export type JusticePosture = 'lax' | 'balanced' | 'strict' | 'authoritarian';

// ── Public: Tick ─────────────────────────────────────────────────────────────

export async function tickLaw(): Promise<{ generated: number; expired: number }> {
  const { count: expiredCount } = await supabaseAdmin
    .from('world_events')
    .update({ is_active: false }, { count: 'exact' })
    .eq('event_type', 'legal_system')
    .lt('expires_at', new Date().toISOString())
    .eq('is_active', true);

  const expired = expiredCount ?? 0;

  const { data: governance, error } = await supabaseAdmin
    .from('city_governance')
    .select('location_id, corruption, stability, laws')
    .limit(LOCATION_SAMPLE_LIMIT);

  if (error || !governance || governance.length === 0) {
    logger.warn('law-engine:tick:no-governance', { error });
    return { generated: 0, expired };
  }

  const { data: locations } = await supabaseAdmin.from('world_locations').select('id, name');
  const nameById = new Map((locations ?? []).map((l: { id: string; name: string }) => [l.id, l.name]));

  let generated = 0;
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const gov of governance as GovernanceRow[]) {
    if (Math.random() < 0.6) continue; // legal news is infrequent relative to daily churn

    const name = nameById.get(gov.location_id) ?? 'the city';
    const posture = postureFor(gov);
    const template = pick(buildLegalPool(name, posture, gov.laws ?? []));

    const { error: insertError } = await supabaseAdmin.from('world_events').insert({
      event_type:       'legal_system',
      title:            template.title,
      description:      template.description,
      location_id:      gov.location_id,
      emotional_weight: template.weight,
      is_active:        true,
      expires_at:       expiresAt,
    });

    if (insertError) {
      logger.warn('law-engine:tick:insert-failed', { locationId: gov.location_id, error: insertError });
      continue;
    }
    generated++;
  }

  logger.info('law-engine:tick:complete', { generated, expired });
  return { generated, expired };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

/** Derives an enforcement posture from a city's governance stats. Used by crime-engine and court-engine. */
export async function getJusticePosture(locationId: string): Promise<JusticePosture> {
  const { data: gov } = await supabaseAdmin
    .from('city_governance')
    .select('corruption, stability, laws')
    .eq('location_id', locationId)
    .maybeSingle();

  if (!gov) return 'balanced';
  return postureFor({ location_id: locationId, corruption: gov.corruption, stability: gov.stability, laws: gov.laws });
}

/**
 * Batched form of getJusticePosture() — one query for every location instead
 * of one round trip per location. crime-engine.tickCrime() and
 * court-engine.tickCourt() both loop over a location/incident list and used
 * to call getJusticePosture() per-iteration (N+1); they should call this
 * once up front and read from the returned map instead. Locations with no
 * city_governance row fall back to 'balanced', same as the single-lookup path.
 */
export async function getJusticePostures(locationIds: string[]): Promise<Map<string, JusticePosture>> {
  const result = new Map<string, JusticePosture>();
  const uniqueIds = [...new Set(locationIds)].filter(Boolean);
  if (uniqueIds.length === 0) return result;

  const { data: rows, error } = await supabaseAdmin
    .from('city_governance')
    .select('location_id, corruption, stability, laws')
    .in('location_id', uniqueIds);

  if (error) {
    logger.warn('law-engine:get-justice-postures:query-failed', { error });
    for (const id of uniqueIds) result.set(id, 'balanced');
    return result;
  }

  const byLocation = new Map((rows as GovernanceRow[] ?? []).map((r) => [r.location_id, r]));
  for (const id of uniqueIds) {
    const gov = byLocation.get(id);
    result.set(id, gov ? postureFor({ location_id: id, corruption: gov.corruption, stability: gov.stability, laws: gov.laws }) : 'balanced');
  }
  return result;
}

export async function getActiveLegalEvents(locationId?: string, limit = 10) {
  let query = supabaseAdmin
    .from('world_events')
    .select('id, title, description, location_id, emotional_weight, created_at')
    .eq('event_type', 'legal_system')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

// ── Internal ─────────────────────────────────────────────────────────────────

function postureFor(gov: GovernanceRow): JusticePosture {
  const lawCount = (gov.laws ?? []).filter((l) => /security|watch|patrol|licensing|tariff/i.test(l)).length;
  const strictnessScore = (100 - gov.stability) * -0.2 + gov.corruption * 0.3 + lawCount * 8;

  if (gov.corruption >= 70 && gov.stability < 40) return 'authoritarian';
  if (strictnessScore >= 20) return 'strict';
  if (strictnessScore <= -10) return 'lax';
  return 'balanced';
}

interface LegalTemplate { title: string; description: string; weight: number }

function buildLegalPool(name: string, posture: JusticePosture, laws: string[]): LegalTemplate[] {
  const recentLaw = laws.length > 0 ? laws[laws.length - 1] : null;

  const base: LegalTemplate[] = [
    {
      title: `Court Backlog Grows in ${name}`,
      description: `Cases are taking longer to reach a docket. Lawyers are advising clients to expect delays.`,
      weight: 3,
    },
    {
      title: `Legal Aid Clinic Opens`,
      description: `A new clinic in ${name} is offering free counsel to residents who can't afford representation.`,
      weight: 2,
    },
    {
      title: `A Precedent-Setting Ruling`,
      description: `A recent case in ${name}'s courts is being cited already in arguments that have nothing to do with the original dispute.`,
      weight: 4,
    },
  ];

  const postureSpecific: Record<JusticePosture, LegalTemplate[]> = {
    lax: [
      {
        title: `Enforcement Gaps Draw Criticism`,
        description: `Residents of ${name} are increasingly vocal that existing rules aren't being enforced consistently.`,
        weight: 4,
      },
      {
        title: `Petition for Stricter Oversight`,
        description: `A group in ${name} is collecting signatures demanding tighter enforcement of laws already on the books.`,
        weight: 3,
      },
    ],
    balanced: [
      {
        title: `Judicial Review Committee Convenes`,
        description: `A routine review of court procedure in ${name} is underway. Nothing dramatic expected, but reformers are watching.`,
        weight: 2,
      },
    ],
    strict: [
      {
        title: `Crackdown Draws Mixed Reaction`,
        description: `Increased enforcement in ${name} has residents split between relief and resentment.`,
        weight: 4,
      },
      {
        title: `Civil Liberties Concerns Raised`,
        description: `Advocates in ${name} are warning that recent enforcement measures are overreaching.`,
        weight: 4,
      },
    ],
    authoritarian: [
      {
        title: `Fear of Selective Enforcement`,
        description: `Whispers in ${name} suggest the law bends depending on who you know. Nobody will say it publicly.`,
        weight: 6,
      },
      {
        title: `A Quiet Disappearance from the Docket`,
        description: `A case everyone in ${name} was watching closely was abruptly dropped. No explanation given.`,
        weight: 6,
      },
    ],
  };

  const pool = [...base, ...postureSpecific[posture]];

  if (recentLaw) {
    pool.push({
      title: `Early Effects of "${recentLaw}"`,
      description: `It's still early, but ${name} residents are already debating whether the new rule is working as intended.`,
      weight: 3,
    });
  }

  return pool;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
