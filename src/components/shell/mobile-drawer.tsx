"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { usePathname, useRouter } from "next/navigation";
import {
  X,
  Crown,
  Settings,
  User,
  Coins,
  Gift,
  LogOut,
  Bell,
  ChevronDown,
  Hash,
  Mail,
  LifeBuoy,
} from "lucide-react";
import { NAV_ITEMS, ADMIN_NAV_ITEM } from "./nav-config";
import { useShellStore } from "./shell-store";
import { useNotificationStore } from "@/lib/notifications/store";
import { NavLink, isNavItemActive } from "@/components/ui/nav-link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { resetIdentity } from "@/lib/analytics/client";
import { cn, resolveImageSrc } from "@/lib/utils";
import { BILLING_DISCOUNT_PCT } from "@/lib/tiers/config";

// Same source top-bar.tsx's badge reads from — keeps this drawer's CTA and
// the always-visible header badge quoting the identical rate.
const ANNUAL_DISCOUNT_LABEL = `${Math.round(BILLING_DISCOUNT_PCT.annual * 100)}% OFF`;

// SIDEBAR-REORG PASS — real character categories only (characters.gender/
// category in the DB: female/male/anime — see characters-browse.tsx's own
// CATEGORY-TRIM comment). Links straight into /characters?gender=<value>,
// which characters-browse.tsx now seeds its filter pill from (see that
// file's own CATEGORY-SEED FIX) — a tap here actually lands pre-filtered,
// not just on the unfiltered default view.
const BROWSE_CATEGORIES: { value: "female" | "male" | "anime"; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "anime", label: "Anime" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
      {children}
    </div>
  );
}

/**
 * Mobile: full overlay/drawer, dismiss on backdrop tap or item select
 * (§2). Holds the complete nav list (all of NAV_ITEMS).
 *
 * AMENDMENT: a bottom-nav.tsx bar was added back for 5 high-frequency
 * shortcuts, reopening §2's "one nav pattern only" rule by direct
 * product decision. This drawer stays the source of the full list and
 * the only way to reach Community/World/Studio on mobile; the bottom
 * bar is a shortcut layer on top, not a replacement for this.
 *
 * tier (server-derived, passed down from (app)/layout.tsx same as
 * Sidebar's) gates a standalone Upgrade CTA in the footer — see
 * sidebar.tsx's doc comment for why this is separate from the existing
 * "Premium" nav row above.
 *
 * SIDEBAR-REORG PASS (candy-reference IA restructure, full rebuild):
 * previously a flat NAV_ITEMS loop with an unrelated account footer
 * bolted on below. Restructured into the same four-zone shape a
 * reference companion-app drawer uses — account/account-actions,
 * primary nav, a category quick-filter, and a support/legal footer —
 * while keeping every destination a real, already-shipped Vantrix route
 * (no invented pages, no placeholder labels):
 *   - ACCOUNT ZONE: the merged avatar/name/tier row from the
 *     ACCOUNT-MERGE FIX below is now an actual disclosure toggle (closed
 *     state = the earlier merged row's info-at-a-glance; open state
 *     reveals Subscription, Settings, Notifications, Vantrix Coin, and
 *     Sign out as indented rows) rather than a single link, so all five
 *     account-scoped destinations live in one place instead of being
 *     split between this footer and TopBar's old dropdown.
 *      - Subscription -> /profile/settings#subscription, a real anchor
 *        added to that page's existing <SubscriptionManagement> section
 *        (see settings/page.tsx) rather than a second settings surface.
 *      - Notifications -> /notifications (already a real route) with a
 *        live unread badge read straight from useNotificationStore,
 *        the same store NotificationCenterProvider already hydrates and
 *        keeps current via realtime — no separate fetch added here.
 *   - PRIMARY NAV: NAV_ITEMS, unchanged data source, with Premium
 *     pulled out of the mapped loop and rendered as its own
 *     gold-accented closing row (mirrors a reference product's
 *     bottom-of-list, discount-badged Premium treatment) instead of
 *     just being "some gold text in the middle of the list."
 *   - CATEGORY ZONE: BROWSE_CATEGORIES above — Vantrix's actual three
 *     browse categories, not a borrowed label.
 *   - FOOTER: Discord and Contact now source a real URL/email (passed
 *     down from (app)/layout.tsx via getDiscordUrl()/getContactEmail(),
 *     the same app_config-backed helpers footer.tsx already uses, not a
 *     hardcoded duplicate). Affiliate points at /referrals (Vantrix's
 *     actual referral program — the same real destination the old
 *     footer's separate "Referrals" row pointed at, just relabeled to
 *     match what this row *does* for the user). Help Center -> /support.
 *     Legal row (Terms / Privacy) links /terms and /privacy — no
 *     "Trust & Safety" row added since no such page exists yet; adding
 *     one here would be exactly the kind of placeholder this pass was
 *     meant to remove. No language switcher for the same reason: there
 *     is no i18n in this codebase to switch.
 *
 * Everything below this point (ACCOUNT-MERGE FIX, PROFILE-IN-DRAWER FIX,
 * ACCOUNT-ROW-EXPANSION, LOGO-TO-DRAWER FIX) documents the history that
 * led to the account zone this pass restructures — kept for context on
 * *why* those five destinations all ended up drawer-owned, even though
 * the concrete markup they describe has now moved into the disclosure
 * panel above.
 *
 * LOGO-TO-DRAWER FIX: header now shows the "V" mark alongside the
 * "Vantrix" wordmark, matching desktop Sidebar's own mark+wordmark
 * header exactly — previously text-only here while TopBar's (now-
 * removed) mobile header carried the mark. Moving it here means it
 * costs no persistent header space (the drawer only exists while open)
 * instead of occupying room in TopBar's already-tight row on every
 * mobile page load. See top-bar.tsx's own LOGO-TO-DRAWER FIX comment.
 */
