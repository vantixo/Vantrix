"use client";

import { useEffect } from "react";
import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { usePathname, useRouter } from "next/navigation";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Crown,
  Gift,
  LogOut,
  Bell,
  Hash,
  Mail,
  LifeBuoy,
} from "lucide-react";
import { NAV_ITEMS, ADMIN_NAV_ITEM } from "./nav-config";
import { useShellStore } from "./shell-store";
import { useNotificationStore } from "@/lib/notifications/store";
import { useMediaQuery } from "@/hooks/use-media-query";
import { NavLink, isNavItemActive } from "@/components/ui/nav-link";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { createClient } from "@/lib/supabase/client";
import { resetIdentity } from "@/lib/analytics/client";
import { cn, resolveImageSrc } from "@/lib/utils";

/**
 * Persistent desktop rail (§2). Replaces the reference screenshot's top
 * horizontal nav entirely — this is the one and only primary-nav surface
 * on every breakpoint. Active item = gold text/icon + a soft gold-edge
 * gradient bar (see nav-link.tsx), never a filled background block (§1's
 * "no large gold fills" rule) — the active row does get a very low-
 * opacity gold wash (bg-gold-500/[0.07]) as its selected-state cue, the
 * same translucent-overlay technique already used for hover/secondary-
 * button states elsewhere (button.tsx's "secondary" variant), not a new
 * second surface color.
 *
 * isAdmin (from ShellProfile, set by (app)/layout.tsx) appends
 * ADMIN_NAV_ITEM to the bottom of the list for admin accounts only —
 * kept out of the shared NAV_ITEMS array so the mobile drawer and
 * bottom-nav (which also read NAV_ITEMS) aren't affected. Server-derived,
 * not a client-side guess: a non-admin never receives isAdmin=true from
 * the layout in the first place.
 *
 * No longer takes a `tier` prop: the Upgrade CTA it used to gate moved to
 * TopBar (see top-bar.tsx's TOP-BAR/SIDEBAR SWAP comment), so this
 * component has no remaining use for tier. MobileDrawer keeps its own
 * `tier` prop — its Upgrade CTA is a separate mobile-only instance this
 * swap didn't touch.
 *
 * SIDEBAR-REORG PASS (candy-reference IA restructure): mirrors
 * mobile-drawer.tsx's own rebuild (see that file's own doc comment for
 * the full rationale) so the two primary-nav surfaces stay in sync
 * rather than drifting into two different information architectures:
 *   - Premium is pulled out of the mapped NAV_ITEMS loop and rendered as
 *     its own gold-accented closing row, same as the drawer.
 *   - Notifications gets a real row in the footer, reading the same
 *     useNotificationStore unread count NotificationCenterProvider
 *     already keeps current via realtime (no separate fetch).
 *   - Discord / Contact Us / Affiliate / Help Center join the footer as
 *     a compact icon row — real destinations only (discordUrl/
 *     contactEmail passed down from (app)/layout.tsx via the same
 *     getDiscordUrl()/getContactEmail() helpers footer.tsx uses;
 *     Affiliate -> /referrals; Help Center -> /support). Hidden while
 *     the rail is collapsed (76px, icon-only) to avoid cramming five
 *     more icons into a width that's already tight for the account
 *     controls that were here first — the mobile drawer remains the
 *     canonical "full list" surface per its own doc comment, so nothing
 *     here is unreachable, just not duplicated into the narrow rail.
 *   - No category quick-filter row on desktop: /characters already
 *     renders its real gender filter pills directly on the page for
 *     users on a wide-enough viewport to see this rail at all, so a
 *     second copy of the same three pills here would be pure
 *     duplication rather than the mobile drawer's "faster path to a
 *     filtered view" tradeoff.
 *
 * ACCOUNT-MERGE FIX (2026-08-25): Premium/Profile/Settings used to be
 * three separate entry points with no equivalent on desktop at all — the
 * "Premium" row lived in the main NAV_ITEMS list here, while Profile and
 * Settings were reachable only through TopBar's AccountMenu dropdown (see
 * that file's own trim in this same pass). This rail now filters the
 * Premium row out of the main list (still present in NAV_ITEMS itself, so
 * bottom-nav.tsx's own independent Premium shortcut is unaffected) and
 * renders one merged account row in the footer instead — avatar, name,
 * tier badge, linking straight to /profile, which already surfaces both
 * "Edit Profile" (→ /profile/settings) and "Upgrade" (→ /premium) from
 * there. Mirrors the same merge in mobile-drawer.tsx's footer.
 *
 * ACCOUNT-ROW-EXPANSION (avatar-out-of-topbar pass): Tokens, Digital
 * Twin, Referrals, and Sign out used to live only in TopBar's
 * account-menu.tsx dropdown — the rail had no equivalent, so desktop
 * users had to reach for a second, unrelated nav surface (avatar dropdown
 * up top) for those four, while everything else primary lived here.
 * Moved them into this same footer, right under the merged account row,
 * now that TopBar's avatar button is gone entirely (see top-bar.tsx's
 * own AVATAR-OUT-OF-TOPBAR FIX comment). Sign-out keeps the exact
 * supabase-signOut + resetIdentity + redirect sequence account-menu.tsx
 * used, just relocated. Mirrored in mobile-drawer.tsx's footer too, same
 * as every other account-row change in this file's history.
 *
 * STATIC-RAIL FIX: `sticky top-0` swapped for `fixed top-0 left-0` — sticky
 * still leaves the rail in normal document flow, so it's only pinned
 * relative to its own scroll container; anything upstream (an ancestor
 * with its own scroll/overflow context) could still carry it along with
 * the page. `fixed` pins it to the viewport unconditionally. Since a
 * fixed element is taken out of flow entirely, the content column no
 * longer picks up its width for free from the flex layout — (app)/
 * layout.tsx now applies a matching left margin via MainOffset instead.
 *
 * COIN-ROW REMOVED: the "Vantrix Coin" balance row (Coins icon, linked to
 * /profile/tokens) dropped from the footer per direct request. Balance is
 * still reachable via /profile/tokens directly; this only removes the
 * persistent sidebar shortcut. `tokens` dropped from this component's own
 * props too (its only reader) — MobileDrawer keeps its own `tokens` prop
 * since its own coin row is untouched, so (app)/layout.tsx still passes
 * `tokens` there, just no longer to Sidebar.
 */
