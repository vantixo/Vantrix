import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getShellSession } from "@/lib/frontend/session";
import { Sidebar } from "@/components/shell/sidebar";
import { MainOffset } from "@/components/shell/main-offset";
import { TopBar } from "@/components/shell/top-bar";
import { MobileDrawer } from "@/components/shell/mobile-drawer";
import { BottomNav } from "@/components/shell/bottom-nav";
import { ScrollChromeProvider } from "@/components/shell/scroll-chrome-context";
import { SessionErrorShell } from "@/components/shell/session-error-shell";
import { AnalyticsIdentify } from "@/lib/analytics/client";
import { NotificationCenterProvider } from "@/components/notifications/notification-center-provider";
import { PaywallProvider } from "@/components/paywall/paywall-provider";
import { getContactEmail, getDiscordUrl } from "@/lib/config/contact";
import { cn } from "@/lib/utils";

/**
 * IMMERSIVE-CHAT FIX (mobile oversize bug): a small set of full-bleed,
 * single-screen conversation surfaces are meant to be edge-to-edge, no
 * app chrome above or below them:
 *   - `/chat/<id>` (not `/chats`, the list, and not `/chat/<id>/memories`,
 *     a sub-page) — see chat-window.tsx's own height-calc comment, which
 *     already assumed only its own in-page header sits above it.
 *   - `/roleplay/<sessionId>` (not `/roleplay/new` or its own
 *     `/roleplay/new/<characterId>` scenario-setup step, both normal
 *     scrolling pages) — roleplay-stage.tsx's root is a literal `h-dvh`
 *     column with its own header/feed/composer inside that one box; it
 *     has always assumed it owns the *entire* viewport, not just the
 *     space left under a separate global header.
 * Neither assumption was ever actually enforced here: TopBar (h-16,
 * "renders at all breakpoints" per its own comment) rendered above
 * `{children}` on every route including these two, and BottomNav
 * (mobile, h-16+safe-area) reserved space below them. Stacked on top of
 * either screen's own full-height claim, that pushed total chrome past
 * 100dvh on mobile — the page had to scroll as a whole, and the composer
 * on both screens could end up fighting the fixed BottomNav for the same
 * strip of screen (on roleplay specifically, `sticky bottom-0` inside an
 * already-overflowing `h-dvh` box meant the send button could land
 * *underneath* the fixed BottomNav entirely, not just visually cramped).
 * Both routes opt out of TopBar/BottomNav entirely so each screen's own
 * height math is actually true. Any future full-bleed screen (a video-
 * call-style UI, say) belongs in this same list, not reinventing its own
 * chrome-hiding mechanism.
 */
function isImmersiveRoute(pathname: string): boolean {
  return (
    /^\/chat\/[^/]+\/?$/.test(pathname) ||
    /^\/roleplay\/(?!new\b)[^/]+\/?$/.test(pathname)
  );
}

