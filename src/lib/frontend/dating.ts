import "server-only";
import { fetchInternal } from "./api";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import {
  getMatchesForUser,
  getGiftCatalogueAndHistory,
  getChemistryForMatch,
  getForecastForMatch,
  getCompatibilityForMatch,
  getPrestigeForMatch,
  getActiveDateSessionForMatch,
} from "@/lib/dating/get-match-detail";

/**
 * ROOT-CAUSE FIX (2026-08-25): every function below that backs the match
 * detail page (getDatingMatches/getDatingMatch, getGiftShop, getChemistry,
 * getForecast, getCompatibility, getPrestigeStatus, getActiveDateSession)
 * used to go through fetchInternal() — an HTTP self-fetch back to this same
 * `next dev` process. That's the exact self-fetch architecture
 * lib/dating/get-world-home.ts's header comment already diagnosed and fixed
 * for the "Your World" page (next.config.js's single-worker dev compiler
 * makes a Server Component's self-fetch to its own on-demand-compiled API
 * route lose the race for that worker). Here it surfaced as
 * (app)/dating/match/[id]/page.tsx's "This match couldn't be loaded" error
 * state firing on effectively every visit, plus the
 * chemistry/forecast/compatibility/prestige/gift/date sections silently
 * disappearing. Each function now resolves the authed user itself (cheap —
 * getAuthedUser() reads the header middleware already forwarded, no extra
 * network round trip) and calls the shared lib/dating/get-match-detail.ts
 * function directly, in-process — no HTTP hop, nothing that can lose the
 * single-worker race. getWorldHome() below is untouched: it's already
 * unused (dating/page.tsx calls getDatingWorldHome() directly per its own
 * 2026-08-23 fix) and out of scope here.
 */
async function requireUserId(): Promise<string> {
  const { user } = await getAuthedUser();
  if (!user) throw new Error("fetchInternal: no authenticated user");
  return user.id;
}

/**
 * Types mirror GET /api/dating/matches and GET /api/dating/gifts exactly
 * (see those route handlers, and lib/dating/get-match-detail.ts, for the
 * source of truth — the non-trivial logic behind both, NSFW re-gating at
 * read time, milestone enrichment, tier-lock computation, now lives in
 * that shared file so both the route and this in-process call share one
 * implementation rather than drifting).
 */
export interface DatingMatchCharacter {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  description: string | null;
  image_url: string | null;
  tags: string[] | null;
  love_language: string | null;
  archetype: string | null;
  opening_line: string | null;
  is_nsfw: boolean | null;
}

export interface DatingMilestone {
  match_id: string;
  milestone_type: string;
  created_at: string;
}

export interface DatingMatch {
  id: string;
  compatibility_pct: number | null;
  match_tier: string | null;
  bond_score: number;
  milestones: number | null;
  last_interaction: string | null;
  streak_days: number | null;
  character_mood: string | null;
  created_at: string;
  character: DatingMatchCharacter | null;
  milestones_log: DatingMilestone[];
}

export interface GiftCatalogueItem {
  type: string;
  name: string;
  emoji: string;
  bond: number;
  tokens: number;
  tier: string;
  rarity: "common" | "special" | "legendary";
}

export interface DatingGiftHistoryEntry {
  id: string;
  match_id: string;
  gift_type: string;
  message: string | null;
  created_at: string;
}

export async function getDatingMatches(): Promise<DatingMatch[]> {
  const userId = await requireUserId();
  const matches = await getMatchesForUser(userId);
  return matches as unknown as DatingMatch[];
}

export async function getDatingMatch(id: string): Promise<DatingMatch | null> {
  // No dedicated GET /api/dating/matches/[id] route exists (see §11's
  // route map) — the list is small per-user and already fully enriched,
  // so filtering it here avoids adding a new backend route for a frontend
  // convenience that doesn't change any data-shaping rule.
  const matches = await getDatingMatches();
  return matches.find((m) => m.id === id) ?? null;
}

export async function getGiftShop(matchId: string): Promise<{
  catalogue: GiftCatalogueItem[];
  history: DatingGiftHistoryEntry[];
}> {
  const userId = await requireUserId();
  const result = await getGiftCatalogueAndHistory(userId, matchId);
  if (!result) throw new Error(`getGiftShop: match ${matchId} not found`);
  return result as unknown as { catalogue: GiftCatalogueItem[]; history: DatingGiftHistoryEntry[] };
}

/**
 * Types mirror computeChemistryDimensions()'s return shape in
 * src/lib/ai/chemistry-dimensions.ts exactly — see that file for the
 * source of truth on what each 0-100 dimension measures.
 */
export interface ChemistryDimensions {
  conversation: number;
  emotionalDepth: number;
  humor: number;
  playfulness: number;
  intellectual: number;
  adventure: number;
  affection: number;
  directness: number;
  mystery: number;
  engagement: number;
  progression: number;
  pacing: "slow_burn" | "steady" | "fast";
  headline: {
    chemistry: number;
    conversation: number;
    attraction: number;
  };
  reason: string;
}

export async function getChemistry(
  matchId: string
): Promise<ChemistryDimensions | null> {
  try {
    const userId = await requireUserId();
    const dimensions = await getChemistryForMatch(userId, matchId);
    return dimensions as ChemistryDimensions | null;
  } catch {
    // Match not found / not yet enough signal — section is simply omitted
    // rather than breaking the page, matching getDatingMatch's null pattern.
    return null;
  }
}

