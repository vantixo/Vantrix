/**
 * Politics Engine — Unified Political Simulation
 *
 * Single entry point for everything political in the universe simulation.
 * Composes the existing per-domain engines and adds the two pieces that
 * didn't exist yet (alliances, corruption investigations), plus campaign
 * financing that ties factions' influence/corruption into election outcomes.
 *
 *   Political parties → factions (factions.ts / world-expansion types).
 *     A "party" is just a faction; nothing new to model there.
 *   Influence          → faction-evolution.ts (drift + ruling overtake).
 *   Alliances           → this file (faction_alliances table).
 *   Corruption          → city_governance.corruption (drift, governance.ts)
 *                          + this file (corruption_investigations — the
 *                          part that actually surfaces as a storyline).
 *   Campaigns            → elections.ts (candidate lifecycle) + this file
 *                          (faction-funded campaign contributions).
 *   Diplomacy            → diplomacy.ts (city-to-city relations, untouched).
 *
 * runPoliticsTick() is the one function callers need: it runs every domain
 * in the right order for a given location and returns a combined result.
 * Individual pieces remain separately importable for the worker dispatcher.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { narrate }       from './narrator';

import { runGovernanceTick }   from './governance';
import { runLawVote }          from './laws';
import { runElectionProcess }  from './elections';
import { runDiplomaticEvent }  from './diplomacy';
import { runCityCrisis }       from './crisis';
import { runFactionEvolution } from './faction-evolution';

const ALLIANCE_FORM_THRESHOLD   = 0.12; // per-tick chance for compatible factions to ally
const ALLIANCE_BREAK_STRENGTH   = 15;   // strength below this can dissolve the alliance
const RIVALRY_FORM_THRESHOLD    = 0.08;
const CORRUPTION_INVESTIGATE_AT = 65;   // city_governance.corruption threshold that can spawn an investigation
const ILLICIT_EXPOSURE_CHANCE   = 0.25; // per illicit contribution, per tick, chance it feeds an investigation

// ── Public: Full Tick ────────────────────────────────────────────────────────

export interface PoliticsTickResult {
  location_id:  string;
  governance:   Awaited<ReturnType<typeof runGovernanceTick>>;
  laws:         Awaited<ReturnType<typeof runLawVote>>;
  elections:    Awaited<ReturnType<typeof runElectionProcess>>;
  crisis:       Awaited<ReturnType<typeof runCityCrisis>>;
  corruption:   { investigations_opened: number; investigations_resolved: number };
  campaigns:    { contributions_made: number; exposures: number };
}

/**
 * Runs the full per-city political stack in dependency order:
 * governance drift → corruption investigations (reads the freshly-drifted
 * corruption value) → laws → campaign financing (reads open elections) →
 * elections → crises (reads freshly-updated stability).
 *
 * Global (non-per-city) pieces — diplomacy, faction influence/alliances —
 * are run separately via runGlobalPoliticsTick(), same split as the
 * existing governance_tick (per-city) vs diplomatic_event (global) jobs.
 */
export async function runPoliticsTick(locationId: string): Promise<PoliticsTickResult> {
  const governance = await runGovernanceTick(locationId);
  const corruption = await runCorruptionInvestigations(locationId);
  const laws = await runLawVote(locationId);
  const campaigns = await runCampaignFinancing(locationId);
  const elections = await runElectionProcess(locationId);
  const crisis = await runCityCrisis(locationId);

  return { location_id: locationId, governance, laws, elections, crisis, corruption, campaigns };
}

export interface GlobalPoliticsTickResult {
  diplomacy:  Awaited<ReturnType<typeof runDiplomaticEvent>>;
  evolution:  Awaited<ReturnType<typeof runFactionEvolution>>;
  alliances:  { formed: number; broken: number; rivalries_formed: number };
}

export async function runGlobalPoliticsTick(): Promise<GlobalPoliticsTickResult> {
  const evolution = await runFactionEvolution();
  const alliances = await runAllianceDynamics();
  const diplomacy = await runDiplomaticEvent();
  return { diplomacy, evolution, alliances };
}

// ── Alliances ─────────────────────────────────────────────────────────────────

