/**
 * Roleplay System — shared types
 *
 * See supabase/migrations/20260940_roleplay_system.sql for the schema
 * these mirror, and src/lib/roleplay/engine.ts for the state machine that
 * moves a session through them.
 */

export type RoleplayTier = 'free' | 'premium';
export type RoleplaySessionStatus = 'active' | 'completed' | 'abandoned';
export type RoleplayBeatType = 'narration' | 'user_turn' | 'chapter_end';
export type RoleplayActionType = 'say' | 'do' | 'choice';

export interface RoleplayScenario {
  id:                string;
  slug:              string;
  title:             string;
  tagline:           string;
  genre:             string;
  tags:              string[];
  premise:           string;
  setting:           string;
  tone:              string;
  opening_narration: string;
  character_id:      string | null;
  chapter_count:     number;
  cover_image_url:   string | null;
  min_tier:          RoleplayTier;
  is_active:         boolean;
  sort_order:        number;
  like_count:        number;
  dislike_count:     number;
  /** world_locations.slug this scenario is scoped to, or null for universal/
   *  character-only scenarios. See 20261124_roleplay_world_faction_scenarios.sql. */
  location_slug:     string | null;
  /** factions.slug this scenario is scoped to, or null. Mutually exclusive
   *  with location_slug in practice (a scenario is written for one place),
   *  but not enforced at the DB level — either, both null, or (rare) both set. */
  faction_slug:      string | null;
}

export type RoleplayScenarioVote = 'like' | 'dislike' | null;

/**
 * Lightweight, extensible scene-state bag stored in roleplay_sessions.scene_state.
 * Deliberately not a deep simulation (contrast src/lib/universe/* world-state
 * engines) — just enough continuity for the narrator prompt to stay coherent
 * beat to beat: where things are, what mood they're in, what's been
 * established that shouldn't be contradicted.
 */
export interface RoleplaySceneState {
  location?:      string;
  timeOfDay?:      string;
  mood?:           string;
  /** Short facts the narrator has established and must stay consistent with
   *  (an item picked up, a promise made, a name learned). Capped at 12 by
   *  the engine — oldest dropped first — to keep the prompt bounded. */
  establishedFacts?: string[];
}

export interface RoleplayChoice {
  id:    string;
  label: string;
}

export interface RoleplayBeat {
  id:              string;
  session_id:      string;
  message_id:      string | null;
  beat_number:     number;
  chapter:         number;
  beat_type:       RoleplayBeatType;
  narrator_text:   string | null;
  action_type:     RoleplayActionType | null;
  choices:         RoleplayChoice[] | null;
  choice_selected: string | null;
  created_at:      string;
}

export interface RoleplaySession {
  id:                string;
  conversation_id:   string;
  user_id:           string;
  character_id:      string;
  scenario_id:       string;
  status:            RoleplaySessionStatus;
  current_chapter:   number;
  beat_count:        number;
  scene_state:       RoleplaySceneState;
  last_cliffhanger:  string | null;
  started_at:        string;
  updated_at:        string;
  completed_at:      string | null;
}

/** One rendered entry in the Story Mode feed — built server-side in the page
 *  by joining `messages` (exact text) with `roleplay_beats` (chapter/type/
 *  choices) on message_id. See lib/frontend/roleplay.ts. */
export interface RoleplayFeedItem {
  id:       string;
  role:     'user' | 'assistant';
  content:  string;
  chapter?: number;
  beatType?: RoleplayBeatType;
  choices?: RoleplayChoice[] | null;
}

/** Result of engine.advanceTurn() — what the API route hands back to the client. */
export interface RoleplayTurnResult {
  sessionId:        string;
  status:            RoleplaySessionStatus;
  chapter:           number;
  chapterCount:      number;
  beatNumber:        number;
  narrative:         string;
  choices:           RoleplayChoice[] | null;
  isChapterEnd:      boolean;
  isSessionComplete:  boolean;
}
