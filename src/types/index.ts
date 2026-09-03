// ── Canonical tier type (matches DB CHECK constraint and rate-limit) ──────────
export type TierSlug = 'free' | 'spark' | 'basic' | 'premium' | 'elite' | 'enterprise';

export interface Character {
  id: string;
  name: string;
  age: number;
  gender: 'female' | 'male' | 'anime';
  category: string;
  description: string;
  image_url: string;
  /** Looping living-portrait animation URL, null until generated — see AnimatedPortrait. */
  video_url?: string | null;
  tags: string[];
  creator_id?: string | null;
  is_premium: boolean;
  /** Real per-character tier gate — see checkCharacterTierAccess(). 'elite'/'enterprise' = true VIP-exclusive. */
  min_tier?: TierSlug;
  is_new: boolean;
  is_live: boolean;
  active?: boolean;
  is_public?: boolean;
  moderation_status?: string;
  moderation_note?: string | null;
  tokens_cost: number;
  created_at: string;
  // Dating attributes
  love_language?:   string;
  archetype?:       string;
  opening_line?:    string;
  dating_enabled?:  boolean;
  char_openness?:   number;
  char_warmth?:     number;
  char_adventure?:  number;
  char_depth?:      number;
  // Admin-uploaded media (see 20260717_character_media_gallery.sql) —
  // distinct from video_url above, which is the Fal Animate living-portrait
  // loop specifically, not an uploaded clip.
  intro_video_url?:    string | null;
  gallery_image_urls?: string[];
  gallery_video_urls?: string[];
  like_count?: number;
  follower_count?: number;
  // Market value / rarity — populated via join with character_market_value
  // where the query opts in (see use-characters.ts). Absent = not yet
  // computed (new character) or query didn't join it; treat as 'common'.
  rarity_tier?: import('./legacy-systems').RarityTier;
  value_score?: number;
}

// Kept in sync with the real source of truth, src/lib/dating/engine.ts's
// MatchTier (see that file's 2026-08-24 WIRE-FIX comment) — this export
// itself has no current importers (only `Character` is ever pulled from
// this barrel), but a stale duplicate is exactly the kind of drift that
// causes confusion later, so it isn't left behind out of sync.
export type MatchTier    = 'spark' | 'flame' | 'deep' | 'soulmate';
export type CharacterMood = 'happy' | 'playful' | 'romantic' | 'nostalgic' | 'vulnerable' | 'excited' | 'mysterious';

export interface DatingMatch {
  id:                string;
  user_id:           string;
  character_id:      string;
  compatibility_pct: number;
  match_tier:        MatchTier;
  bond_score:        number;
  milestones:        number;
  last_interaction?: string;
  streak_days:       number;
  character_mood:    CharacterMood;
  created_at:        string;
  character?:        Character;
}

export interface DatingGift {
  id:          string;
  gift_type:   string;
  gift_name:   string;
  bond_bonus:  number;
  token_cost:  number;
  message?:    string;
  created_at:  string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'gift';
  content: string;
  image_url?: string | null;
  video_url?: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  character_id: string;
  title: string;
  last_message_at: string;
  created_at: string;
  character?: Character;
}

export interface Profile {
  id: string;
  username: string;
  display_name?: string;
  bio?: string;
  avatar_url?: string;
  nsfw_enabled: boolean;
  country?: string;
  currency: string;
  tier: TierSlug;
  tokens: number;
  daily_messages_used: number;
  daily_messages_limit: number;
  gender?: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say' | null;
  created_at: string;
  /**
   * Admin flags — mirrors the two-condition OR logic the DB's own
   * is_admin() SQL function (used by every RLS policy) has always used:
   * role === 'admin' OR is_admin === true. Selected client-side purely so
   * the UI can decide whether to show an Admin nav entry point at all; the
   * actual authorization check still happens server-side in requireAdmin().
   */
  role?: string | null;
  is_admin?: boolean | null;
}

export interface Ad {
  id: string;
  title: string;
  image_url: string;
  link: string;
  position: 'hero' | 'sidebar' | 'inline';
  active: boolean;
  impressions: number;
  clicks: number;
  created_by: string;
  created_at: string;
}

export interface Tier {
  id: string;
  name: string;
  // Widened from TierSlug: annual catalog rows use a '_annual' suffixed
  // slug (e.g. 'spark_annual') that only exists in the `tiers` pricing
  // table, never in profiles.tier — base_tier_slug below is the value
  // that actually drives feature-gating.
  slug: TierSlug | `${TierSlug}_quarterly` | `${TierSlug}_annual`;
  price_usd: number;
  price_ngn: number;
  price_crypto: number;
  features: string[];
  daily_message_limit: number;
  can_create_characters: boolean;
  tokens_per_month: number;
  /** 'monthly' | 'quarterly' | 'annual' — which cadence this catalog row represents. */
  billing_interval?: 'monthly' | 'quarterly' | 'annual';
  /** For quarterly/annual rows: the base gating slug (e.g. 'spark_annual' -> 'spark').
   *  Equal to slug itself on monthly rows. */
  base_tier_slug?: TierSlug;
}

export interface PaymentIntent {
  id: string;
  provider: 'stripe' | 'paystack' | 'nowpayments' | 'paddle';
  amount: number;
  currency: string;
  status: 'pending' | 'success' | 'failed';
  metadata: Record<string, string>;
  created_at: string;
}

export type Locale = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ja' | 'zh' | 'ar' | 'hi' | 'ru';

// ── Community ──────────────────────────────────────────────────────────────────
export type { Community, CommunityPost, CommunityReply, CommunityType, DiscussionSort } from './community';