export async function runAllianceDynamics(): Promise<{ formed: number; broken: number; rivalries_formed: number }> {
  let formed = 0;
  let broken = 0;
  let rivalriesFormed = 0;

  // 1. Drift existing alliances/rivalries, break ones that decay too far.
  const { data: existing } = await supabaseAdmin
    .from('faction_alliances')
    .select('*, a:factions!faction_alliances_faction_a_id_fkey(name), b:factions!faction_alliances_faction_b_id_fkey(name)')
    .eq('status', 'active');

  for (const rel of existing ?? []) {
    const drift = (Math.random() - 0.5) * 10;
    const newStrength = clamp(rel.strength + drift, 0, 100);

    if (newStrength < ALLIANCE_BREAK_STRENGTH) {
      await supabaseAdmin
        .from('faction_alliances')
        .update({ status: 'broken', strength: newStrength, broken_at: new Date().toISOString() })
        .eq('id', rel.id);
      broken++;

      const nameA = (rel.a as { name?: string } | null)?.name ?? 'A faction';
      const nameB = (rel.b as { name?: string } | null)?.name ?? 'its ally';
      if (rel.relation_type === 'alliance') {
        await logAllianceEvent(rel.faction_a_id, narrate.allianceBroken(nameA, nameB));
      }
    } else {
      await supabaseAdmin.from('faction_alliances').update({ strength: newStrength }).eq('id', rel.id);
    }
  }

  // 2. Consider new alliances/rivalries between factions with no existing relation.
  const { data: factions } = await supabaseAdmin.from('factions').select('id, name, ideology, location_id, is_ruling');
  if (!factions || factions.length < 2) return { formed, broken, rivalries_formed: rivalriesFormed };

  const { data: allPairs } = await supabaseAdmin.from('faction_alliances').select('faction_a_id, faction_b_id');
  const existingPairs = new Set((allPairs ?? []).map((r) => pairKey(r.faction_a_id, r.faction_b_id)));

  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const fa = factions[i]!;
      const fb = factions[j]!;
      if (existingPairs.has(pairKey(fa.id, fb.id))) continue;

      const compatible = fa.ideology && fa.ideology === fb.ideology;
      const rivalOnPower = fa.location_id && fa.location_id === fb.location_id && (fa.is_ruling || fb.is_ruling);

      if (compatible && Math.random() < ALLIANCE_FORM_THRESHOLD) {
        await supabaseAdmin.from('faction_alliances').insert({
          faction_a_id: fa.id, faction_b_id: fb.id, relation_type: 'alliance', strength: 40 + Math.floor(Math.random() * 20),
        });
        formed++;
        await logAllianceEvent(fa.id, narrate.allianceFormed(fa.name, fb.name));
      } else if (rivalOnPower && Math.random() < RIVALRY_FORM_THRESHOLD) {
        await supabaseAdmin.from('faction_alliances').insert({
          faction_a_id: fa.id, faction_b_id: fb.id, relation_type: 'rivalry', strength: 40 + Math.floor(Math.random() * 20),
        });
        rivalriesFormed++;
        await logAllianceEvent(fa.id, narrate.rivalryFormed(fa.name, fb.name));
      }
    }
  }

  return { formed, broken, rivalries_formed: rivalriesFormed };
}

// ── Corruption ────────────────────────────────────────────────────────────────

