/**
 * Vantrix — Universe Frontend View Types
 *
 * Aggregate/composed shapes consumed by the Universe section UI. These
 * compose the underlying row types from `legacy-systems.ts` and
 * `world-expansion.ts` into the exact shapes the frontend renders.
 *
 * Kept deliberately separate from those two files so the simulation
 * read/write engines stay unaware of any UI-specific composition —
 * mirrors the existing read/write separation already used by
 * `world-history.ts` (read layer) vs. `governance.ts` / `economy.ts`
 * (write/tick layer).
 */

import type {
  SocialStatus, Legend, ScarceAsset, CharacterAttributes, TimelineEntry, BiographyEntry,
} from './legacy-systems';
import type {
  WorldLocation, Faction, CompanionReputation, CompanionOccupation,
  CompanionSocialLink, WorldEvent, WorldStory, UniverseState,
  CityCrisis, DiplomaticRelation, FactionEvolutionLogEntry,
} from './world-expansion';
import type { LocationScene } from '@/lib/universe/world-atlas';

// ── World Overview ───────────────────────────────────────────────────────────

export interface WorldOverview {
  state:   UniverseState;
  events:  WorldEvent[];
  stories: WorldStory[];
}

// ── Atlas (Locations) ────────────────────────────────────────────────────────

export interface LocationGovernanceSummary {
  approval_rating: number;
  stability:       number;
  corruption:      number;
  government_type: string;
}

export interface LocationEconomySummary {
  gdp:              number;
  unemployment:     number;
  primary_industry: string;
}

export interface LocationSummary extends WorldLocation {
  governance:    LocationGovernanceSummary | null;
  economy:       LocationEconomySummary | null;
  faction_count: number;
}

export interface LocationResident {
  id:         string;
  name:       string;
  image_url:  string | null;
  occupation: string | null;
  employer:   string | null;
}

export interface LocationDetail extends LocationSummary {
  leader:    { id: string; name: string; image_url: string } | null;
  laws:      string[];
  factions:  (Pick<Faction, 'id' | 'name' | 'slug' | 'ideology' | 'influence' | 'is_ruling' | 'motto' | 'sigil_description'> & {
    member_count: number;
  })[];
  assets:    ScarceAsset[];
  history:   TimelineEntry[];
  // Characters whose home location (companion_occupations.location_id) is
  // this place — the unique cast that belongs here. Scene composition and
  // the Residents section both scope to this list rather than the global
  // character roster, so each world shows its own people instead of every
  // character in every city.
  residents: LocationResident[];
  // Scene Builder output for this location — see world-atlas.ts's
  // "Location Scenes" section / getScenesForLocation.
  scenes: LocationScene[];
  // "Right now" ambiance — weather/crime/culture/religion/inflation, all
  // scoped to this location. Same read functions already wired into the
  // AI prompt layer (weather-engine.ts etc. via universe-prompt.ts) —
  // surfaced here too so a visitor sees the same "current moment" a
  // character chatting from this location already knows about.
  pulse: {
    weather:  { description: string; recorded_at: string } | null;
    crime:    { title: string; description: string }[];
    culture:  { title: string; description: string }[];
    religion: { title: string; description: string }[];
    inflation: { cpi: number; inflation_rate: number } | null;
  };
  // The city's current active crisis (unrest/scandal/disaster/shortage/
  // uprising), if any — written by crisis.ts's runCityCrisis() every
  // city_crisis tick but never previously read back for the page.
  crisis: CityCrisis | null;
  // This city's standing with its nearest neighbors — written by
  // diplomacy.ts's runDiplomaticEvent() but never previously surfaced.
  // Each entry names the OTHER city in the pair (this location omitted).
  diplomacy: (Pick<DiplomaticRelation, 'id' | 'standing' | 'status' | 'updated_at'> & {
    other_location: { id: string; name: string; slug: string } | null;
  })[];
}

// ── Factions ──────────────────────────────────────────────────────────────────

export interface FactionSummary extends Faction {
  culture:      string;
  member_count: number;
  location:     { id: string; name: string; slug: string } | null;
}

export interface FactionMemberRow {
  character_id: string;
  role:         string;
  is_public:    boolean;
  joined_at:    string;
  character:    { id: string; name: string; image_url: string } | null;
  status_tier:  string | null;
}

export interface FactionDetail extends FactionSummary {
  members: FactionMemberRow[];
  // Recent influence/ruling-change history — written by
  // faction-evolution.ts's runFactionEvolution() every faction_evolve
  // tick but, per that file's own doc comment, never previously read
  // back for "the faction detail view" it names as the intended target.
  evolution_log: FactionEvolutionLogEntry[];
}

// ── Character World Profile ──────────────────────────────────────────────────

export interface CharacterWorldProfile {
  character_id: string;
  status:       SocialStatus | null;
  legend:       Legend | null;
  attributes:   CharacterAttributes | null;
  reputation:   CompanionReputation | null;
  occupation:   CompanionOccupation | null;
  social_links: CompanionSocialLink[];
  assets:       ScarceAsset[];
  biography:    BiographyEntry[];
}
