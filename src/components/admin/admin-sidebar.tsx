"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV_ITEMS } from "./admin-nav-config";
import { NavLink, isNavItemActive } from "@/components/ui/nav-link";

/**
 * SIDEBAR UPGRADE PASS — fixed here:
 *  - `nav` had no `overflow-y-auto`. ADMIN_NAV_ITEMS is 11 rows deep;
 *    on a short viewport (a laptop with browser chrome, a maximized
 *    window on a small display) the list could overflow the sticky
 *    h-screen aside with no way to scroll to the bottom items
 *    (Audit Log, Permissions). Sidebar.tsx already had this; admin's
 *    copy had silently drifted without it.
 *  - Active-row rendering (icon size, aria-current, accent bar) now
 *    goes through the same shared NavLink used by Sidebar/MobileDrawer
 *    — this file's icons were 18px vs the other two surfaces' 20px, and
 *    this was the one surface of the three with no aria-current at all.
 *    See nav-link.tsx's doc comment for the full drift list.
 */
export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex flex-col w-[220px] shrink-0 h-screen sticky top-0 bg-base border-r border-border-hairline">
      <div className="h-16 flex items-center px-5 border-b border-border-hairline shrink-0">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="h-6 w-6 rounded-xs bg-gold-fill shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset] flex items-center justify-center font-display font-bold text-[#160F02] text-xs">
            V
          </span>
          <span className="font-display text-[15px] tracking-tight">
            Admin
          </span>
        </Link>
      </div>

      <nav aria-label="Admin" className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {ADMIN_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isNavItemActive(pathname, item.href)}
          />
        ))}
      </nav>

      <div className="p-4 border-t border-border-hairline shrink-0">
        <Link
          href="/"
          className="text-xs text-text-tertiary hover:text-text-secondary transition-colors ease-premium"
        >
          ← Back to Vantrix
        </Link>
      </div>
    </aside>
  );
}
