import { MediaCard } from "@/components/ui/media-card";
import { Badge } from "@/components/ui/badge";
import { resolveImageSrc, WORLD_IMAGE_FALLBACK } from "@/lib/utils";
import type { LocationSummary, FactionSummary } from "@/types/universe-views";

export function LocationCard({ location }: { location: LocationSummary }) {
  return (
    <MediaCard
      href={`/world/locations/${location.slug}`}
      image={resolveImageSrc(location.image_url, WORLD_IMAGE_FALLBACK)}
      fallback={WORLD_IMAGE_FALLBACK}
      alt={location.name}
      badge={location.is_capital ? <Badge>Capital</Badge> : undefined}
      className="w-full"
      imageClassName="aspect-[4/3]"
    >
      <div className="text-text-primary font-semibold text-[15px] leading-tight truncate">
        {location.name}
      </div>
      <div className="text-text-secondary text-xs mt-0.5 truncate capitalize">
        {location.archetype} · {location.population.toLocaleString()} pop.
      </div>
    </MediaCard>
  );
}

export function FactionCard({ faction }: { faction: FactionSummary }) {
  return (
    <MediaCard
      href={`/world/factions/${faction.slug}`}
      image={resolveImageSrc(faction.image_url, WORLD_IMAGE_FALLBACK)}
      fallback={WORLD_IMAGE_FALLBACK}
      alt={faction.name}
      badge={faction.is_ruling ? <Badge>Ruling</Badge> : undefined}
      className="w-full"
      imageClassName="aspect-[4/3]"
    >
      <div className="text-text-primary font-semibold text-[15px] leading-tight truncate">
        {faction.name}
      </div>
      <div className="text-text-secondary text-xs mt-0.5 truncate">
        {faction.ideology} · {faction.member_count} members
      </div>
    </MediaCard>
  );
}
