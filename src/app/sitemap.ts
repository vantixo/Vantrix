import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/utils";
import { getLandingPageSlugs } from "@/lib/seo/landing-pages";
import { getPublicCharacterIds } from "@/lib/seo/public-character";

/**
 * ROUTING-FIX: /discover, /about, /careers, /blog, /support, /terms, and
 * /privacy are now real public pages (previously only /login was — see
 * robots.ts for the fuller history of that gap). forgot-password/
 * reset-password stay excluded, same reasoning as before: they're only
 * ever reached via an emailed link with a token, never a page anyone
 * should land on from a search result.
 *
 * 0.3.1/14.1/14.2 FIX: "/" is now the real public homepage — the top of
 * the acquisition funnel — rather than an unconditional /login redirect
 * (see (app)/layout.tsx's 0.3.1 FIX comment), so it belongs here at the
 * top with the highest priority. The programmatic SEO landing pages
 * (LANDING_PAGES, rendered by app/(seo)/[landing]/page.tsx) are pulled
 * in via getLandingPageSlugs() rather than hand-listed, so a new entry
 * added to that config is automatically included here — the same
 * data-driven approach robots.ts now uses for the same list.
 *
 * §2.5 FIX: /companions/[id] (the new public, crawlable character pages —
 * see src/app/(seo)/companions/[id]/page.tsx) is pulled in the same
 * data-driven way as the landing-page slugs above, via
 * getPublicCharacterIds() (already capped at 5,000 there — see that
 * file's own comment on why — well under Google's 50k-URL/file sitemap
 * limit even combined with every other entry here). Async because that
 * fetch is a real DB round-trip; Next's sitemap() export supports an
 * async function the same as any other route-metadata file.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const characterIds = await getPublicCharacterIds();
  return [
    {
      url: absoluteUrl("/"),
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    ...getLandingPageSlugs().map((slug) => ({
      url: absoluteUrl(`/${slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.9,
    })),
    {
      url: absoluteUrl("/login"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: absoluteUrl("/discover"),
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: absoluteUrl("/about"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: absoluteUrl("/careers"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: absoluteUrl("/blog"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.3,
    },
    {
      url: absoluteUrl("/support"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: absoluteUrl("/terms"),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: absoluteUrl("/privacy"),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    ...characterIds.map((id) => ({
      url: absoluteUrl(`/companions/${id}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
