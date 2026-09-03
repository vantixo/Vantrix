import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import {
  Heart,
  Moon,
  AlertCircle,
  Waves,
  Users,
  Lock,
  Flame,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { resolveImageSrc, SCENARIO_IMAGE_FALLBACK } from "@/lib/utils";
import type { RoleplayScenario } from "@/types/roleplay";

/**
 * Dedicated location photography for the four original tiles (see
 * IMAGE PASS v2 note below) — kept as a static lookup rather than a DB
 * column since these four assets were shot/graded specifically for this
 * slug and nothing else references them.
 */
const DEDICATED_IMAGES: Record<string, string> = {
  "first-date": "/images/scenarios/first-date.jpg",
  "late-night-talk": "/images/scenarios/late-night-talk.jpg",
  jealousy: "/images/scenarios/jealousy.jpg",
  "at-the-beach": "/images/scenarios/at-the-beach.jpg",
};

const DEDICATED_ICONS: Record<string, LucideIcon> = {
  "first-date": Heart,
  "late-night-talk": Moon,
  jealousy: AlertCircle,
  "at-the-beach": Waves,
};

/** Genre-keyword fallback icon for any scenario without a dedicated slug icon above. */
function iconForScenario(scenario: RoleplayScenario): LucideIcon {
  if (DEDICATED_ICONS[scenario.slug]) return DEDICATED_ICONS[scenario.slug];
  if (scenario.faction_slug || scenario.location_slug) return Users;
  const genre = scenario.genre.toLowerCase();
  if (genre.includes("tension") || genre.includes("jealous")) return AlertCircle;
  if (genre.includes("romance") || genre.includes("intimate")) return Flame;
  return Sparkles;
}

/**
 * Reference-image parity: "Popular Scenarios" tile grid.
 *
 * LOCATION-SCENE FIX: previously linked to /characters?q=<search> — a
 * plain search seed, not an actual scene (see the migration doc comment
 * on 20261120_home_location_scenarios.sql for the earlier history: no
 * scenarios table/endpoint existed in the API map at the time, so this
 * was a decorative stand-in). Tiles now correspond to real
 * `roleplay_scenarios` rows — a tap goes to /roleplay/new?scenario=<slug>,
 * which has the user pick a companion and drops them straight into that
 * scene's opening beat.
 *
 * DB-DRIVEN FIX: this used to be a hardcoded 4-item array — the only way
 * for a scenario to reach Home was editing this file. It now renders
 * whatever listHomeScenarios() (lib/roleplay/scenarios.ts) returns, so any
 * new universal or faction/location-scoped scenario (see
 * 20261210_expanded_romance_scenarios.sql) shows up here automatically,
 * same as it already does in the World hub's "Scenarios Here" sections.
 * Faction/location-scoped tiles carry a small Users badge — the companion
 * picker they lead to (/roleplay/new) restricts to that faction's
 * members / that location's residents, so the badge sets that
 * expectation before the tap instead of after.
 *
 * IMAGE PASS v2: the first image pass (see prior revision) borrowed
 * whichever four `allCharacters` headshots happened to be first in the
 * Home query, purely so this wasn't the last icon-in-circle-only section
 * on the page. That was a placeholder, not a location photo. The original
 * four scenarios ship dedicated location stills (public/images/scenarios/
 * <slug>.jpg, 1600x1067 @3:2, pre-graded to match that scenario's `tone`)
 * so the tile previews the setting the tap leads into. Scenarios added
 * since don't have bespoke photography yet — rather than hotlink stock
 * photography of unknown license into a monetized product, those render
 * a graded gradient card with a genre icon (same fallback pattern
 * world-scenarios-section.tsx already uses for scenarios with no
 * cover_image_url) until real stills exist for them.
 */
export function PopularScenarios({ scenarios }: { scenarios: RoleplayScenario[] }) {
  if (scenarios.length === 0) return null;

  return (
    <section className="px-4 md:px-8 py-8">
      <div className="max-w-7xl mx-auto">
        <h2 className="font-display text-xl md:text-2xl text-text-primary mb-4">
          Popular Scenarios
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {scenarios.map((scenario) => {
            const Icon = iconForScenario(scenario);
            const dedicatedImage = DEDICATED_IMAGES[scenario.slug];
            const imageSrc = dedicatedImage ?? scenario.cover_image_url;
            const scoped = Boolean(scenario.faction_slug || scenario.location_slug);
            const locked = scenario.min_tier === "premium";

            return (
              <Link
                key={scenario.slug}
                href={`/roleplay/new?scenario=${encodeURIComponent(scenario.slug)}`}
                className="group relative aspect-[4/3] sm:aspect-[16/9] rounded-md overflow-hidden border border-border-hairline"
              >
                {imageSrc ? (
                  <>
                    <Image
                      src={resolveImageSrc(imageSrc, SCENARIO_IMAGE_FALLBACK)}
                      alt=""
                      fill
                      sizes="(min-width: 768px) 25vw, 50vw"
                      className="object-cover transition-transform duration-300 ease-premium group-hover:scale-105"
                    />
                    <div
                      className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10"
                      aria-hidden
                    />
                  </>
                ) : (
                  <div
                    className="absolute inset-0 bg-gradient-to-br from-gold-900/40 via-black/60 to-black/90 flex items-center justify-center"
                    aria-hidden
                  >
                    <Icon className="h-8 w-8 text-gold-500/25" />
                  </div>
                )}

                <span className="absolute top-3 left-3 h-8 w-8 rounded-full bg-black/50 backdrop-blur-sm border border-gold-500/40 flex items-center justify-center">
                  <Icon className="h-4 w-4 text-gold-400" />
                </span>

                {locked && (
                  <span className="absolute top-3 right-3 h-8 w-8 rounded-full bg-black/50 backdrop-blur-sm border border-gold-500/40 flex items-center justify-center">
                    <Lock className="h-3.5 w-3.5 text-gold-400" />
                  </span>
                )}

                <div className="absolute inset-x-0 bottom-0 p-3">
                  {scoped && (
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gold-400 mb-0.5">
                      <Users className="h-3 w-3" />
                      Members only
                    </div>
                  )}
                  <div className="text-text-primary text-sm font-semibold truncate">
                    {scenario.title}
                  </div>
                  <div className="text-text-secondary text-xs mt-0.5 truncate">{scenario.tagline}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
