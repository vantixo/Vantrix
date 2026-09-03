import Link from "next/link";
import { ThemeToggle } from "@/components/theme/theme-toggle";

/**
 * Shared header for standalone public pages (about, careers, blog, support,
 * terms, privacy, /discover). These sit outside the (app) route group, so
 * they don't get Sidebar/TopBar — this is the minimal equivalent: brand
 * mark back to "/", theme toggle (so a signed-out visitor can preview
 * nova too — see components/theme/theme-toggle.tsx), plus a Log In CTA,
 * matching TopBar's mark markup (src/components/shell/top-bar.tsx) so the
 * brand looks identical whether a visitor is signed in or not.
 */
export function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 h-16 flex items-center justify-between gap-3 px-4 md:px-8 bg-base/90 backdrop-blur border-b border-border-hairline">
      <Link href="/" className="flex items-center gap-2">
        <span className="h-7 w-7 rounded-xs bg-gold-fill flex items-center justify-center font-display font-bold text-[#160F02] text-sm">
          V
        </span>
        <span className="font-display text-lg tracking-tight">Vantrix</span>
      </Link>
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <Link
          href="/login"
          className="h-9 px-4 inline-flex items-center rounded-sm border border-gold-500/50 text-gold-400 text-sm font-semibold hover:border-gold-400 hover:text-gold-300 hover:bg-gold-500/5 transition-colors ease-premium duration-150"
        >
          Log In
        </Link>
      </div>
    </header>
  );
}
