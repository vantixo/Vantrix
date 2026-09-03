// src/lib/access/character-gate.ts
//
// Single source of truth for "is this user allowed to receive a reply from
// this character". Every code path capable of producing a chat reply —
// /api/chat/stream, /api/queue/enqueue (+ the worker that actually runs the
// job), and /api/chat/guest — must call this before generating anything.
//
// Why this exists as one shared function instead of each route re-doing its
// own fetch + checkCharacterTierAccess() call: three call sites already
// existed with independently duplicated logic before this file was added,
// and one of them (guest chat) had silently never had the check at all.
// Duplicated security logic drifts — a future edit to one call site (a
// column rename, a new premium flag, a new tier) has no mechanism forcing
// it to also land in the other two. Routing everything through one
// function means there is only one place to get it right, and only one
// place a reviewer needs to check when auditing this gate.
import { supabaseAdmin }        from '@/lib/supabase/admin';
import { checkCharacterTierAccess, resolveEffectiveTier, type Tier } from '@/lib/rate-limit';
import { canAccessNSFW } from '@/lib/tiers/config';

export interface CharacterGateResult {
  allowed: boolean;
  reason?: string;
  tier:    Tier;
}

export interface ProfileForGate {
  tier?:     string | null;
  role?:     string | null;
  is_admin?: boolean | null;
}

/**
 * Single source of truth for "can this user receive a reply from an
 * is_nsfw character right now".
 *
 * PRODUCT DECISION (this revision): NSFW is no longer a paid-tier feature —
 * canAccessNSFW() in @/lib/tiers/config.ts now always returns true, so the
 * tier check that used to sit here has been removed. Three gates remain,
 * and none are about payment:
 *   1. Sign-in: a guest (userId === null) still can't reach mature content.
 *   2. Age verification: is_user_age_verified(userId) is queried against
 *      the DB-backed verification state (see supabase/migrations/
 *      20240500_age_verification.sql and src/lib/age-verification). This
 *      is the actual identity/age gate — being signed in is not enough.
 *   3. Preference: profiles.nsfw_enabled is a real opt-in the user sets in
 *      profile settings; it's never on by default.
 */
export async function checkMatureContentAccess(
  userId: string | null,
  isNsfw: boolean,
  tier: Tier = 'free',
): Promise<{ allowed: boolean; reason?: string }> {
  if (!isNsfw) return { allowed: true };

  if (!userId) {
    return {
      allowed: false,
      reason:  'This character has mature content — please sign in to continue',
    };
  }

  if (!canAccessNSFW(tier)) {
    return {
      allowed: false,
      reason:  'This character has mature content and is currently unavailable',
    };
  }

  // Authoritative age-verification check. Being signed in is not the same
  // as being verified 18+: without this call, the gate below was only
  // checking "authenticated + nsfw_enabled", which any signed-in user
  // (including an unverified or rejected one) could satisfy themselves in
  // profile settings. is_user_age_verified() is the DB-backed source of
  // truth written by the age-verification flow (src/lib/age-verification)
  // and must be consulted here, not just profiles.nsfw_enabled.
  const { data: isAgeVerified, error: ageVerifiedError } = await supabaseAdmin
    .rpc('is_user_age_verified', { p_user_id: userId });

  if (ageVerifiedError || isAgeVerified !== true) {
    return {
      allowed: false,
      reason:  'This character has mature content — please complete age verification to continue',
    };
  }

  const { data: profileRecord } = await supabaseAdmin
    .from('profiles')
    .select('nsfw_enabled')
    .eq('id', userId)
    .maybeSingle();

  const nsfwEnabled = profileRecord?.nsfw_enabled === true;

  if (!nsfwEnabled) {
    return {
      allowed: false,
      reason:  'This character has mature content — enable mature content in your profile settings to continue',
    };
  }

  return { allowed: true };
}

/**
 * Shared "can this user see NSFW content in a listing/discovery surface"
 * check — distinct from checkMatureContentAccess() above, which gates a
 * single already-identified character's chat reply. This one is for
 * surfaces that decide up front whether to include is_nsfw rows at all
 * (character search, recommendations, discover/featured, dating deck/
 * matches/world).
 *
 * P0-AGE-GATE-FIX: every one of those surfaces previously computed this
 * as `profile?.nsfw_enabled === true` — the user preference only, with a
 * comment noting "age is collected once at signup and is not re-checked
 * here". That meant an authenticated user could see (and start chats with,
 * generate images of, get matched with) NSFW characters purely by flipping
 * a settings toggle, with zero server-side check that they're actually a
 * verified adult. chat/stream, queue/enqueue, and dating/swipe already did
 * this correctly via checkMatureContentAccess() — this function brings the
 * listing-level surfaces up to the same standard so there's one gate
 * instead of two different (and differently correct) implementations of
 * "can this user get NSFW content".
 *
 * Guests (userId === null) always return false without a DB round-trip.
 */
