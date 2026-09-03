/**
 * Vantrix — World Expansion Types
 * Universe simulation job queue, worker results, and world-state interfaces.
 */

// ── Universe Job Queue ─────────────────────────────────────────────────────────

export type UniverseJobType =
  | 'governance_tick'
  | 'economy_tick'
  | 'employment_tick'
  | 'housing_tick'
  | 'tax_policy_tick'
  | 'companion_life'
  | 'event_generate'
  | 'story_advance'
  | 'reputation_update'
  | 'public_perception_tick'
  | 'feed_build'
  | 'election_process'
  | 'law_vote'
  | 'trade_process'
  | 'diplomatic_event'
  | 'city_crisis'
  | 'faction_evolve'
  | 'world_mood_update'
  | 'full_universe_tick'
  // ── Deep tick (LLM orchestrator, daily) ───────────────────────────────────
  | 'deep_tick'
  | 'status_tick'
  | 'legend_check'
  | 'history_aggregate'
  | 'visual_identity_backfill'
  | 'market_value_tick'
  | 'world_provisioning_sweep'
  | 'aging_tick'
  | 'company_tick'
  | 'community_tick'
  // ── New: culture, faith, justice, movement, knowledge & climate engines ──
  | 'culture_tick'
  | 'religion_tick'
  | 'law_tick'
  | 'crime_tick'
  | 'court_tick'
  | 'migration_tick'
  | 'technology_tick'
  | 'science_tick'
  | 'education_tick'
  | 'weather_tick'
  | 'season_tick'
  | 'disaster_tick'
  | 'civic_and_climate_tick'
  // ── New: multi-agent organization layer ───────────────────────────────────
  | 'organization_tick'
  | 'leadership_tick'
  | 'consensus_sweep'
  | 'message_delivery'
  | 'memory_decay';

export type UniverseJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface UniverseJob {
  id:           string;
  job_type:     UniverseJobType;
  payload:      Record<string, unknown>;
  status:       UniverseJobStatus;
  priority:     number;
  attempts:     number;
  max_attempts: number;
  error?:       string | null;
  result?:      Record<string, unknown> | null;
  created_at:   string;
  claimed_at?:  string | null;
  completed_at?: string | null;
}

// ── Worker Results ─────────────────────────────────────────────────────────────

export interface WorldWorkerResult {
  jobs_claimed:      number;
  jobs_completed:    number;
  jobs_failed:       number;
  governance_ticks:  number;
  economy_ticks:     number;
  companion_updates: number;
  duration_ms:       number;
  error?:            string;
  [key: string]:     unknown;
}

// ── Universe State ─────────────────────────────────────────────────────────────

export type WorldSeason = 'spring' | 'summer' | 'autumn' | 'winter';
export type WorldMood   = 'hopeful' | 'tense' | 'prosperous' | 'volatile' | 'melancholic' | 'celebratory' | 'grim' | 'uncertain';

export interface UniverseState {
  id:          string;
  season:      WorldSeason;
  world_mood:  WorldMood;
  tick_count:  number;
  year:        number;
  month:       number;
  updated_at:  string;
  last_ticked_at?: string | null;
}

// ── World Locations ────────────────────────────────────────────────────────────

export type LocationArchetype = 'city' | 'district' | 'outpost' | 'landmark' | 'wilderness';

export interface WorldLocation {
  id:                   string;
  name:                 string;
  slug:                 string;
  archetype:            LocationArchetype;
  description:          string;
  culture:              string;
  government_type:      string;
  population:           number;
  is_capital:           boolean;
  emblem_description?:  string | null;
  seal_motto?:          string | null;
  image_url?:           string | null;
  image_generated_at?:  string | null;
  parent_location_id?:  string | null;
  created_at:           string;
  updated_at:           string;
}

// ── Governance ─────────────────────────────────────────────────────────────────

export interface CityGovernance {
  id:                   string;
  location_id:          string;
  leader_character_id?: string | null;
  approval_rating:      number;   // 0-100
  stability:            number;   // 0-100
  corruption:           number;   // 0-100
  government_type:      string;
  laws:                 string[];
  updated_at:           string;
}

