/**
 * ensureProfile — single source of truth for "does this authed user have a
 * profiles row, and if not, create one."
 *
 * Called from two places: POST /api/profile/ensure (client-reachable,
 * used after signInWithPassword and after an immediate-session signUp)
 * and /auth/callback/route.ts (the server-side landing point once a
 * signup-confirmation or password-recovery email link is clicked). A
 * user with a valid session but a missing profiles row (interrupted
 * signup, manual deletion, etc.) can hit either path and get repaired —
 * without it, the client's fetchProfile() would find zero rows, silently
 * give up, and the app would treat a genuinely authenticated user as
 * signed out forever.
 *
 * Uses supabaseAdmin (service role) deliberately: this must succeed even
 * if the caller's RLS session is momentarily inconsistent, and it needs to
 * be callable from a route that only has a verified user id, not a full
 * cookie-bound session.
 */
import type { User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger }        from "@/lib/logger";
import { getClientIp }   from "@/lib/network/get-client-ip";
import { hashVisitor, attributeConversion } from "@/lib/referral-engine";
import { env }           from "@/env";

export type EnsuredProfile = {
  id:                   string;
  username:             string | null;
  avatar_url:           string | null;
  country:              string | null;
  currency:             string | null;
  tier:                 string;
  tokens:               number;
  daily_messages_used:  number;
  daily_messages_limit: number;
  gender:               string | null;
  created_at:           string;
};

const PROFILE_SELECT =
  "id,username,avatar_url,country,currency,tier,tokens,daily_messages_used,daily_messages_limit,gender,created_at";

const VALID_GENDERS = new Set(["male", "female", "non_binary", "prefer_not_to_say"]);

function generateUsername(user: User): string {
  const emailPrefix  = user.email?.split("@")[0]?.slice(0, 20) ?? "user";
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  return `${emailPrefix}_${randomSuffix}`;
}

/**
 * The signup form stores the user's chosen gender as `pending_gender` in
 * Supabase auth user_metadata (mirrors the `pending_dob` pattern used for
 * age verification) since a profiles row doesn't exist until this function
 * runs. OAuth users won't have this set — they're prompted in /profile
 * settings on first visit instead.
 *
 * NOTE (audit, 2026-08-20): nothing currently sets pending_gender —
 * login/page.tsx's signup form has no gender field. This read is
 * harmless dead capacity (always resolves to null today, same as the
 * OAuth case this comment already describes), left in place for whoever
 * wires gender collection into signup next, rather than removed and
 * having to be re-derived later.
 */
function pendingGender(user: User): string | null {
  const raw = user.user_metadata?.pending_gender;
  return typeof raw === "string" && VALID_GENDERS.has(raw) ? raw : null;
}

/**
 * Returns the user's profile, creating it first if it doesn't exist yet.
 * Idempotent and safe to call on every login, not just first signup —
 * uses upsert with ignoreDuplicates so a race between two concurrent
 * requests (e.g. two tabs signing in at once) can't produce a duplicate-key
 * error or clobber an existing row's tier/tokens.
 */
export async function ensureProfile(user: User): Promise<EnsuredProfile | null> {
  const { data: existing, error: readError } = await supabaseAdmin
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", user.id)
    .maybeSingle();

  if (readError) {
    logger.error("profile.ensure.read_failed", { userId: user.id, error: readError });
    return null;
  }

  if (existing) return existing as EnsuredProfile;

  const { error: insertError } = await supabaseAdmin
    .from("profiles")
    .upsert(
      {
        id:                   user.id,
        username:             generateUsername(user),
        currency:             "USD",
        tier:                 "free",
        tokens:               50,
        daily_messages_used:  0,
        daily_messages_limit: 20,
        gender:               pendingGender(user),
      },
      { onConflict: "id", ignoreDuplicates: true },
    );

  if (insertError) {
    logger.error("profile.ensure.insert_failed", { userId: user.id, error: insertError });
    return null;
  }

  logger.info("profile.ensure.created", { userId: user.id });

  const { data: created, error: refetchError } = await supabaseAdmin
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", user.id)
    .maybeSingle();

  if (refetchError || !created) {
    logger.error("profile.ensure.refetch_failed", { userId: user.id, error: refetchError });
    return null;
  }

  return created as EnsuredProfile;
}

/**
 * ensureProfile() + best-effort referral attribution, as one call.
 *
 * Extracted so both the client-reachable POST /api/profile/ensure route
 * (called from login/page.tsx after signInWithPassword / an
 * immediate-session signUp) and /auth/callback/route.ts (the server-side
 * landing point after a signup-confirmation or password-recovery email
 * link) share one implementation instead of hand-rolling the same
 * ip/user-agent -> visitorHash -> attributeConversion sequence twice.
 * A referral-engine hiccup never fails profile creation for the user —
 * same fail-open posture as the original inline version of this code.
 */
export async function ensureProfileWithReferralAttribution(
  user: User,
  req: NextRequest,
): Promise<EnsuredProfile | null> {
  const profile = await ensureProfile(user);
  if (!profile) return null;

  try {
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent") ?? "unknown";
    const visitorHash = hashVisitor(ip ?? "unknown", userAgent, env.IP_HASH_SALT);
    const attribution = await attributeConversion(supabaseAdmin, {
      newUserId: user.id,
      visitorHash,
    });
    if ("conversionId" in attribution) {
      logger.info("profile.ensure.referral_attributed", {
        userId: user.id,
        partnerId: attribution.partnerId,
      });
    }
  } catch (attributionError) {
    logger.error("profile.ensure.attribution_failed", { userId: user.id, error: attributionError });
  }

  return profile;
}
