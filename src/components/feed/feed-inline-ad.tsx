"use client";

import { useEffect, useRef } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { ExternalLink, Megaphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { resolveImageSrc } from "@/lib/utils";
import type { HeroAd } from "@/lib/frontend/ads";

/**
 * FEED-ADS-WIRING: consumer for the 'inline' ad position. The `ads` table,
 * admin form (position select), and GET /api/ads?position=inline already
 * supported this — HeroAdsCarousel was the only slot anything actually
 * rendered. This interleaves into FeedGrid's post list (see that file).
 *
 * Internal vs. external link handling mirrors what admin/route.ts's schema
 * comment (ADS-INAPP-FIX) describes as AdBoard's intended behavior, which
 * no frontend component had actually implemented yet:
 *   - internal ("/pricing", "/create-character", …): plain in-app
 *     navigation via next/link, same-tab, no "Sponsored" chrome implied by
 *     an outside redirect.
 *   - external (http/https): routed through /api/go?url=…&adId=… — the
 *     hardened outbound router already built for this (scheme allowlist +
 *     server-side click increment, see that route's own docstring) — opened
 *     in a new tab with rel="noopener noreferrer sponsored" per Google's
 *     guidance for paid/sponsored outbound links.
 *   admin/route.ts's create_ad schema already only accepts a link that
 *   passes isSafeInternalLinkPath (must start with a single "/") or
 *   isSafeExternalUrl (http/https only), so a plain startsWith("/") check
 *   here is sufficient to route it correctly — the unsafe cases were
 *   already rejected at write time.
 *
 * Impressions are pinged once per mount via the existing POST /api/ads
 * {id, stat} contract (same one HeroAdsCarousel uses) — a feed card only
 * mounts once per page view, so no "seen" de-dupe set is needed here the
 * way the carousel needs one for its re-triggerable scroll handler.
 * Clicks on external links are counted server-side by /api/go itself;
 * internal-link clicks still need the client-side ping since there's no
 * server hop to hook into for same-tab in-app navigation.
 */
export function FeedInlineAd({ ad }: { ad: HeroAd }) {
  const pinged = useRef(false);

  useEffect(() => {
    if (pinged.current) return;
    pinged.current = true;
    pingAdStat(ad.id, "impression");
  }, [ad.id]);

  const isExternal = !ad.link.startsWith("/");
  const href = isExternal
    ? `/api/go?url=${encodeURIComponent(ad.link)}&adId=${encodeURIComponent(ad.id)}`
    : ad.link || "#";

  return (
    <Card className="p-0" interactive={false}>
      <div className="flex items-center gap-1.5 px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
        <Megaphone className="h-3 w-3" />
        Sponsored
      </div>

      <AdLink
        href={href}
        isExternal={isExternal}
        adId={ad.id}
        className="relative mt-2 block aspect-[4/5] w-full bg-black/40"
      >
        <Image
          src={resolveImageSrc(ad.image_url)}
          alt={ad.title}
          fill
          sizes="(max-width: 640px) 100vw, 520px"
          className="object-cover"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/5 to-transparent"
          aria-hidden
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
          <p className="font-display text-xl leading-tight text-text-primary">{ad.title}</p>
          {isExternal && (
            <ExternalLink className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
          )}
        </div>
      </AdLink>
    </Card>
  );
}

function AdLink({
  href,
  isExternal,
  adId,
  className,
  children,
}: {
  href: string;
  isExternal: boolean;
  adId: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (isExternal) {
    // /api/go already increments the click stat server-side before
    // redirecting, so no onClick ping here — see this file's header note.
    return (
      <a href={href} target="_blank" rel="noopener noreferrer sponsored" className={className}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} onClick={() => pingAdStat(adId, "click")} className={className}>
      {children}
    </Link>
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
