import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Heart, Users, Crown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MediaCard } from "@/components/ui/media-card";
import { resolveImageSrc } from "@/lib/utils";
import type { DiscoverFeaturedItem } from "@/lib/frontend/discover";

/**
 * FEATURED-SHOWCASE FIX: `featured` (GET /api/discover/featured, up to 5
 * is_featured=true characters ranked by featured_position) has existed
 * since the original discover build but was only ever consumed by
 * logged-out surfaces (AnonHero, the public /discover hero banner,
 * LandingPage) — the authenticated Home page (app)/page.tsx destructured
 * `experiences`/`allCharacters`/`avatars` from the same getDiscoverHome()
 * call and silently dropped `featured` on the floor. A returning user
 * never saw the platform's own curated picks at all, only the
 * personalization-ranked "For You" row a few sections down. This is that
 * gap closed: a large hero (featured[0]) plus a landscape grid of the
 * next up to 4 items, styled as the flagship discovery moment rather
 * than another horizontal-scroll row — small gold accent bar in the
 * header (the same "reserved for genuine premium highlights" device
 * sidebar.tsx's Upgrade CTA and tier-card.tsx's highlighted plan already
 * use, not a new one-off).
 *
 * Trait pills, like/follower counts, and the premium-lock badge are all
 * real columns (route.ts's FEATURED-SHOWCASE FIX added them to the
 * query) — nothing here is fabricated placeholder data. There's no
 * separate "creator" identity to show (unlike a UGC scenario/world
 * marketplace) since `featured` is platform-curated characters, not
 * user-uploaded content, so the stat row deliberately shows the two real
 * engagement numbers the schema actually has instead of inventing a
 * download/upload count.
 */
export function FeaturedShowcase({ items }: { items: DiscoverFeaturedItem[] }) {
  if (items.length === 0) return null;

  const [hero, ...rest] = items;
  const grid = rest.slice(0, 4);

  return (
    <section className="px-4 md:px-8 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span
              className="h-5 w-1 rounded-full bg-gold-fill shadow-gold-glow"
              aria-hidden
            />
            <h2 className="font-display text-xl md:text-2xl text-text-primary">
              Featured
            </h2>
          </div>
          <Link
            href="/characters"
            className="group/link inline-flex items-center gap-0.5 text-sm font-semibold text-gold-400 hover:text-gold-300 transition-colors ease-premium"
          >
            View All
            <ChevronRight
              className="h-3.5 w-3.5 transition-transform duration-200 ease-premium group-hover/link:translate-x-0.5"
              strokeWidth={2.5}
            />
          </Link>
        </div>

        <FeaturedHero item={hero} />

        {grid.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            {grid.map((item) => (
              <FeaturedTile key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FeaturedHero({ item }: { item: DiscoverFeaturedItem }) {
  return (
    <Link
      href={`/characters/${item.characterId}`}
      className="group relative block w-full aspect-[4/5] sm:aspect-[16/8] rounded-lg overflow-hidden border border-border-hairline shadow-card transition-[border-color,box-shadow] duration-300 ease-premium hover:border-gold-500/40 hover:shadow-gold-glow"
    >
      <Image
        src={resolveImageSrc(item.image)}
        alt={item.title}
        fill
        sizes="(min-width: 768px) 1152px, 100vw"
        className="object-cover transition-transform duration-500 ease-premium group-hover:scale-[1.02]"
        loading="lazy"
      />
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/35 to-black/10"
        aria-hidden
      />

      <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-3">
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        {item.isPremium && (
          <Badge variant="outline" className="gap-1 shrink-0">
            <Crown className="h-3 w-3" strokeWidth={2} />
            Premium
          </Badge>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 p-5 md:p-8">
        <Badge className="mb-3">{item.badge === "NEW" ? "New" : "Featured"}</Badge>
        <h3 className="font-display text-2xl md:text-4xl text-white leading-tight max-w-xl">
          {item.title}
        </h3>
        {item.subtitle && (
          <p className="mt-2 text-white/70 text-sm md:text-[15px] max-w-lg line-clamp-2">
            {item.subtitle}
          </p>
        )}

        <div className="mt-4 flex items-center gap-4">
          <StatPill icon={Heart} filled value={item.likeCount} />
          <StatPill icon={Users} value={item.followerCount} />
          {item.archetype && (
            <span className="hidden sm:inline-flex items-center gap-1.5 text-white/50 text-xs">
              <span className="h-1 w-1 rounded-full bg-white/40" aria-hidden />
              {capitalize(item.archetype)}
            </span>
          )}
        </div>
      </div>

      <span className="hidden sm:inline-flex absolute bottom-5 right-5 md:bottom-8 md:right-8 items-center h-10 px-5 rounded-sm bg-gold-fill text-[#160F02] text-sm font-semibold shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset,0_10px_24px_-10px_rgba(0,0,0,0.65)] transition-[filter,transform] duration-200 ease-premium group-hover:brightness-110 group-hover:-translate-y-0.5">
        {item.cta}
      </span>
    </Link>
  );
}

function FeaturedTile({ item }: { item: DiscoverFeaturedItem }) {
  const traitLine = item.tags.slice(0, 2).join(" · ");

  return (
    <MediaCard
      href={`/characters/${item.characterId}`}
      image={resolveImageSrc(item.image)}
      alt={item.title}
      imageClassName="aspect-[4/3] sm:aspect-[16/10]"
      badge={<Badge>{item.badge === "NEW" ? "New" : "Featured"}</Badge>}
      cornerBadge={
        item.isPremium ? (
          <Badge variant="outline" className="gap-1">
            <Crown className="h-3 w-3" strokeWidth={2} />
          </Badge>
        ) : undefined
      }
    >
      <div className="text-text-primary font-semibold text-[15px] leading-tight truncate">
        {item.title}
      </div>
      {traitLine && (
        <div className="text-text-secondary text-xs mt-0.5 truncate">{traitLine}</div>
      )}
      <div className="flex items-center gap-3 mt-1.5">
        <StatPill icon={Heart} filled value={item.likeCount} compact />
        <StatPill icon={Users} value={item.followerCount} compact />
      </div>
    </MediaCard>
  );
}

function StatPill({
  icon: Icon,
  value,
  filled = false,
  compact = false,
}: {
  icon: typeof Heart;
  value: number;
  filled?: boolean;
  compact?: boolean;
}) {
  const iconSize = compact ? "h-3 w-3" : "h-3.5 w-3.5";
  return (
    <span
      className={
        "flex items-center gap-1 text-gold-400 font-semibold tabular-nums " +
        (compact ? "text-xs" : "text-xs md:text-sm")
      }
    >
      <Icon
        className={filled ? `${iconSize} fill-gold-400` : iconSize}
        strokeWidth={filled ? 0 : 2}
      />
      {formatStat(value)}
    </span>
  );
}

/** 2300 -> "2.3k", 61000 -> "61.0k". Falls back to a plain integer under 1000. */
function formatStat(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