// ── Economy ────────────────────────────────────────────────────────────────────

export interface LocationEconomy {
  id:              string;
  location_id:     string;
  gdp:             number;
  unemployment:    number;  // 0-100
  trade_volume:    number;
  primary_industry: string;
  updated_at:      string;
}

// ── Reputation ─────────────────────────────────────────────────────────────────

export type ReputationType = 'hero' | 'villain' | 'enigma' | 'neutral' | 'celebrity' | 'outlaw';

export interface CompanionReputation {
  id:               string;
  character_id:     string;
  reputation_type:  ReputationType;
  fame_score:       number;   // 0-1000
  notoriety_score:  number;   // 0-1000
  known_for:        string[];
  updated_at:       string;
}

// ── Occupations ────────────────────────────────────────────────────────────────

export interface Occupation {
  id:          string;
  title:       string;
  category:    string;
  prestige:    number;  // 0-100
  description: string;
}

export interface CompanionOccupation {
  id:            string;
  character_id:  string;
  occupation_id: string | null;
  employer:      string;
  location_id?:  string | null;
  salary:        number;
  started_at:    string;
  occupation?:   Occupation | null;
  /** Set only when `employer` is an actual founded company — see companies table / company-engine.ts. */
  company_id?:   string | null;
}

// ── Companies ─────────────────────────────────────────────────────────────────

export type CompanyStatus = 'active' | 'struggling' | 'bankrupt' | 'acquired';

export interface Company {
  id:                    string;
  name:                  string;
  founder_character_id:  string;
  location_id:           string;
  industry:              string;
  capital:               number;
  market_share:          number;  // 0-100, zero-sum within (location_id, industry)
  reputation:            number;  // 0-100
  employee_count:        number;
  status:                CompanyStatus;
  founded_at:            string;
  updated_at:            string;
}


// ── Faction ────────────────────────────────────────────────────────────────────

export interface Faction {
  id:                string;
  name:              string;
  slug:              string;
  ideology:          string;
  description:       string;
  influence:         number;  // 0-100
  is_ruling:         boolean;
  motto?:            string | null;
  sigil_description?: string | null;
  location_id?:      string | null;
  image_url?:         string | null;
  image_generated_at?: string | null;
}

export interface FactionMembership {
  id:            string;
  character_id:  string;
  faction_id:    string;
  role:          string;
  is_public:     boolean;
  joined_at:     string;
  faction?:      Faction;
}

// ── Laws ──────────────────────────────────────────────────────────────────────

export type LawStatus   = 'proposed' | 'passed' | 'rejected' | 'repealed';
export type LawCategory = 'economic' | 'social' | 'security' | 'civic' | 'general';

export interface ProposedLaw {
  id:                      string;
  location_id:             string;
  title:                   string;
  description:             string;
  category:                LawCategory;
  support:                 number; // 0-100
  status:                  LawStatus;
  proposed_by_faction_id?: string | null;
  proposed_at:             string;
  resolved_at?:            string | null;
}

// ── Elections ─────────────────────────────────────────────────────────────────

export type ElectionStatus = 'campaigning' | 'voting' | 'concluded';

export interface Election {
  id:                   string;
  location_id:          string;
  status:                ElectionStatus;
  called_at:             string;
  concluded_at?:         string | null;
  winner_character_id?:  string | null;
  winner_faction_id?:    string | null;
  turnout?:              number | null;
  margin?:               number | null;
}

export interface ElectionCandidate {
  id:            string;
  election_id:   string;
  character_id?: string | null;
  faction_id?:   string | null;
  platform?:     string | null;
  polling:       number; // 0-100
  created_at:    string;
}

// ── Diplomacy ─────────────────────────────────────────────────────────────────

export type DiplomaticStatus = 'allied' | 'friendly' | 'neutral' | 'tense' | 'hostile' | 'at_war';

export interface DiplomaticRelation {
  id:             string;
  location_a_id:  string;
  location_b_id:  string;
  standing:       number; // 0-100
  status:         DiplomaticStatus;
  updated_at:     string;
}

// ── Faction Evolution ─────────────────────────────────────────────────────────

