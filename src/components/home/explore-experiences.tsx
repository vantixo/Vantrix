"use client";

import { useMemo, useState } from "react";
import { FilterPillGroup, type FilterPillOption } from "@/components/ui/filter-pills";
import { ExperienceCard } from "./experience-card";
import type { DiscoverExperience } from "@/lib/frontend/discover";

const CATEGORY_LABELS: Record<string, string> = {
  romance: "Romance",
  adventure: "Adventure",
  mystery: "Mystery",
};

/**
 * §3.4 — filter pill row (All active in gold-filled pill, rest
 * outline/ghost) + grid of cards. Pills are derived from whatever
 * categories are actually present in this batch rather than a fixed
 * list, so a category with zero current experiences never renders an
 * empty pill.
 */
export function ExploreExperiences({
  experiences,
}: {
  experiences: DiscoverExperience[];
}) {
  const options: FilterPillOption[] = useMemo(() => {
    const present = Array.from(new Set(experiences.map((e) => e.category)));
    return [
      { value: "all", label: "All" },
      ...present.map((c) => ({ value: c, label: CATEGORY_LABELS[c] ?? c })),
    ];
  }, [experiences]);

  const [active, setActive] = useState("all");

  const filtered =
    active === "all" ? experiences : experiences.filter((e) => e.category === active);

  if (experiences.length === 0) return null;

  return (
    <section className="px-4 md:px-8 py-8">
      <div className="max-w-7xl mx-auto">
        <h2 className="font-display text-xl md:text-2xl text-text-primary mb-4">
          Explore Experiences
        </h2>

        <FilterPillGroup options={options} value={active} onChange={setActive} className="mb-5" />

        {/* §5 tablet bridge: 2-column through 768–1024px — sm: (640px) would
            have pushed 3 columns across almost the whole tablet range. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {filtered.map((experience) => (
            <ExperienceCard key={experience.id} experience={experience} />
          ))}
        </div>
      </div>
    </section>
  );
}