export function Sidebar({
  isAdmin = false,
  tier = "free",
  displayName,
  username,
  avatarUrl,
  discordUrl,
  contactEmail,
}: {
  isAdmin?: boolean;
  tier?: string;
  displayName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  discordUrl: string;
  contactEmail: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { railCollapsed, toggleRail, setRailCollapsedFromBreakpoint } = useShellStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    resetIdentity();
    router.push("/login");
    router.refresh();
  }
  const baseItems = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
  const items = baseItems.filter((item) => item.href !== "/premium");
  const premiumItem = NAV_ITEMS.find((item) => item.href === "/premium");
  const initials = (displayName ?? username ?? "V").slice(0, 1).toUpperCase();

  // Rehydrate the persisted rail-collapsed choice once on mount (see
  // shell-store.ts's skipHydration note) — deliberately not read
  // synchronously at module scope, so the server render and the very
  // first client paint both use the plain expanded default and never
  // mismatch during hydration.
  useEffect(() => {
    void useShellStore.persist.rehydrate();
  }, []);

  // §5 tablet bridge (768–1024px): sidebar defaults to the collapsed
  // rail, not the desktop expanded default. Mirrors Tailwind's own md/lg
  // cutoffs (this component only renders at md+ via `hidden md:flex`
  // below) so the 1024px threshold here and the `lg:` the rest of the
  // app uses for card grids stay in sync. Skipped entirely once the user
  // has manually toggled the rail — see railUserSet in shell-store.
  const isTabletRange = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
  useEffect(() => {
    setRailCollapsedFromBreakpoint(isTabletRange);
  }, [isTabletRange, setRailCollapsedFromBreakpoint]);

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col shrink-0 h-screen fixed top-0 left-0 z-30 bg-base border-r border-border-hairline transition-[width] duration-200 ease-premium",
        railCollapsed ? "w-[76px]" : "w-[240px]"
      )}
    >
      <div className="h-16 flex items-center px-4 border-b border-border-hairline shrink-0">
        <Link href="/" className="group flex items-center gap-2 overflow-hidden">
          <span className="h-7 w-7 shrink-0 rounded-xs bg-gold-fill shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset] flex items-center justify-center font-display font-bold text-[#160F02] text-sm transition-transform duration-200 ease-premium group-hover:scale-105">
            V
          </span>
          {!railCollapsed && (
            <span className="font-display text-lg tracking-tight whitespace-nowrap animate-fade-in">
              Vantrix
            </span>
          )}
        </Link>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {items.map((item, i) => (
          <div
            key={item.href}
            className="animate-fade-in"
            style={{ animationDelay: `${Math.min(i * 30, 200)}ms`, animationFillMode: "backwards" }}
          >
            <NavLink
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isNavItemActive(pathname, item.href)}
              premium={item.premium}
              collapsed={railCollapsed}
            />
          </div>
        ))}
        {premiumItem && (
          <div className="pt-1 mt-1 border-t border-border-hairline animate-fade-in">
            <NavLink
              href={premiumItem.href}
              label={premiumItem.label}
              icon={premiumItem.icon}
              active={isNavItemActive(pathname, premiumItem.href)}
              premium
              collapsed={railCollapsed}
            />
          </div>
        )}
      </nav>

      <div className="p-2 border-t border-border-hairline shrink-0 space-y-1">
        <Tooltip content="Account, Premium & Settings" side="right" disabled={!railCollapsed}>
          <Link
            href="/profile"
            className={cn(
              "group flex items-center gap-3 rounded-xs px-3 py-2.5 transition-colors ease-premium hover:bg-white/[0.04]",
              isNavItemActive(pathname, "/profile") && "bg-gold-500/[0.07]",
              railCollapsed && "justify-center px-0"
            )}
          >
            {avatarUrl ? (
              <Image
                src={resolveImageSrc(avatarUrl)}
                alt=""
                width={28}
                height={28}
                className={cn(
                  "h-7 w-7 shrink-0 rounded-full object-cover border transition-[transform,box-shadow] duration-200 ease-premium group-hover:scale-105",
                  tier !== "free"
                    ? "border-gold-500/50 shadow-gold-glow"
                    : "border-border-hairline"
                )}
              />
            ) : (
              <span
                className={cn(
                  "h-7 w-7 shrink-0 rounded-full bg-white/5 border flex items-center justify-center text-xs font-semibold text-gold-400 transition-[transform,box-shadow] duration-200 ease-premium group-hover:scale-105",
                  tier !== "free"
                    ? "border-gold-500/50 shadow-gold-glow"
                    : "border-border-hairline"
                )}
              >
                {initials}
              </span>
            )}
            {!railCollapsed && (
              <span className="min-w-0 flex-1 animate-fade-in">
                <span className="flex items-center gap-1 text-sm font-semibold text-text-primary truncate">
                  {displayName ?? username ?? "Your account"}
                  {tier !== "free" && <Crown className="h-3.5 w-3.5 shrink-0 text-gold-400" strokeWidth={1.75} />}
                </span>
                <span className="block text-xs text-gold-400 uppercase tracking-wide font-semibold">
                  {tier}
                </span>
              </span>
            )}
          </Link>
        </Tooltip>

        <Tooltip content="Notifications" side="right" disabled={!railCollapsed}>
          <Link
            href="/notifications"
            className={cn(
              "group flex items-center gap-3 rounded-xs px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium",
              isNavItemActive(pathname, "/notifications") && "bg-gold-500/[0.07] text-text-primary",
              railCollapsed && "justify-center px-0"
            )}
          >
            <span className="relative shrink-0">
              <Bell className="h-4 w-4 transition-transform duration-200 ease-premium group-hover:scale-110" strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-gold-500" aria-hidden />
              )}
            </span>
            {!railCollapsed && (
              <>
                <span className="flex-1">Notifications</span>
                {unreadCount > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-gold-500 text-[#160F02] text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </>
            )}
          </Link>
        </Tooltip>

        <Tooltip content="Sign out" side="right" disabled={!railCollapsed}>
          <Button
            variant="ghost"
            onClick={signOut}
            aria-label="Sign out"
            className={cn(
              "group h-auto w-full justify-start gap-3 rounded-xs px-3 py-2.5 text-sm font-medium text-danger hover:bg-danger/10",
              railCollapsed && "justify-center px-0"
            )}
          >
            <LogOut className="h-4 w-4 shrink-0 transition-transform duration-200 ease-premium group-hover:scale-110" strokeWidth={1.75} />
            {!railCollapsed && <span>Sign out</span>}
          </Button>
        </Tooltip>

        {!railCollapsed && (
          <div className="pt-1 mt-1 border-t border-border-hairline space-y-1 animate-fade-in">
            <div className="grid grid-cols-4 gap-1">
              <Tooltip content="Discord" side="top">
                <a
                  href={discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-9 flex items-center justify-center rounded-xs text-text-tertiary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium"
                >
                  <Hash className="h-4 w-4" strokeWidth={1.75} />
                </a>
              </Tooltip>
              <Tooltip content="Contact Us" side="top">
                <a
                  href={`mailto:${contactEmail}`}
                  className="h-9 flex items-center justify-center rounded-xs text-text-tertiary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium"
                >
                  <Mail className="h-4 w-4" strokeWidth={1.75} />
                </a>
              </Tooltip>
              <Tooltip content="Affiliate" side="top">
                <Link
                  href="/referrals"
                  className="h-9 flex items-center justify-center rounded-xs text-text-tertiary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium"
                >
                  <Gift className="h-4 w-4" strokeWidth={1.75} />
                </Link>
              </Tooltip>
              <Tooltip content="Help Center" side="top">
                <Link
                  href="/support"
                  className="h-9 flex items-center justify-center rounded-xs text-text-tertiary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium"
                >
                  <LifeBuoy className="h-4 w-4" strokeWidth={1.75} />
                </Link>
              </Tooltip>
            </div>
            <div className="flex items-center justify-center gap-2 pb-0.5 text-[10px] text-text-tertiary">
              <Link href="/terms" className="hover:text-text-secondary">Terms</Link>
              <span aria-hidden>•</span>
              <Link href="/privacy" className="hover:text-text-secondary">Privacy</Link>
            </div>
          </div>
        )}

        <ThemeToggle variant="sidebar" collapsed={railCollapsed} />
        <Tooltip
          content={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          side="right"
          disabled={!railCollapsed}
        >
          <Button
            variant="ghost"
            onClick={toggleRail}
            aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "group h-auto w-full justify-start gap-3 rounded-xs px-3 py-2.5 text-sm font-medium",
              railCollapsed && "justify-center px-0"
            )}
          >
            {railCollapsed ? (
              <PanelLeftOpen className="h-5 w-5 transition-transform duration-200 ease-premium group-hover:scale-110" strokeWidth={1.75} />
            ) : (
              <>
                <PanelLeftClose className="h-5 w-5 transition-transform duration-200 ease-premium group-hover:scale-110" strokeWidth={1.75} />
                <span>Collapse</span>
              </>
            )}
          </Button>
        </Tooltip>
      </div>
    </aside>
  );
}
