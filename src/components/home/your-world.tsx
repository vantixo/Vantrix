import Link from "next/link";
import { Flame, BookOpen, Vote, type LucideIcon } from "lucide-react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { resolveImageSrc, WORLD_IMAGE_FALLBACK } from "@/lib/utils";
import type { HomeWorldTeaser } from "@/lib/frontend/world";

interface Tile {
  key: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  caption: string;
  /** Real photo to show behind the tile — a location still for event/
   *  choice, the lead participant's portrait for story. Always resolved
   *  to a valid src (see resolveImageSrc): null here just means "no
   *  location/character was on hand to resolve from," in which case the
   *  tile falls back to WORLD_IMAGE_FALLBACK rather than going blank. */
  image: string | null;
}

function buildTiles(teaser: HomeWorldTeaser): Tile[] {
  const tiles: Tile[] = [];

  if (teaser.event) {
    tiles.push({
      key: `event-${teaser.event.id}`,
      icon: Flame,
      eyebrow: "World event",
      title: teaser.event.title,
      caption: teaser.event.description,
      image: teaser.eventLocationImage,
    });
  }

  if (teaser.story) {
    const lead = teaser.story.participant_characters?.[0]?.name ?? null;
    const extra = (teaser.story.participant_characters?.length ?? 0) - 1;
    tiles.push({
      key: `story-${teaser.story.id}`,
      icon: BookOpen,
      eyebrow: "Ongoing story",
      title: teaser.story.title,
      caption: lead
        ? `${lead}${extra > 0 ? ` +${extra} more` : ""} \u00b7 Chapter ${teaser.story.chapter}`
        : `Chapter ${teaser.story.chapter}`,
      image: teaser.story.participant_characters?.[0]?.image_url ?? null,
    });
  }

  if (teaser.choice) {
    tiles.push({
      key: `choice-${teaser.choice.id}`,
      icon: Vote,
      eyebrow: "Today's choice",
      title: teaser.choice.prompt,
      caption: teaser.choice.locationName
        ? `A decision for ${teaser.choice.locationName}`
        : "A decision for the world",
      image: teaser.choiceLocationImage,
    });
  }

  return tiles;
}

/**
 * Reference-image parity: "Your World" strip — a 3-tile teaser for the
 * full World hub (live event / ongoing story / today's world choice).
 *
 * REAL-IMAGE FIX: this used to render a graded gradient + icon on every
 * tile with no photo at all — at the time, no location photography
 * existed for events/stories/choices. That's no longer true: locations
 * now carry real image_url stills (world_locations.image_url, the same
 * field LocationCard already renders in world-cards.tsx) and world
 * stories already resolve each participant's real portrait
 * (participant_characters[i].image_url). getHomeWorldTeaser (see
 * lib/frontend/world.ts's own REAL-IMAGE FIX comment) now resolves and
 * hands down eventLocationImage / choiceLocationImage alongside the
 * story's already-available participant photo, so every tile gets an
 * actual still behind it. resolveImageSrc always returns a usable src
 * (falling back to WORLD_IMAGE_FALLBACK), so a tile with no
 * location/character on hand degrades to that neutral placeholder
 * rather than rendering nothing — never a broken image. All three tap
 * through to /world; none of this data has a dedicated detail route of
 * its own (an event/story/choice lives inside the World hub's Overview
 * tab, not at its own slug), so a single consistent destination is more
 * honest than inventing per-tile routes.
 */
export function YourWorld({ teaser }: { teaser: HomeWorldTeaser }) {
  const tiles = buildTiles(teaser);
  if (tiles.length === 0) return null;

  return (
    <section className="px-4 md:px-8 py-8 border-t border-border-hairline">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl md:text-2xl text-text-primary">Your World</h2>
          <Link
            href="/world"
            className="text-sm font-semibold text-gold-400 hover:text-gold-300 transition-colors ease-premium"
          >
            Open world
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <Link
                key={tile.key}
                href="/world"
                className="group relative rounded-md overflow-hidden border border-border-hairline min-h-[168px] shadow-card transition-colors duration-200 ease-premium hover:border-gold-500/40"
              >
                <Image
                  src={resolveImageSrc(tile.image, WORLD_IMAGE_FALLBACK)}
                  fallback={WORLD_IMAGE_FALLBACK}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, 33vw"
                  className="object-cover transition-transform duration-300 ease-premium group-hover:scale-105"
                />
                <div
                  className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10"
                  aria-hidden
                />
                <div className="relative z-10 h-full flex flex-col justify-end p-4">
                  <Icon className="h-4 w-4 text-gold-400 mb-2" strokeWidth={2} />
                  <p className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-gold-400 mb-1">
                    {tile.eyebrow}
                  </p>
                  <h3 className="font-display text-[17px] font-semibold text-text-primary leading-tight mb-1 line-clamp-2">
                    {tile.title}
                  </h3>
                  <p className="text-xs text-text-secondary line-clamp-1">{tile.caption}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
