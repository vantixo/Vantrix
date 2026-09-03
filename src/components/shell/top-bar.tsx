"use client";

import Link from "next/link";
import { Menu, Search, Crown } from "lucide-react";
import { useShellStore } from "./shell-store";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { BILLING_DISCOUNT_PCT } from "@/lib/tiers/config";
import type { ShellProfile } from "@/lib/frontend/session";
import { useScrollChromeHidden } from "./scroll-chrome-context";
import { cn } from "@/lib/utils";

// Sourced from the same BILLING_DISCOUNT_PCT map that drives /premium's
// pricing and the paywall modal (see tiers/config.ts) — never a hand-typed
// number, so this badge can't advertise a rate checkout doesn't honor.
const ANNUAL_DISCOUNT_LABEL = `${Math.round(BILLING_DISCOUNT_PCT.annual * 100)}% OFF`;

/**
 * Persistent top bar, all breakpoints (§2, extended): hamburger (left,
 * mobile-only since desktop nav lives in the rail) · search · Upgrade CTA
 * (free tier only, next to notifications — see TOP-BAR/SIDEBAR SWAP
 * below) · notification bell w/ live count + dropdown preview (see
 * components/notifications/notification-bell.tsx, backed by the realtime
 * store — no longer a static count computed once at layout render). No
 * avatar/account button — see AVATAR-OUT-OF-TOPBAR FIX below.
 *
 * LOGO-TO-DRAWER FIX: the mobile logo (mark + "Vantrix" wordmark) that
 * used to sit here, next to the hamburger, moved into MobileDrawer's own
 * header — see that file's own comment. It was permanently occupying
 * space on every mobile page load in a header that's already tight
 * (hamburger, search, Upgrade, notifications, avatar all competing for
 * one row on a 390px viewport), while the drawer — which only opens on
 * tap, so it costs no persistent space — previously showed the wordmark
 * without the mark at all. Desktop is unaffected: Sidebar has always
 * been the only place the logo renders there.
 *
 * TOP-BAR/SIDEBAR SWAP: the Upgrade CTA that used to live in the Sidebar
 * footer moved up here, into the slot next to the notification bell.
 * Free-tier-only per lib/tiers/config.ts's `!== 'free'` convention, same
 * gating Sidebar's Upgrade row used before the swap.
 *
 * MOBILE-THEME-TOGGLE FIX: the bare-icon ThemeToggle (`variant="icon"`,
 * same one PublicHeader uses) was dropped from this slot during the swap
 * above under the assumption Sidebar's own `variant="sidebar"` copy in
 * its footer covered the control. Sidebar only renders `md:` and up
 * (`hidden md:flex`, see that file), so that left every signed-in mobile
 * visitor — this header renders at all breakpoints, unlike Sidebar —
 * with no way to reach the toggle at all. Restored here so it's reachable
 * everywhere again; Sidebar keeps its own labeled footer row too, which
 * is harmless duplication on desktop, not a conflicting source of truth
 * (both read/write the same useThemeStore).
 *
 * AVATAR-OUT-OF-TOPBAR FIX: the avatar/chevron button that used to sit
 * here (account-menu.tsx) opened a dropdown whose only remaining
 * destinations — Tokens, Digital Twin, Referrals, Sign out — duplicated
 * ground already covered by the merged account row in Sidebar's footer
 * (desktop) and MobileDrawer's footer (mobile), which both link to
 * /profile. Rather than run two separate account surfaces, those four
 * items moved into Sidebar's and MobileDrawer's footers alongside that
 * row (see those files' own ACCOUNT-ROW-EXPANSION comments), and
 * account-menu.tsx is no longer imported anywhere. TopBar keeps no
 * per-account affordance now — profile/settings/tokens/etc. all live in
 * exactly one place per breakpoint: the rail or the drawer.
 *
 * THEME-TOGGLE REMOVED (reverses MOBILE-THEME-TOGGLE FIX above, per
 * direct request): this bar no longer renders ThemeToggle at all, on any
 * breakpoint. Sidebar's own footer copy still covers desktop (`hidden
 * md:flex`, unaffected by this change). Signed-in mobile visitors lose
 * the persistent quick-toggle this fix originally restored for them, but
 * keep a working path via Profile → Settings, which renders the full
 * ThemePicker (see theme-picker.tsx) rather than just this bar's
 * single-click cycling control.
 */
export function TopBar({ profile }: { profile: ShellProfile }) {
  const { setDrawerOpen } = useShellStore();
  const hidden = useScrollChromeHidden();

  return (
    <header
      className={cn(
        "sticky top-0 z-40 h-16 flex items-center justify-between gap-3 px-4 md:px-6 bg-base/90 backdrop-blur border-b border-border-hairline transition-transform duration-200 ease-premium",
        hidden && "-translate-y-full md:translate-y-0"
      )}
    >
      <div className="flex items-center gap-3">
        <button
          aria-label="Open menu"
          onClick={() => setDrawerOpen(true)}
          className="md:hidden h-10 w-10 flex items-center justify-center rounded-xs text-text-primary hover:bg-white/[0.04]"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center gap-1.5 md:gap-2">
        <Link
          href="/characters"
          aria-label="Search"
          className="h-10 w-10 flex items-center justify-center rounded-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium"
        >
          <Search className="h-5 w-5" strokeWidth={1.75} />
        </Link>

        {profile.tier === "free" && (
          <Button
            asChild
            variant="primary"
            className="h-10 px-3 gap-1.5 rounded-xs text-sm transition-[filter,box-shadow] ease-premium hover:shadow-gold-glow"
          >
            <Link href="/premium" aria-label={`Upgrade — ${ANNUAL_DISCOUNT_LABEL} annual`}>
              <Crown className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="hidden sm:inline whitespace-nowrap" aria-hidden="true">
                Premium
              </span>
              <span
                className="whitespace-nowrap rounded-xs bg-black/25 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white"
                aria-hidden="true"
              >
                {ANNUAL_DISCOUNT_LABEL}
              </span>
            </Link>
          </Button>
        )}

        <NotificationBell />
      </div>
    </header>
  );
}