export type FactionChangeType = 'influence_shift' | 'ruling_change' | 'ideology_drift' | 'dissolved' | 'founded';

export interface FactionEvolutionLogEntry {
  id:          string;
  faction_id:  string;
  change_type: FactionChangeType;
  delta?:      number | null;
  note?:       string | null;
  created_at:  string;
}

// ── City Crises ───────────────────────────────────────────────────────────────

export type CrisisType   = 'unrest' | 'scandal' | 'disaster' | 'shortage' | 'uprising';
export type CrisisStatus = 'active' | 'resolved';

export interface CityCrisis {
  id:           string;
  location_id:  string;
  crisis_type:  CrisisType;
  severity:     EventSeverity;
  status:       CrisisStatus;
  title:        string;
  description:  string;
  started_at:   string;
  resolved_at?: string | null;
}

// ── Public Perception ─────────────────────────────────────────────────────────

export interface CharacterPublicPerception {
  character_id:       string;
  trustworthy:         boolean;
  dangerous:           boolean;
  famous:              boolean;
  dishonest:           boolean;
  heroic:              boolean;
  rich:                boolean;
  trustworthy_score:   number;
  dangerous_score:     number;
  famous_score:        number;
  dishonest_score:     number;
  heroic_score:        number;
  rich_score:          number;
  updated_at:          string;
}

// ── World Events ───────────────────────────────────────────────────────────────

export type EventSeverity = 1 | 2 | 3 | 4 | 5;

export interface WorldEvent {
  id:              string;
  event_type:      string;
  title:           string;
  description:     string;
  location_id?:    string | null;
  emotional_weight: number;
  is_active:       boolean;
  created_at:      string;
  expires_at?:     string | null;
}

export interface PoliticalEvent {
  id:          string;
  event_type:  string;
  title:       string;
  description: string;
  location_id: string;
  severity:    EventSeverity;
  created_at:  string;
}

export interface EconomicEvent {
  id:          string;
  event_type:  string;
  title:       string;
  description: string;
  location_id: string;
  severity:    EventSeverity;
  created_at:  string;
}

// ── Stories ────────────────────────────────────────────────────────────────────

export type StoryStatus = 'active' | 'paused' | 'concluded' | 'abandoned';

export interface WorldStory {
  id:           string;
  title:        string;
  description:  string;
  status:       StoryStatus;
  participants: string[];  // character_ids
  /**
   * Resolved from `participants` at read time (see attachParticipantCharacters
   * in story-engine.ts) — the raw column is just an id array with no name or
   * image, so callers that need to actually display who's in the story
   * (rather than just persist/tick it) should use this instead.
   */
  participant_characters?: { id: string; name: string; image_url: string | null }[];
  chapter:      number;
  started_at:   string;
  updated_at:   string;
  /**
   * Identifies this row as one of the Act-based Archive of Echoes arcs
   * (see src/lib/universe/archive-story-arcs.ts) so tickStories() can pull
   * the correct per-chapter prose instead of leaving stale chapter-1 text
   * in `description` after advancing. NULL for ordinary generic stories.
   */
  story_key?:   string | null;
}

// ── Companion Offline Log ──────────────────────────────────────────────────────

export type OfflineEntryType =
  | 'activity' | 'social' | 'discovery' | 'goal_progress'
  | 'event_participation' | 'location_change' | 'mood_shift' | 'relationship_change'
  | 'status_change' | 'legend_declared' | 'wealth_change' | 'health_change'
  | 'skill_gained' | 'addiction_developed' | 'addiction_overcome' | 'confidence_shift'
  | 'election_result';

export interface CompanionOfflineEntry {
  id:           string;
  character_id: string;
  entry_type:   OfflineEntryType;
  content:      string;
  metadata:     Record<string, unknown>;
  occurred_at:  string;
}

// ── Social Graph ───────────────────────────────────────────────────────────────

export type SocialLinkType = 'friend' | 'rival' | 'ally' | 'enemy' | 'mentor' | 'protégé' | 'lover' | 'family';

export interface CompanionSocialLink {
  id:                   string;
  character_id:         string;
  linked_character_id:  string;
  link_type:            SocialLinkType;
  strength:             number;  // 0-100
  is_mutual:            boolean;
  linked_character?:    { id: string; name: string; image_url: string };
}

