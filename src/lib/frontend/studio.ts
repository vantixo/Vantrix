import "server-only";
import { fetchInternal } from "./api";

/**
 * §11: characters/mine, characters/market -> Studio (creation/training).
 * Both routes do real shaping (ownership-scoped select, leaderboard
 * ranking/filtering) rather than a thin passthrough, so per §10 these go
 * through fetchInternal rather than a direct query.
 */
export interface MyCharacter {
  id: string;
  name: string;
  image_url: string | null;
  category: string;
  active: boolean;
  is_public: boolean;
  moderation_status: string;
  moderation_note: string | null;
  created_at: string;
}

export interface MarketCharacter {
  character_id: string;
  name: string;
  image_url: string | null;
  value_score: number;
  percentile: number;
  rarity_tier: string;
  computed_at: string;
}

export async function getMyCharacters(): Promise<MyCharacter[]> {
  try {
    const body = await fetchInternal<{ characters: MyCharacter[] }>(
      "/api/characters/mine"
    );
    return body.characters ?? [];
  } catch {
    return [];
  }
}

export async function getMarketLeaderboard(): Promise<MarketCharacter[]> {
  try {
    const body = await fetchInternal<{ characters: MarketCharacter[] }>(
      "/api/characters/market?limit=30"
    );
    return body.characters ?? [];
  } catch {
    return [];
  }
}