async function runCorruptionInvestigations(
  locationId: string,
): Promise<{ investigations_opened: number; investigations_resolved: number }> {
  let opened = 0;
  let resolved = 0;

  const { data: active } = await supabaseAdmin
    .from('corruption_investigations')
    .select('*')
    .eq('location_id', locationId)
    .eq('status', 'investigating');

  const { data: gov } = await supabaseAdmin
    .from('city_governance')
    .select('corruption, stability')
    .eq('location_id', locationId)
    .maybeSingle();

  for (const inv of active ?? []) {
    // Higher severity + lower stability makes exposure more likely each tick.
    const exposeChance = 0.15 + inv.severity * 0.05 + (gov ? (50 - gov.stability) / 200 : 0);
    const roll = Math.random();

    if (roll < exposeChance) {
      await supabaseAdmin
        .from('corruption_investigations')
        .update({ status: 'exposed', resolved_at: new Date().toISOString() })
        .eq('id', inv.id);
      resolved++;

      await supabaseAdmin
        .from('city_governance')
        .update({ corruption: clamp((gov?.corruption ?? 40) - 15, 0, 100) }) // exposure forces cleanup; approval drifts naturally next governance tick
        .eq('location_id', locationId);

      await logPoliticalEvent(locationId, 'corruption_exposed', narrate.corruptionExposedDeep(inv.summary), Math.min(5, inv.severity + 1));
    } else if (roll > 1 - 0.1) {
      // Small chance an investigation quietly clears without incident.
      await supabaseAdmin
        .from('corruption_investigations')
        .update({ status: 'cleared', resolved_at: new Date().toISOString() })
        .eq('id', inv.id);
      resolved++;
    }
  }

  // Open a new investigation when corruption is high and none is active.
  if (gov && gov.corruption >= CORRUPTION_INVESTIGATE_AT && (active?.length ?? 0) === 0 && Math.random() < 0.3) {
    const { data: rulingFaction } = await supabaseAdmin
      .from('factions')
      .select('id, name')
      .eq('location_id', locationId)
      .eq('is_ruling', true)
      .maybeSingle();

    const severity = gov.corruption >= 85 ? 5 : gov.corruption >= 75 ? 4 : 3;
    const summary = `Auditors have flagged irregularities tied to ${rulingFaction?.name ?? 'city officials'}.`;

    await supabaseAdmin.from('corruption_investigations').insert({
      location_id: locationId,
      faction_id:  rulingFaction?.id ?? null,
      severity,
      summary,
    });
    opened++;

    await logPoliticalEvent(locationId, 'corruption_investigation_opened', narrate.corruptionInvestigationOpened(), Math.max(2, severity - 1));
  }

  return { investigations_opened: opened, investigations_resolved: resolved };
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

async function runCampaignFinancing(
  locationId: string,
): Promise<{ contributions_made: number; exposures: number }> {
  const { data: election } = await supabaseAdmin
    .from('elections')
    .select('id, status')
    .eq('location_id', locationId)
    .eq('status', 'campaigning')
    .maybeSingle();

  if (!election) return { contributions_made: 0, exposures: 0 };

  const { data: candidates } = await supabaseAdmin
    .from('election_candidates')
    .select('id, character_id, polling')
    .eq('election_id', election.id);

  if (!candidates || candidates.length === 0) return { contributions_made: 0, exposures: 0 };

  const { data: factions } = await supabaseAdmin
    .from('factions')
    .select('id, influence, is_ruling')
    .eq('location_id', locationId);

  if (!factions || factions.length === 0) return { contributions_made: 0, exposures: 0 };

  let contributions = 0;
  let exposures = 0;

  for (const candidate of candidates) {
    // A faction backs roughly one candidate per city per campaign — cheap
    // heuristic: pick a faction by round-robin over candidate index, biased
    // toward the ruling faction backing whichever candidate polls highest.
    const backer = factions[Math.floor(Math.random() * factions.length)]!;
    if (Math.random() >= 0.4) continue; // not every faction contributes every tick

    const isIllicit = backer.is_ruling && Math.random() < 0.2; // ruling factions occasionally cross the line
    const amount = 500 + Math.floor(Math.random() * 2000) * (isIllicit ? 2 : 1);
    const pollingBoost = (backer.influence / 100) * (isIllicit ? 6 : 2.5);

    await supabaseAdmin.from('campaign_contributions').insert({
      election_id:  election.id,
      candidate_id: candidate.id,
      faction_id:   backer.id,
      amount,
      is_illicit:   isIllicit,
    });
    contributions++;

    await supabaseAdmin
      .from('election_candidates')
      .update({ polling: clamp(candidate.polling + pollingBoost, 1, 95) })
      .eq('id', candidate.id);

    if (isIllicit && Math.random() < ILLICIT_EXPOSURE_CHANCE) {
      exposures++;
      await supabaseAdmin.from('corruption_investigations').insert({
        location_id: locationId,
        faction_id:  backer.id,
        severity:    3,
        summary:     'Unreported campaign spending has drawn scrutiny.',
      });
      await logPoliticalEvent(locationId, 'illicit_funding_suspected', narrate.illicitFundingSuspected(), 3);
    }
  }

  return { contributions_made: contributions, exposures };
}

// ── Shared logging ────────────────────────────────────────────────────────────

async function logPoliticalEvent(locationId: string, eventType: string, description: string, severity: number): Promise<void> {
  await supabaseAdmin.from('political_events').insert({
    event_type: eventType,
    title: titleFor(eventType),
    description,
    location_id: locationId,
    severity,
  }).then(({ error }) => {
    if (error) logger.warn('politics-engine:log-event:failed', { locationId, eventType, error });
  });
}

async function logAllianceEvent(factionId: string, description: string): Promise<void> {
  const { data: faction } = await supabaseAdmin.from('factions').select('location_id').eq('id', factionId).maybeSingle();
  if (!faction?.location_id) return;
  await logPoliticalEvent(faction.location_id, 'faction_alliance_shift', description, 2);
}

function titleFor(eventType: string): string {
  return {
    corruption_exposed:               'Corruption Exposed',
    corruption_investigation_opened:  'Investigation Opened',
    illicit_funding_suspected:        'Campaign Funding Questioned',
    faction_alliance_shift:           'Faction Relations Shift',
  }[eventType] ?? 'Political Development';
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
