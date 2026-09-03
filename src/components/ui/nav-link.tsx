"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Single canonical nav-row renderer, shared by the desktop rail
 * (shell/sidebar.tsx), the mobile drawer (shell/mobile-drawer.tsx), and
 * the admin sidebar (admin/admin-sidebar.tsx) — previously three
 * near-identical hand-rolled copies of the same active-state check,
 * left-accent bar, and icon+label markup, which had already drifted out
 * of sync (admin's icons were 18px vs the other two's 20px; only the
 * rail and drawer set aria-current, admin did not; the accent bar was a
 * flat rgba fill everywhere with no relation to the theme's own
 * gold-edge gradient). Fixing something here now reaches all three
 * surfaces instead of needing the same fix applied three times.
 *
 * bottom-nav.tsx is deliberately NOT unified into this — its stacked
 * icon-over-label layout and always-on strokeWidth active-signal are a
 * genuinely different visual pattern for a different surface, not a
 * copy that drifted.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export interface NavLinkProps {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  /** Gold treatment even when inactive — a premium destination (e.g. the
   *  Premium nav row) stays visible, not just when the user is on it. */
  premium?: boolean;
  /** Icon-only rendering (desktop rail, collapsed state). Wraps the row
   *  in a Tooltip since the label isn't visible any other way. */
  collapsed?: boolean;
  /** "compact" = rail/admin density (py-2.5, text-sm, matches the
   *  desktop pointer's smaller target). "comfortable" = the mobile
   *  drawer's larger touch targets (py-3, text-[15px]). */
  size?: "compact" | "comfortable";
  onClick?: () => void;
}

export function NavLink({
  href,
  label,
  icon: Icon,
  active,
  premium = false,
  collapsed = false,
  size = "compact",
  onClick,
}: NavLinkProps) {
  const row = (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center rounded-xs font-medium transition-colors ease-premium duration-150",
        size === "compact" ? "gap-3 px-3 py-2.5 text-sm" : "gap-3 px-3 py-3 text-[15px]",
        collapsed && "justify-center px-0",
        active
          ? "bg-gold-500/[0.07] text-gold-400"
          : premium
            ? "text-gold-600 hover:text-gold-400"
            : "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-0 top-1 w-[2.5px] rounded-full animate-fade-in"
          style={{
            // Soft-edged gradient bar rather than a flat rectangle — the
            // same restrained "signature hairline" idea globals.css's
            // .gold-edge-top utility already applies horizontally
            // elsewhere, adapted vertically here. Reads through
            // rgb(var(--gold-500)) so it re-skins automatically under
            // nova/velvet, same as every other gold-* utility class.
            backgroundImage:
              "linear-gradient(180deg, transparent, rgb(var(--gold-500)) 22%, rgb(var(--gold-500)) 78%, transparent)",
          }}
        />
      )}
      <Icon
        className={cn(
          "h-5 w-5 shrink-0 transition-transform duration-200 ease-premium group-hover:scale-110",
          active && "scale-105"
        )}
        strokeWidth={active ? 2 : 1.75}
      />
      {!collapsed && <span className="whitespace-nowrap">{label}</span>}
    </Link>
  );

  return collapsed ? (
    <Tooltip content={label} side="right">
      {row}
    </Tooltip>
  ) : (
    row
  );
}
