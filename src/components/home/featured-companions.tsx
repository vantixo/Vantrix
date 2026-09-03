import Link from "next/link";
import { HorizontalScrollRow } from "@/components/ui/horizontal-scroll-row";
import { CompanionCard } from "./companion-card";
import type { DiscoverCharacter } from "@/lib/frontend/discover";

/**
 * §3.3 — section header + "View All" link (gold), horizontal-scroll
 * card row. Sourced from `allCharacters` (already personalized by the
 * route's recommendation/AI-curator pass for the first page) rather
 * than `avatars`, since the card spec needs trait tags + like count,
 * which only `allCharacters` carries.
 */
export function FeaturedCompanions({
  characters,
}: {
  characters: DiscoverCharacter[];
}) {
  if (characters.length === 0) return null;

  return (
    <section className="px-4 md:px-8 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl md:text-2xl text-text-primary">
            For You
          </h2>
          <Link
            href="/characters"
            className="text-sm font-semibold text-gold-400 hover:text-gold-300 transition-colors ease-premium"
          >
            View All
          </Link>
        </div>

        <HorizontalScrollRow>
          {characters.map((c) => (
            <CompanionCard key={c.id} character={c} />
          ))}
        </HorizontalScrollRow>
      </div>
    </section>
  );
}
