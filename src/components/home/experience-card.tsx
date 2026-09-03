import { Badge } from "@/components/ui/badge";
import { MediaCard } from "@/components/ui/media-card";
import { resolveImageSrc } from "@/lib/utils";
import type { DiscoverExperience } from "@/lib/frontend/discover";

/**
 * §3.4 asks for "category cards (image, title, companion count)", but
 * /api/discover/featured's `experiences` payload is one row per
 * character within a category, not an aggregated per-category count —
 * there is no such aggregate route in the API map (§11). Adapting to
 * the real shape: each card is a single character's experience within
 * its category, badged NEW / SERIES where applicable, rather than a
 * category rollup. A true category-count view would need a new
 * aggregate endpoint — worth flagging as a follow-up, not something to
 * fake with a client-side count of an 8-row sample.
 */
export function ExperienceCard({ experience }: { experience: DiscoverExperience }) {
  return (
    <MediaCard
      href={`/characters/${experience.characterId}`}
      image={resolveImageSrc(experience.image)}
      alt={experience.title}
      badge={
        experience.isNew ? (
          <Badge>New</Badge>
        ) : experience.isSeries ? (
          <Badge variant="outline">Series</Badge>
        ) : undefined
      }
    >
      <div className="text-text-primary font-semibold text-[15px] leading-tight truncate">
        {experience.title}
      </div>
      {experience.subtitle && (
        <div className="text-text-secondary text-xs mt-0.5 line-clamp-2">
          {experience.subtitle}
        </div>
      )}
    </MediaCard>
  );
}
