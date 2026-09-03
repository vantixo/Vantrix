import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { logger } from "@/lib/logger";

/**
 * Mirrors GET /api/profile/settings's select list exactly. That route
 * (not the leaner GET /api/profile) is the right source here since the
 * Settings page needs to pre-fill every field its own PATCH accepts —
 * bio, nsfw_enabled, gender, preferred_language — none of which the
 * lighter /api/profile response carries.
 */
export interface ProfileSettings {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  nsfw_enabled: boolean;
  country: string | null;
  gender: string | null;
  currency: string | null;
  tier: string;
  tokens: number;
  daily_messages_used: number;
  daily_messages_limit: number;
  created_at: string;
  preferred_language: string | null;
}

/**
 * RELIABILITY FIX: this previously round-tripped through fetchInternal ->
 * GET /api/profile/settings, built from NEXT_PUBLIC_APP_URL. That's a
 * real self-referential HTTP hop from inside the Next.js server process
 * back to itself, which breaks any time the configured origin doesn't
 * resolve to where the dev/prod server is actually listening (e.g.
 * NEXT_PUBLIC_APP_URL left at its localhost default while bound to
 * 127.0.0.1, or an IPv6 localhost resolution the server isn't listening
 * on) — and the failure was previously swallowed by an empty catch, so
 * it silently rendered "Couldn't load your profile" with no way to tell
 * the self-fetch had failed at the network layer rather than a real
 * missing-profile case. This is a plain per-user read gated by RLS
 * (auth.uid() = id), same category as getSubscriptionInfo below — no
 * request-shaping worth reimplementing — so it's a direct DB call per
 * §10, not a fetchInternal hop.
 */
export async function getProfileSettings(): Promise<ProfileSettings | null> {
  const { user } = await getAuthedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id,username,display_name,bio,avatar_url,nsfw_enabled,country,gender,currency,tier,tokens,daily_messages_used,daily_messages_limit,created_at,preferred_language"
    )
    .eq("id", user.id)
    .single();

  if (error || !data) {
    logger.error("getProfileSettings: profile lookup failed", {
      userId: user.id,
      error: error?.message,
      code: error?.code,
    });
    return null;
  }

  // `profiles.created_at` is nullable in the generated DB type (defaults
  // to now() at insert, but the column itself allows null), while every
  // consumer (Settings page's "Member since" display via formatDate())
  // expects a real string. A null here would mean the row was written
  // without going through the normal insert path — worth knowing about,
  // not worth crashing the settings page over.
  if (!data.created_at) {
    logger.error("getProfileSettings: profile row has null created_at", {
      userId: user.id,
    });
  }

  return { ...data, created_at: data.created_at ?? new Date().toISOString() };
}

export type SubscriptionProvider = "stripe" | "paystack" | "nowpayments" | "paddle";

export interface SubscriptionInfo {
  tier: string;
  provider: SubscriptionProvider | null;
  status: string | null;
  expiresAt: string | null;
}

/**
 * PROFILE GAP FIX — §11's Payments/Premium cluster has self-serve
 * cancel/manage routes (billing/portal for Stripe, billing/paystack/
 * cancel for Paystack) but nothing on the frontend ever told the user
 * which one applies to them, or surfaced a button to either. This is a
 * plain per-user read gated by the "subscriptions_own" RLS policy
 * (auth.uid() = user_id — see 20240101_production.sql), no request-
 * shaping in a hypothetical route to reimplement, so it's a direct lib
 * call per §10 — same category as getPremiumTiers/getTrialEligibility
 * and getProfileSettings above, all direct DB reads rather than
 * self-referential fetchInternal hops.
 *
 * A user can in principle have one subscriptions row per provider
 * (UNIQUE(user_id, provider)), but only one is ever meant to be active
 * at a time; picking the most recently created active row is the
 * correct "current plan" even in the edge case where a stale row from a
 * provider switch is still sitting there as 'cancelled'/'expired'.
 */
export async function getSubscriptionInfo(userId: string): Promise<SubscriptionInfo> {
  const supabase = await createClient();
  const [{ data: sub }, { data: profile }] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("provider,status,tier,expires_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("tier").eq("id", userId).maybeSingle(),
  ]);

  return {
    tier: profile?.tier ?? sub?.tier ?? "free",
    provider: (sub?.provider as SubscriptionProvider | undefined) ?? null,
    status: sub?.status ?? null,
    expiresAt: sub?.expires_at ?? null,
  };
}