/**
 * Shell for every authenticated route (Home, Chats, Characters, World,
 * Dating, Studio, Premium, Profile, Notifications, ...). Session check
 * happens once here via lib/frontend/session.ts (a direct Supabase call,
 * not a fetch to our own API — §10) so every child page gets the current
 * user "for free," matching how the directive describes the middleware's
 * cookie rotation already working.
 *
 * UX AUDIT FIX (item 1): getShellSession() can throw on a genuine
 * failure (network/auth-service blip), separately from returning null
 * for "no user." Those two cases need different handling — a thrown
 * error must not redirect a possibly-still-authenticated user to
 * /login, and (app)/error.tsx can't catch a throw from this same
 * segment's own layout, so an uncaught throw here previously took down
 * the entire document via global-error.tsx (losing Sidebar/TopBar for
 * every route, not just the failing one).
 *
 * 0.3.1 FIX: every route under this group used to redirect a signed-out
 * visitor to /login unconditionally — including "/" itself, which meant
 * the acquisition funnel (landing → character → guest → signup) never
 * had a first step: an unauthenticated visitor could never see Home at
 * all. Every other route ((app)/chats, /characters, /studio, ...) still
 * redirects exactly as before; only the bare root path is exempted, and
 * only into a *different* shell, not into unauthenticated access to
 * account-scoped chrome. Sidebar/TopBar/BottomNav all require
 * session.profile (TopBar takes it as a required prop; Sidebar/BottomNav
 * link to authenticated-only destinations), so a signed-out "/" swaps
 * them for PublicHeader — the same minimal header /discover, /about, and
 * every other standalone public page already use — rather than trying to
 * render authenticated chrome with no session. (app)/page.tsx itself
 * already degrades gracefully with no user (see its own HERO-REMOVED /
 * FAKE-DATA-FIX history) and now adds a logged-out hero pitch on top of
 * that for exactly this path.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let session: Awaited<ReturnType<typeof getShellSession>>;
  try {
    session = await getShellSession();
  } catch {
    return <SessionErrorShell />;
  }

  if (!session) {
    const pathname = (await headers()).get("x-pathname") ?? "/";
    if (pathname !== "/") {
      redirect(`/login?redirect=${encodeURIComponent(pathname)}`);
    }
    return (
      <PaywallProvider currentTier="free">
        <div className="min-h-screen bg-base">{children}</div>
      </PaywallProvider>
    );
  }

  // MFA STEP-UP GATE: password auth succeeded (session exists) but the
  // account has a verified TOTP factor this session hasn't verified yet
  // this login. Every route under this layout is account-scoped, so
  // there's nothing here a step-up shouldn't gate — redirect straight to
  // the challenge screen with a way back to wherever they were headed.
  // See lib/auth/mfa.ts's SCOPE NOTE for what this does and doesn't cover.
  if (session.mfaRequired) {
    const pathname = (await headers()).get("x-pathname") ?? "/";
    redirect(`/login/verify?redirect=${encodeURIComponent(pathname)}`);
  }

  const pathname = (await headers()).get("x-pathname") ?? "/";
  const immersive = isImmersiveRoute(pathname);

  // SIDEBAR-FOOTER-REAL-LINKS FIX: the drawer/rail footer's Discord and
  // Contact Us rows used to have nowhere to source a real destination
  // from inside a "use client" component. Fetched here, same
  // app_config-backed helpers home/footer.tsx already uses (so a rotated
  // discord_invite_url or contact_email picks up on both surfaces with
  // no separate edit), and passed down as plain props.
  const [discordUrl, contactEmail] = await Promise.all([
    getDiscordUrl(),
    getContactEmail(),
  ]);

  return (
    <PaywallProvider currentTier={session.profile.tier}>
      <div className={cn("flex bg-base", immersive ? "h-dvh overflow-hidden" : "min-h-screen")}>
        <AnalyticsIdentify userId={session.profile.id} />
        <NotificationCenterProvider
          userId={session.profile.id}
          initialUnreadCount={session.profile.unreadNotifications}
          initialRecent={session.profile.recentNotifications}
        />
        <Sidebar
          isAdmin={session.profile.isAdmin}
          tier={session.profile.tier}
          displayName={session.profile.displayName}
          username={session.profile.username}
          avatarUrl={session.profile.avatarUrl}
          discordUrl={discordUrl}
          contactEmail={contactEmail}
        />
        <MobileDrawer
          isAdmin={session.profile.isAdmin}
          tier={session.profile.tier}
          displayName={session.profile.displayName}
          username={session.profile.username}
          avatarUrl={session.profile.avatarUrl}
          tokens={session.profile.tokens}
          discordUrl={discordUrl}
          contactEmail={contactEmail}
        />
        {immersive ? (
          <MainOffset className="flex-1 flex flex-col min-w-0">
            <main className="flex-1 min-w-0 overflow-hidden">{children}</main>
          </MainOffset>
        ) : (
          <ScrollChromeProvider>
            <MainOffset className="flex-1 flex flex-col min-w-0">
              <TopBar profile={session.profile} />
              {/* BOTTOM-NAV-HEIGHT SYNC: matches BottomNav's own h-16
                  (restored 5-item Home/Chat/Feed/Studio/Premium bar) —
                  this reserves exactly that much space below page
                  content so the fixed bar doesn't overlap the last
                  section on any route. Must move together with that
                  component's height; a mismatch here means either a gap
                  above the bar or real content clipped underneath it. */}
              <main className="flex-1 min-w-0 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
                {children}
              </main>
            </MainOffset>
            <BottomNav />
          </ScrollChromeProvider>
        )}
      </div>
    </PaywallProvider>
  );
}
