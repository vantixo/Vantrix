"use client";

import { useEffect, useRef, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, resolveImageSrc } from "@/lib/utils";
import type { HeroAd } from "@/lib/frontend/ads";
import { PromoHeroArt, isPromoHeroCode, promoHeroSlugFrom } from "./promo-hero-art";

/**
 * Replaces PremiumBanner in the homepage slot below Featured Companions.
 *
 * PERF FIX (supersedes the original client-fetch version): `ads` now
 * arrives as a server-rendered prop from getHeroAds() (see page.tsx and
 * lib/frontend/ads.ts) instead of being fetched client-side in a
 * useEffect. This is above-the-fold hero content — the old version
 * shipped an empty skeleton in the initial HTML and only painted the
 * real banner after hydration + a client fetch resolved, which is a
 * self-inflicted LCP regression for the exact content most likely to
 * BE the page's LCP element. There is now no loading state to handle:
 * the array is either populated or empty by the time this component
 * ever renders.
 *
 * Swipeable via native scroll-snap + onScroll-synced dots, same pattern
 * as hero-carousel.tsx's mobile variant, but unconditional (not
 * `md:hidden`) since this is the only hero content in this slot at
 * every breakpoint — desktop gets hover arrows on top of the same track.
 *
 * Impressions/clicks are pinged fire-and-forget via POST /api/ads
 * (`{ id, stat }`), matching that route's documented contract. A slide
 * is only counted once per mount (`seen` ref) so re-scrolling back and
 * forth doesn't inflate impressions.
 *
 * REDIRECT-FIX: internal vs. external link handling now mirrors
 * feed-inline-ad.tsx exactly (that component's own ADS-INAPP-FIX comment
 * documents the intended contract) — this component had never been
 * updated to match when that fix landed, so an external ad link here
 * still went straight out via a raw next/link `href`, bypassing /api/go's
 * scheme allowlist and server-side click increment entirely. Internal
 * links (admin/route.ts's create_ad schema only accepts a link starting
 * with a single "/", or a validated http/https URL) are unaffected —
 * both components already handled those identically.
 */
export function HeroAdsCarousel({ ads }: { ads: HeroAd[] }) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const ad = ads[active];
    if (ad && !seen.current.has(ad.id)) {
      seen.current.add(ad.id);
      pingAdStat(ad.id, "impression");
    }
  }, [ads, active]);

  if (ads.length === 0) return null;

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    if (index !== active) setActive(index);
  }

  function scrollTo(index: number) {
    const el = trackRef.current;
    el?.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  }

  return (
    <section className="px-4 md:px-8 py-6 md:py-8">
      <div className="max-w-7xl mx-auto relative group/hero">
        <div
          ref={trackRef}
          onScroll={handleScroll}
          className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-smooth rounded-md"
        >
          {ads.map((ad, i) => {
            const isExternal = !ad.link.startsWith("/");
            const href = isExternal
              ? `/api/go?url=${encodeURIComponent(ad.link)}&adId=${encodeURIComponent(ad.id)}`
              : ad.link || "#";
            // code: slides render as pure SVG/CSS (see promo-hero-art.tsx) —
            // no <Image> download, no gradient/title overlay needed since
            // the art already composes its own headline + tagline.
            const isCode = isPromoHeroCode(ad.image_url);
            const slideContent = isCode ? (
              <PromoHeroArt slug={promoHeroSlugFrom(ad.image_url)} />
            ) : (
              <>
                <Image
                  src={resolveImageSrc(ad.image_url)}
                  alt={ad.title}
                  fill
                  sizes="100vw"
                  priority={i === 0}
                  loading={i === 0 ? undefined : "lazy"}
                  className="object-cover"
                />
                {/* Fully-designed creatives (headline + CTA already baked into
                    the image, e.g. 20261220_seed_baked_hero_ad_creatives.sql)
                    skip this — the darkening gradient and a second copy of the
                    title would just muddy an image that already reads on its
                    own, right on top of a CTA button that's already there. */}
                {!ad.hide_overlay && (
                  <>
                    <div
                      className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent"
                      aria-hidden
                    />
                    <div className="absolute inset-x-0 bottom-0 p-5 md:p-8">
                      <div className="text-text-primary font-display text-2xl md:text-4xl leading-tight max-w-lg">
                        {ad.title}
                      </div>
                    </div>
                  </>
                )}
              </>
            );
            const slideClassName =
              "relative shrink-0 w-full aspect-[16/10] md:aspect-[21/9] snap-center overflow-hidden rounded-md";

            // External links skip pingAdStat's own click — /api/go already
            // increments server-side before redirecting (same reasoning as
            // feed-inline-ad.tsx's AdLink).
            return isExternal ? (
              <a
                key={ad.id}
                href={href}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className={slideClassName}
              >
                {slideContent}
              </a>
            ) : (
              <Link
                key={ad.id}
                href={href}
                onClick={() => pingAdStat(ad.id, "click")}
                className={slideClassName}
              >
                {slideContent}
              </Link>
            );
          })}
        </div>

        {ads.length > 1 && (
          <>
            <button
              aria-label="Previous"
              onClick={() => scrollTo(Math.max(0, active - 1))}
              className="hidden md:flex absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 items-center justify-center rounded-full bg-black/50 border border-white/10 text-text-primary opacity-0 group-hover/hero:opacity-100 transition-opacity ease-premium hover:border-gold-500/50"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              aria-label="Next"
              onClick={() => scrollTo(Math.min(ads.length - 1, active + 1))}
              className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 items-center justify-center rounded-full bg-black/50 border border-white/10 text-text-primary opacity-0 group-hover/hero:opacity-100 transition-opacity ease-premium hover:border-gold-500/50"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <div className="flex items-center justify-center gap-1.5 mt-3">
              {ads.map((ad, i) => (
                <button
                  key={ad.id}
                  aria-label={`Go to slide ${i + 1}`}
                  onClick={() => scrollTo(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all ease-premium duration-200",
                    i === active ? "w-5 bg-gold-500" : "w-1.5 bg-white/20"
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function pingAdStat(id: string, stat: "impression" | "click") {
  fetch("/api/ads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, stat }),
    keepalive: true,
  }).catch(() => {});
}