/**
 * Mirrors RelationshipForecast in src/lib/dating/engine.ts. Dimensions are
 * deliberately qualitative strings, not numbers — see that file's comment
 * on keeping forecast language hedged rather than risking invented
 * behavioral claims.
 */
export interface RelationshipForecast {
  connectionLevel: "new" | "building" | "strong" | "deep";
  headline: string;
  dimensions: {
    conversation: string;
    emotionalConnection: string;
    sharedInterests: string;
    pacing: string;
  };
  strengthens: string[];
  friction: string[];
  disclaimer: string;
}

export async function getForecast(
  matchId: string
): Promise<RelationshipForecast | null> {
  try {
    const userId = await requireUserId();
    const forecast = await getForecastForMatch(userId, matchId);
    return forecast as RelationshipForecast | null;
  } catch {
    return null;
  }
}

/**
 * Mirrors GET /api/dating/world's response exactly — the "Your World"
 * dating home surface (Tonight's Match, Unexpected Chemistry, active
 * relationships, recent moments, dates, recommended candidates).
 */
export interface DatingWorldRelationship {
  id: string;
  bond_score: number;
  match_tier: string;
  streak_days: number;
  character_mood: string;
  last_interaction: string | null;
  character: {
    id: string;
    name: string;
    image_url: string | null;
    is_nsfw: boolean | null;
  } | null;
}

export interface DatingWorldMoment {
  id: string;
  character_id: string;
  moment_type: string;
  title: string;
  created_at: string;
  character?: { name: string } | null;
}

export interface DatingWorldCandidate {
  id: string;
  name: string;
  age: number;
  gender: string;
  description: string;
  image_url: string;
  tags: string[];
  is_premium: boolean;
  min_tier?: string;
  is_new: boolean;
  tokens_cost: number;
  archetype?: string;
  opening_line?: string;
  score: number;
  reason: string;
  patternScore: number;
}

export interface DatingWorldDateSession {
  id: string;
  match_id: string;
  character_id: string;
  date_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  character: {
    id: string;
    name: string;
    image_url: string | null;
    is_nsfw: boolean | null;
  } | null;
}

export interface DatingWorldHome {
  relationships: DatingWorldRelationship[];
  recentMoments: DatingWorldMoment[];
  tonightsMatch: DatingWorldCandidate | null;
  unexpectedChemistry: (DatingWorldCandidate & { reason: string }) | null;
  recommended: DatingWorldCandidate[];
  dates: {
    active: DatingWorldDateSession[];
    recent: DatingWorldDateSession[];
  };
  /** RETENTION-01: whether the current user gets the full Tonight's Match
   *  reveal (premium/admin) or the locked teaser (free) — see
   *  getDatingWorldHome()'s isPremium comment for why this is presentation
   *  gating, not a data-secrecy boundary. */
  isPremium: boolean;
}

/** Mirrors GET /api/dating/compatibility's response shape. */
export interface CompatibilityResult {
  score: number;
  previousScore: number;
  delta: number;
  recomputed: boolean;
  factors: Record<string, number> | null;
  nextRecomputeIn: number;
  message: string | null;
}

export async function getCompatibility(
  matchId: string
): Promise<CompatibilityResult | null> {
  try {
    const userId = await requireUserId();
    const result = await getCompatibilityForMatch(userId, matchId);
    return result as CompatibilityResult | null;
  } catch {
    // Same fail-soft pattern as getChemistry/getForecast — the static
    // compatibility_pct already shown from the match row is enough of a
    // fallback that a dynamic-recompute failure shouldn't break the page.
    return null;
  }
}

/** Mirrors GET /api/dating/prestige's response shape. */
export interface PrestigeStatus {
  inPrestige: boolean;
  isSoulmate: boolean;
  chapter: {
    id: string;
    number: number;
    title: string;
    theme: string;
    description: string;
    duration: string;
    totalBeats: number;
  } | null;
  currentBeat: {
    id: string;
    day: number;
    title: string;
    description: string;
    beatIndex: number;
  } | null;
  nextChapter: { number: number; title: string; theme: string } | null;
  unlocksAt: { tier: string; bond: number } | null;
}

export async function getPrestigeStatus(
  matchId: string
): Promise<PrestigeStatus | null> {
  try {
    const userId = await requireUserId();
    const result = await getPrestigeForMatch(userId, matchId);
    return result as PrestigeStatus | null;
  } catch {
    return null;
  }
}

/** Mirrors GET /api/dating/date/active's response shape. */
export interface ActiveDateSession {
  id: string;
  date_type: string;
  opening_scene: string;
  status: string;
  created_at: string;
}

export async function getActiveDateSession(
  matchId: string
): Promise<ActiveDateSession | null> {
  try {
    const userId = await requireUserId();
    const session = await getActiveDateSessionForMatch(userId, matchId);
    return session as ActiveDateSession | null;
  } catch {
    return null;
  }
}

export async function getWorldHome(): Promise<DatingWorldHome> {
  // Route itself always returns 200 with safe empty defaults on internal
  // error (see world/route.ts's catch block) — no try/catch needed here,
  // but fetchInternal still throws on a genuine transport/auth failure,
  // so the page calling this should treat a thrown error as "world is
  // unavailable right now" rather than crash the whole shell.
  return fetchInternal<DatingWorldHome>("/api/dating/world");
}