export function MobileDrawer({
  isAdmin = false,
  tier = "free",
  displayName,
  username,
  avatarUrl,
  tokens = 0,
  discordUrl,
  contactEmail,
}: {
  isAdmin?: boolean;
  tier?: string;
  displayName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  tokens?: number;
  discordUrl: string;
  contactEmail: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { drawerOpen, setDrawerOpen } = useShellStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const [accountOpen, setAccountOpen] = useState(true);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    resetIdentity();
    setDrawerOpen(false);
    router.push("/login");
    router.refresh();
  }

  const baseItems = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
  const items = baseItems.filter((item) => item.href !== "/premium");
  const premiumItem = NAV_ITEMS.find((item) => item.href === "/premium");
  const initials = (displayName ?? username ?? "V").slice(0, 1).toUpperCase();

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, setDrawerOpen]);

  if (!drawerOpen) return null;

  return (
    <div className="md:hidden fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/70 animate-fade-in"
        onClick={() => setDrawerOpen(false)}
        aria-hidden
      />
      <div className="absolute left-0 top-0 bottom-0 w-[82%] max-w-[320px] bg-base border-r border-border-hairline animate-slide-in-left flex flex-col">
        <div className="h-16 flex items-center justify-between px-4 border-b border-border-hairline shrink-0">
          <Link
            href="/"
            className="flex items-center gap-2 overflow-hidden"
            onClick={() => setDrawerOpen(false)}
          >
            <span className="h-7 w-7 shrink-0 rounded-xs bg-gold-fill shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset] flex items-center justify-center font-display font-bold text-[#160F02] text-sm">
              V
            </span>
            <span className="font-display text-lg tracking-tight whitespace-nowrap">
              Vantrix
            </span>
          </Link>
          <button
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="h-9 w-9 flex items-center justify-center rounded-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ACCOUNT ZONE */}
          <div className="p-3 pb-1 space-y-0.5">
            <button
              type="button"
              onClick={() => setAccountOpen((v) => !v)}
              aria-expanded={accountOpen}
              className="w-full flex items-center gap-3 px-2 py-2 rounded-xs hover:bg-white/[0.04] transition-colors ease-premium"
            >
              {avatarUrl ? (
                <Image
                  src={resolveImageSrc(avatarUrl)}
                  alt=""
                  width={36}
                  height={36}
                  className="h-9 w-9 rounded-full object-cover border border-border-hairline shrink-0"
                />
              ) : (
                <span className="h-9 w-9 shrink-0 rounded-full bg-white/5 border border-border-hairline flex items-center justify-center text-sm font-semibold text-gold-400">
                  {initials}
                </span>
              )}
              <div className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-text-primary truncate">
                  {displayName ?? username ?? "Your account"}
                  {tier !== "free" && (
                    <Crown className="h-3.5 w-3.5 shrink-0 text-gold-400" strokeWidth={1.75} />
                  )}
                </div>
                <div className="text-xs text-gold-400 uppercase tracking-wide font-semibold">
                  {tier}
                </div>
              </div>
              {unreadCount > 0 && !accountOpen && (
                <span className="h-2 w-2 shrink-0 rounded-full bg-gold-500" aria-hidden />
              )}
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-200 ease-premium",
                  accountOpen && "rotate-180"
                )}
              />
            </button>

            {accountOpen && (
              <div className="pl-2 space-y-0.5 animate-fade-in">
                <Link
                  href="/profile"
                  onClick={() => setDrawerOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-2 py-2 rounded-xs text-sm text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium",
                    isNavItemActive(pathname, "/profile") &&
                      !pathname.startsWith("/profile/settings") &&
                      "text-text-primary bg-gold-500/[0.07]"
                  )}
                >
                  <User className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  My Profile
                </Link>
                <Link
                  href="/profile/settings#subscription"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-2 py-2 rounded-xs text-sm text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium"
                >
                  <Crown className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  Subscription
                </Link>
                <Link
                  href="/profile/settings"
                  onClick={() => setDrawerOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-2 py-2 rounded-xs text-sm text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium",
                    isNavItemActive(pathname, "/profile/settings") &&
                      "text-text-primary bg-gold-500/[0.07]"
                  )}
                >
                  <Settings className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  Settings
                </Link>
                <Link
                  href="/notifications"
                  onClick={() => setDrawerOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-2 py-2 rounded-xs text-sm text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium",
                    isNavItemActive(pathname, "/notifications") &&
                      "text-text-primary bg-gold-500/[0.07]"
                  )}
                >
                  <Bell className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="flex-1">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-gold-500 text-[#160F02] text-[10px] font-bold flex items-center justify-center">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </Link>
                <Link
                  href="/profile/tokens"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-2 py-2 rounded-xs text-sm text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium"
                >
                  <Coins className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="flex-1">Vantrix Coin</span>
                  <span className="text-gold-400 font-semibold tabular-nums text-xs">
                    {tokens.toLocaleString()}
                  </span>
                </Link>
                <button
                  onClick={signOut}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-xs text-sm font-medium text-danger hover:bg-danger/10 transition-colors ease-premium"
                >
                  <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  Sign out
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-border-hairline mx-3" />

          {/* PRIMARY NAV */}
          <nav aria-label="Primary" className="py-2 px-3 space-y-0.5">
            <SectionLabel>Menu</SectionLabel>
            {items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isNavItemActive(pathname, item.href)}
                premium={item.premium}
                size="comfortable"
                onClick={() => setDrawerOpen(false)}
              />
            ))}
            {premiumItem && (
              <NavLink
                href={premiumItem.href}
                label={premiumItem.label}
                icon={premiumItem.icon}
                active={isNavItemActive(pathname, premiumItem.href)}
                premium
                size="comfortable"
                onClick={() => setDrawerOpen(false)}
              />
            )}
          </nav>

          <div className="border-t border-border-hairline mx-3" />

          {/* CATEGORY ZONE */}
          <div className="py-2 px-3">
            <SectionLabel>Browse Companions</SectionLabel>
            <div className="flex gap-2 px-1">
              {BROWSE_CATEGORIES.map((cat) => (
                <Link
                  key={cat.value}
                  href={`/characters?gender=${cat.value}`}
                  onClick={() => setDrawerOpen(false)}
                  className="flex-1 text-center rounded-xs border border-border-hairline py-2 text-xs font-semibold text-text-secondary hover:text-gold-400 hover:border-gold-500/40 transition-colors ease-premium"
                >
                  {cat.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="border-t border-border-hairline mx-3" />

          {/* FOOTER: support / legal */}
          <div className="py-3 px-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <a
                href={discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xs border border-border-hairline py-2.5 text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium"
              >
                <Hash className="h-3.5 w-3.5" strokeWidth={1.75} />
                Discord
              </a>
              <a
                href={`mailto:${contactEmail}`}
                className="flex items-center justify-center gap-2 rounded-xs border border-border-hairline py-2.5 text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium"
              >
                <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
                Contact Us
              </a>
              <Link
                href="/referrals"
                onClick={() => setDrawerOpen(false)}
                className="flex items-center justify-center gap-2 rounded-xs border border-border-hairline py-2.5 text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium"
              >
                <Gift className="h-3.5 w-3.5" strokeWidth={1.75} />
                Affiliate
              </Link>
              <Link
                href="/support"
                onClick={() => setDrawerOpen(false)}
                className="flex items-center justify-center gap-2 rounded-xs border border-border-hairline py-2.5 text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium"
              >
                <LifeBuoy className="h-3.5 w-3.5" strokeWidth={1.75} />
                Help Center
              </Link>
            </div>
            <div className="flex items-center justify-center gap-2 text-[11px] text-text-tertiary">
              <Link href="/terms" onClick={() => setDrawerOpen(false)} className="hover:text-text-secondary">
                Terms
              </Link>
              <span aria-hidden>•</span>
              <Link href="/privacy" onClick={() => setDrawerOpen(false)} className="hover:text-text-secondary">
                Privacy
              </Link>
            </div>
          </div>
        </div>

        {tier === "free" && (
          <div className="p-3 border-t border-border-hairline shrink-0">
            <Button
              asChild
              variant="primary"
              className="h-auto w-full justify-center gap-2 rounded-xs px-3 py-3 text-[15px] transition-[filter,box-shadow] ease-premium hover:shadow-gold-glow"
            >
              <Link href="/premium" onClick={() => setDrawerOpen(false)}>
                <Crown className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                Upgrade
                <span className="ml-1 rounded-xs bg-black/25 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white">
                  {ANNUAL_DISCOUNT_LABEL}
                </span>
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