// ── Core Desire Engine ───────────────────────────────────────────────────────
// The layer beneath goals. A goal ("build a real connection with this
// person") is a strategy; a desire ("belonging") is why that strategy was
// chosen at all. Desires are near-static per character (they define who the
// character IS), while goals/intents are the moment-to-moment machinery that
// pursues them. See src/lib/ai/desire-engine.ts.

export type DesireAxis = 'need' | 'want' | 'fear' | 'obsession';

export interface CharacterCoreDesire {
  id:            string;
  character_id:  string;
  need:          string;   // the thing they cannot go without (e.g. "belonging")
  want:          string;   // the thing they consciously chase (e.g. "recognition")
  fear:          string;   // the thing that governs avoidance (e.g. "abandonment")
  obsession:     string;   // the fixation that colors everything (e.g. "art")
  intensity:     number;   // 0-100 — how strongly these currently drive behavior; drifts with fulfillment/starvation
  updated_at:    string;
}

/** How fulfilled vs. starved each axis is for a specific relationship (user x character). Drives which intents/goals surface. */
export interface DesireFulfillment {
  character_id:        string;
  user_id:              string;
  need_fulfillment:     number;  // -100 (badly starved) .. 100 (deeply met)
  want_fulfillment:     number;
  fear_activation:      number;  // 0 (dormant) .. 100 (actively triggered)
  obsession_engagement: number;  // 0 (unused) .. 100 (frequently indulged)
  updated_at:            string;
}

// ── Reputation Titles (leaderboard) ─────────────────────────────────────────
// Distinct from companion_reputation's fame/notoriety score: titles are a
// small, contested, world-wide leaderboard — at most a handful of characters
// hold any one title at a time. See src/lib/universe/reputation-titles.ts.

export type ReputationTitleKey =
  | 'most_trusted' | 'most_influential' | 'most_loved' | 'most_feared'
  | 'most_generous' | 'most_mysterious' | 'most_admired' | 'most_notorious';

export interface CharacterTitle {
  id:            string;
  character_id:  string;
  title_key:     ReputationTitleKey;
  score:         number;
  awarded_at:    string;
  character?:    { id: string; name: string; image_url: string };
}

// ── Permanent World Impact ──────────────────────────────────────────────────
// A record of a user action (gift, milestone, decision) that was significant
// enough to leave a permanent mark on the character/world — not just a bond
// score bump. See src/lib/universe/world-impact.ts.

export type WorldImpactSource =
  | 'gift' | 'milestone' | 'decision' | 'betrayal' | 'confession' | 'sacrifice'
  // Written by repair-engine.ts once a pending SetBoundary rupture resolves.
  // 'rupture_repaired'  — user's next reply addressed it (acknowledged, apologized, or genuinely engaged).
  // 'rupture_unresolved'— user's next reply deflected or ignored it; logged so it's visible in
  //                       formatWorldImpactForPrompt() and doesn't just vanish from the character's memory.
  | 'rupture_repaired' | 'rupture_unresolved';

export interface WorldImpactEvent {
  id:            string;
  character_id:  string;
  user_id:       string;
  source:        WorldImpactSource;
  title:         string;
  description:   string;
  /**
   * Generic, never-quotes-user-text version of `description` — the only
   * one safe to render on a character's PUBLIC profile page. `description`
   * can contain a verbatim snippet of a specific user's private message
   * (a confession, a gift note) and must only ever be read server-side,
   * scoped to that same user's own request (see formatWorldImpactForPrompt).
   */
  public_summary: string;
  desire_axis?:  DesireAxis | null;  // which core-desire axis this fed, if any
  weight:        number;              // 0-100, mirrors universe_memory.emotional_weight
  memory_id?:    string | null;       // FK into universe_memory when it crossed the threshold to become world history
  created_at:    string;
}

// ── User Feeds ─────────────────────────────────────────────────────────────────

export interface UserFeedEntry {
  id:           string;
  user_id:      string;
  character_id: string;
  content:      string;
  entry_type:   OfflineEntryType;
  is_read:      boolean;
  created_at:   string;
}