export async function resolveNsfwDiscoveryAccess(userId: string | null): Promise<boolean> {
  if (!userId) return false;

  const { data: isAgeVerified, error: ageVerifiedError } = await supabaseAdmin
    .rpc('is_user_age_verified', { p_user_id: userId });

  if (ageVerifiedError || isAgeVerified !== true) return false;

  const { data: profileRecord } = await supabaseAdmin
    .from('profiles')
    .select('nsfw_enabled')
    .eq('id', userId)
    .maybeSingle();

  return profileRecord?.nsfw_enabled === true;
}

/**
 * Character-slot gate: enforces TIERS[tier].limits.characterSlots (config.ts),
 * which is advertised on the pricing page ("5 characters", "15 characters",
 * etc.) but — before this — was never checked anywhere server-side. Since
 * conversations are 1:1 with (user_id, character_id) (see the DB unique
 * constraint conversations relies on), "character slots used" is exactly
 * "distinct conversations this user has". Resuming an existing conversation
 * never consumes a new slot; only starting one with a character the user has
 * never talked to does.
 *
 * Callers should call this BEFORE upserting a new conversation row, and
 * skip it entirely when a conversation for this (user, character) pair is
 * already known to exist.
 */
/**
 * Character-slot gate.
 *
 * PRODUCT DECISION (this revision): character slots are no longer tier-
 * limited — every account, paid or not, can talk to unlimited characters.
 * TIERS[tier].limits.characterSlots in config.ts is left in place for any
 * remaining display/copy purposes, but is no longer enforced here. Kept as
 * a real function (not deleted) so existing call sites — which still pass
 * userId/tier and destructure {allowed, used, limit} — compile and behave
 * unchanged; `used`/`limit` are still real numbers for any UI that displays
 * them, only `allowed` is now unconditionally true.
 */
export async function checkCharacterSlotAvailable(
  userId: string,
  tier: Tier,
): Promise<{ allowed: boolean; reason?: string; used: number; limit: number }> {
  // Single-plan model: character slots are unlimited for every account,
  // paid or not — was TIERS[tier].limits.characterSlots (always 99999
  // anyway), simplified to a constant so this doesn't need to index TIERS
  // with legacy Tier strings (basic/premium/elite/enterprise) that no
  // longer exist as TierId entries.
  const limit = 99999;

  const { count } = await supabaseAdmin
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  const used = count ?? 0;
  return { allowed: true, used, limit };
}

/**
 * Authenticated path: resolves effective tier (admin-aware) from an
 * already-fetched profile row, fetches the character fresh from the DB
 * (never trust a client- or job-supplied min_tier/is_premium), and checks
 * access. Always re-fetches the character server-side — a caller can't
 * accidentally pass in stale or attacker-supplied character metadata.
 */
export async function checkCharacterAccessForProfile(
  characterId: string,
  userId:      string,
  profile:     ProfileForGate | null | undefined,
): Promise<CharacterGateResult> {
  const tier = resolveEffectiveTier(profile ?? {});
  return checkCharacterAccessForTier(characterId, tier, userId);
}

/** Guest / unauthenticated path: always evaluated at the 'free' tier — the
 *  floor of the tier ladder — so a guest is blocked from exactly the same
 *  set of characters a signed-in free user would be blocked from, never
 *  more, never less. Also never eligible for is_nsfw characters — see
 *  checkMatureContentAccess. */
export async function checkCharacterAccessForGuest(characterId: string): Promise<CharacterGateResult> {
  return checkCharacterAccessForTier(characterId, 'free', null);
}

async function checkCharacterAccessForTier(
  characterId: string,
  tier: Tier,
  userId: string | null,
): Promise<CharacterGateResult> {
  const { data: character } = await supabaseAdmin
    .from('characters')
    .select('is_premium,min_tier,is_nsfw')
    .eq('id', characterId)
    .maybeSingle();

  // No row / not found is not this function's problem to report — callers
  // already 404 separately when they need the full character row anyway.
  // Treat "can't confirm the gate" as "don't block" here so this function
  // never becomes a way to 403 a request that's actually going to 404.
  if (!character) return { allowed: true, tier };

  const gate = checkCharacterTierAccess(
    tier,
    character.min_tier as Tier | null | undefined,
    !!character.is_premium,
  );
  if (!gate.allowed) return { allowed: false, reason: gate.reason, tier };

  const matureGate = await checkMatureContentAccess(userId, !!character.is_nsfw, tier);
  if (!matureGate.allowed) return { allowed: false, reason: matureGate.reason, tier };

  return { allowed: true, tier };
}
