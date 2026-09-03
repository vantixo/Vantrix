import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/utils";
import { getLandingPageSlugs } from "@/lib/seo/landing-pages";

/**
 * ROUTING-FIX: §13 previously flagged this as intentionally minimal
 * because "every route under src/app/(app) redirects to /login... and
 * there is no /pricing, /about, or similar public surface anywhere in the
 * app tree today." That's no longer true — /discover, /about, /careers,
 * /blog, /support, /terms, and /privacy are now real public pages (see
 * their own route files) built specifically to close that gap, so they're
 * allowed here alongside the existing auth pages.
 *
 * 0.3.1/14.1/14.2 FIX: "/" was disallowed outright, back when it
 * unconditionally redirected every crawler (no session, same as any
 * anonymous visitor) to /login — nothing there was ever indexable. Now
 * that (app)/layout.tsx serves a real public homepage at "/" for
 * signed-out requests (see that file's own 0.3.1 FIX comment), the
 * blanket disallow would hide the single most important page on the
 * site from search engines, so it's removed. The programmatic SEO
 * landing pages (LANDING_PAGES in lib/seo/landing-pages.ts, rendered by
 * app/(seo)/[landing]/page.tsx) are added the same data-driven way the
 * sitemap already does, so a new entry there is automatically crawlable
 * here too without a second file to remember to update.
 *
 * The authenticated shell (everything else under (app) — /chats,
 * /characters, /studio, etc.) is still disallowed — nothing there is
 * indexable for a crawler with no session, and allowing it would just
 * invite crawlers at authenticated API routes. The blanket disallow of
 * "/" stays for exactly that reason (it's still what blocks every
 * unlisted (app) route); "/" is additionally added to `allow` alongside
 * it rather than removed from `disallow`, because Google's robots.txt
 * tie-break rule is "same-length match, least restrictive wins" — an
 * exact "/" in both lists resolves to allowed, while a sub-path like
 * "/chats" still matches only the (longer, unopposed) "/" disallow and
 * stays blocked. Removing "/" from disallow instead would have unblocked
 * every (app) route by default, not just the root.
 *
 * §2.5 FIX: "/companions/" (the new public character pages, see
 * (seo)/companions/[id]/page.tsx) is allowed the same way — a longer,
 * more specific allow prefix beats the blanket "/" disallow for every
 * path under it, same tie-break rule as above.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/login",
        "/forgot-password",
        "/reset-password",
        "/discover",
        "/about",
        "/careers",
        "/blog",
        "/support",
        "/terms",
        "/privacy",
        "/companions/",
        ...getLandingPageSlugs().map((slug) => `/${slug}`),
      ],
      disallow: ["/", "/api/"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
