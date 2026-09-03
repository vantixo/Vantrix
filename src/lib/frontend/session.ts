import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAalStatus } from "@/lib/auth/mfa";
import { isAdminProfile } from "@/lib/auth/admin";
import type { NotificationItem } from "./notifications";

export interface ShellProfile {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  tier: string;
  tokens: number;
  /** Drives the sidebar's admin-only nav entry (see nav-config.ts's
   *  ADMIN_NAV_ITEM). Computed via the same role/is_admin check every
   *  other admin gate in the codebase uses — see lib/auth/admin.ts's
   *  history of this check being re-derived incorrectly at other call
   *  sites. This is UI visibility only; /admin's own layout still does
   *  the real requireAdmin() enforcement server-side regardless of what
   *  this says. */
  isAdmin: boolean;
  unreadNotifications: number;
  /** Seeds the notification bell dropdown's initial paint (see
   *  NotificationCenterProvider) — most recent 8, any read state, newest
   *  first. Kept small: this rides along on every navigation via the
   *  shell layout, unlike the full paginated list on /notifications. */
  recentNotifications: NotificationItem[];
}

/**
 * Server Component data fetch — per FRONTEND_DIRECTIVE §10, Server
 * Components call lib functions directly rather than hitting our own
 * /api routes over HTTP. Used once in the (app) layout to drive the
 * auth guard, top bar avatar/token display, and the notification badge
 * count, so every page under the shell gets it "for free" the same way
 * the directive describes session cookies working.
 *
 * PERF (2026-08-26, whole-app pass): wrapped with React's `cache()` —
 * this was called once per request via the layout as documented above,
 * but 4 pages (dating/match/[id], profile/tokens, premium, digital-twin)
 * also call it a second time directly for their own use of `.profile`.
 * Unlike getAuthedUser's fast path, this one has no header-trust
 * shortcut — every call is a real `supabase.auth.getUser()` network
 * round trip (80-300ms) PLUS 3 more DB queries (profile, unread count,
 * recent notifications), so those 4 pages were paying that full cost
 * twice per request. cache() collapses repeat calls within the same
 * request/render tree into one — same data (this request's snapshot
 * either way), one round trip instead of two.
 */
async function getShellSessionUncached(): Promise<{
  profile: ShellProfile;
  /**
   * True when this session is authenticated at aal1 but the account has
   * a verified MFA factor requiring aal2 — i.e. password was correct but
   * the TOTP step-up hasn't happened yet this session. (app)/layout.tsx
   * is the sole enforcement point (see lib/auth/mfa.ts's SCOPE NOTE);
   * every other caller of getShellSession renders underneath that same
   * layout, so by the time they run this is already false.
   */
  mfaRequired: boolean;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Same hydrated client/session getUser() just populated — no extra
  // round trip (see getAalStatus's own doc comment).
  const { mfaRequired } = await getAalStatus(supabase);

  const [{ data: profile }, { count: unread }, { data: recentNotifications }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,username,display_name,avatar_url,tier,tokens,role,is_admin")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
    supabase
      .from("notifications")
      .select("id,type,title,body,cta_url,icon,urgency,metadata,read_at,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return {
    profile: {
      id: user.id,
      username: profile?.username ?? null,
      displayName: profile?.display_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      tier: profile?.tier ?? "free",
      tokens: profile?.tokens ?? 0,
      isAdmin: isAdminProfile(profile),
      unreadNotifications: unread ?? 0,
      recentNotifications: (recentNotifications ?? []) as NotificationItem[],
    },
    mfaRequired,
  };
}

export const getShellSession = cache(getShellSessionUncached);
