"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV_ITEMS } from "./admin-nav-config";
import { ScrollSignalBar } from "./motion/scroll-signal-bar";
import { ScrollReactiveHeaderShade } from "./motion/scroll-reactive-header-shade";
import { cn } from "@/lib/utils";

export function AdminTopBar() {
  const pathname = usePathname();
  const current = [...ADMIN_NAV_ITEMS]
    .reverse()
    .find((i) => (i.href === "/admin" ? pathname === "/admin" : pathname.startsWith(i.href)));

  return (
    <header className="sticky top-0 z-40 h-16">
      <ScrollReactiveHeaderShade />
      <ScrollSignalBar />
      <div className="relative h-full flex items-center justify-between px-4 md:px-8">
        <div className="flex items-center gap-2 md:hidden">
          <span className="h-6 w-6 rounded-xs bg-gold-fill flex items-center justify-center font-display font-bold text-[#160F02] text-xs">
            V
          </span>
          <span className="font-display text-[15px]">Admin</span>
        </div>
        <h1 className="hidden md:block font-display text-lg">
          {current?.label ?? "Admin"}
        </h1>
        <nav className="flex md:hidden items-center gap-1 overflow-x-auto no-scrollbar">
          {ADMIN_NAV_ITEMS.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors ease-premium",
                  active
                    ? "border-gold-500/60 text-gold-400"
                    : "border-border-hairline text-text-secondary"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
