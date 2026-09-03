"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Heart, ImageIcon as Feed, Sparkles, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav-config";
import { useScrollChromeHidden } from "./scroll-chrome-context";

/**
 * Mobile bottom bar — RESTORED (reverts the SETTINGS-ONLY collapse):
 * back to a 5-item shortcut row — Home / Dating / Feed / Studio / Premium —
 * the primary thumb-reach nav on mobile, not a Settings-only shortcut.
 * These are real destinations (same routes NAV_ITEMS already points the
 * desktop rail and mobile drawer at in nav-config.tsx), not placeholders:
 *   - Home      -> "/"        (this page)
 *   - Dating    -> "/dating"  (per direct request: replaces the Chat
 *                              shortcut that was here — conversations are
 *                              still one tap away from Home/the drawer,
 *                              Dating wasn't reachable from this bar at
 *                              all before)
 *   - Feed      -> "/feed"    (community feed — /api/feed/posts-backed)
 *   - Studio    -> "/studio"  (character/scene creation tools)
 *   - Premium   -> "/premium" (subscription/upsell — gets the same gold
 *                              "premium" treatment NAV_ITEMS marks it
 *                              with elsewhere, not a plain icon)
 * Settings is still one tap away via the drawer (hamburger, top-left) and
 * the desktop rail's account row — it just isn't one of the five most
 * frequent destinations, so it doesn't need to displace one of these.
 */
const BOTTOM_NAV_ITEMS: (NavItem & { match: (pathname: string) => boolean })[] = [
  {
    href: "/",
    label: "Home",
    icon: Home,
    match: (p) => p === "/",
  },
  {
    href: "/dating",
    label: "Dating",
    icon: Heart,
    match: (p) => p.startsWith("/dating"),
  },
  {
    href: "/feed",
    label: "Feed",
    icon: Feed,
    match: (p) => p.startsWith("/feed"),
  },
  {
    href: "/studio",
    label: "Studio",
    icon: Sparkles,
    match: (p) => p.startsWith("/studio"),
  },
  {
    href: "/premium",
    label: "Premium",
    icon: Crown,
    premium: true,
    match: (p) => p.startsWith("/premium"),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  const hidden = useScrollChromeHidden();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "md:hidden fixed bottom-0 left-0 right-0 z-40 bg-base border-t border-border-hairline pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-premium",
        hidden && "translate-y-full"
      )}
    >
      <div className="flex items-stretch justify-between h-16 px-1">
        {BOTTOM_NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1"
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 bg-gold-500 rounded-full" />
              )}
              <Icon
                className={cn(
                  "h-5 w-5",
                  active
                    ? "text-gold-400"
                    : item.premium
                      ? "text-gold-500/80"
                      : "text-text-secondary"
                )}
                strokeWidth={active ? 2 : 1.75}
              />
              <span
                className={cn(
                  "text-[10px] font-medium leading-none",
                  active
                    ? "text-gold-400"
                    : item.premium
                      ? "text-gold-500/80"
                      : "text-text-tertiary"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
