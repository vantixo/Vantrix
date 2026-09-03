/**
 * Vantrix — Legacy Systems Types
 * Status · Legends · Scarcity · Visual Identity · World History
 */

export type WealthTier = 'destitute' | 'struggling' | 'modest' | 'comfortable' | 'wealthy' | 'rich' | 'magnate';

export interface CharacterAttributes {
  id:                   string;
  character_id:         string;
  health:               number;
  confidence:           number;
  net_worth:            number;
  wealth_tier:          WealthTier;
  skills:               Record<string, number>;
  addictions:           string[];
  overcome_addictions:  string[];
  political_view:       string;
  updated_at:           string;
}

export type StatusTier =
  | 'unknown_citizen' | 'skilled_professional' | 'regional_celebrity'
  | 'city_leader' | 'corporate_magnate' | 'faction_commander'
  | 'global_icon' | 'living_legend';

export interface SocialStatus {
  id:            string;
  character_id:  string;
  status_tier:   StatusTier;
  status_score:  number;
  computed_at:   string;
  character?:    { id: string; name: string; image_url: string; };
}

export type LegendType = 'wealth' | 'discovery' | 'political' | 'military' | 'cultural' | 'reputation' | 'founder' | 'tragic';

export interface Legend {
  id:            string;
  character_id:  string;
  legend_title:  string;
  legend_type:   LegendType;
  biography:     string;
  criteria_met:  Record<string, unknown>;
  declared_at:   string;
  active:        boolean;
  character?:    { id: string; name: string; image_url: string; };
}

export type AssetType = 'artifact' | 'title' | 'office' | 'property' | 'relic' | 'seat';
export type AssetRarity = 'rare' | 'epic' | 'legendary' | 'unique';

export interface ScarceAsset {
  id:                   string;
  name:                 string;
  description:          string;
  asset_type:           AssetType;
  rarity:               AssetRarity;
  holder_character_id:  string | null;
  location_id:          string | null;
  history:              string[];
  acquired_at:          string | null;
  created_at:           string;
  updated_at:           string;
  holder?:              { id: string; name: string; image_url: string; };
  location?:            { id: string; name: string; slug: string; };
}

export interface TimelineEntry {
  source:       string;
  event_type:   string;
  title:        string;
  description:  string;
  location_id:  string | null;
  significance: number;
  occurred_at:  string;
}

export interface BiographyEntry {
  source:       'career' | 'life' | 'event';
  description:  string;
  occurred_at:  string;
}

// ── Market Value & Rarity ────────────────────────────────────────────────────
export type RarityTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export const RARITY_TIER_LABELS: Record<RarityTier, string> = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare',
  epic: 'Epic', legendary: 'Legendary', mythic: 'Mythic',
};

export const RARITY_TIER_PERCENTILE_FLOOR: Record<RarityTier, number> = {
  common: 0, uncommon: 50, rare: 75, epic: 90, legendary: 97, mythic: 99.5,
};

export const RARITY_TIER_POPULATION_CAP: Record<RarityTier, number> = {
  common: 1, uncommon: 0.35, rare: 0.15, epic: 0.06, legendary: 0.02, mythic: 0.005,
};

export interface MarketValueSignals {
  like_count:      number;
  follower_count:  number;
  total_swipes:    number;
  unique_chatters: number;
  message_volume:  number;
  gifts_received:  number;
  recency_factor:  number;
}

export interface CharacterMarketValue {
  character_id:  string;
  value_score:   number;
  percentile:    number;
  rarity_tier:   RarityTier;
  previous_tier: RarityTier | null;
  value_history: { at: string; score: number; tier: RarityTier }[];
  signals:       MarketValueSignals;
  computed_at:   string;
  created_at:    string;
  character?:    { id: string; name: string; image_url: string; };
}

export interface MarketValueTickResult {
  characters_evaluated: number;
  tier_changes:         number;
}

export interface StatusTickResult {
  characters_evaluated: number;
  tier_changes:          number;
  legends_declared:      number;
  history_recorded:      number;
}

export const STATUS_TIER_LABELS: Record<StatusTier, string> = {
  unknown_citizen:      'Unknown Citizen',
  skilled_professional: 'Skilled Professional',
  regional_celebrity:   'Regional Celebrity',
  city_leader:          'City Leader',
  corporate_magnate:    'Corporate Magnate',
  faction_commander:    'Faction Commander',
  global_icon:          'Global Icon',
  living_legend:        'Living Legend',
};

export const STATUS_TIER_THRESHOLDS: Record<StatusTier, number> = {
  unknown_citizen:      0,
  skilled_professional: 150,
  regional_celebrity:   400,
  city_leader:          700,
  corporate_magnate:    1000,
  faction_commander:    1300,
  global_icon:          1700,
  living_legend:        2200,
};

export const LEGEND_TYPE_LABELS: Record<LegendType, string> = {
  wealth:     'Wealth',
  discovery:  'Discovery',
  political:  'Political',
  military:   'Military',
  cultural:   'Cultural',
  reputation: 'Reputation',
  founder:    'Founder',
  tragic:     'Tragic',
};
