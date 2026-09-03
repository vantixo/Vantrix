import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { BookOpen, Lock, Clapperboard } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { resolveImageSrc, SCENARIO_IMAGE_FALLBACK } from "@/lib/utils";
import type { RoleplayScenario } from "@/types/roleplay";

/**
 * "Scenarios Here" — the missing link between the World hub (Location/
 * Faction detail pages) and the Story Mode roleplay engine. Both pages
 * already had a full read model (governance, residents, members) but no
 * path into roleplay_scenarios/roleplay_sessions; scenarios previously
 * only surfaced from Home (universal, place-agnostic) or a character's own
 * profile. See lib/roleplay/scenarios.ts's listScenariosForLocation() /
 * listScenariosForFaction() and 20261124_roleplay_world_faction_scenarios.sql.
 *
 * Deliberately not the full ScenarioPicker (components/roleplay/scenario-
 * picker.tsx) — that component assumes a character is already chosen and
 * lets you start immediately. Here no character is chosen yet, so a tap
 * goes to /roleplay/new?scenario=<slug>, the same companion-picker hand-off
 * Home's Popular Scenarios tiles already use, not a direct session start.
 */
export function WorldScenariosSection({ scenarios }: { scenarios: RoleplayScenario[] }) {
  if (scenarios.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
        <Clapperboard className="h-3.5 w-3.5" /> Scenarios Here
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {scenarios.map((scenario) => {
          const locked = scenario.min_tier === "premium";
          return (
            <Link key={scenario.id} href={`/roleplay/new?scenario=${encodeURIComponent(scenario.slug)}`}>
              <Card className="relative flex h-full flex-col overflow-hidden">
                {scenario.cover_image_url ? (
                  <div className="relative h-28 w-full">
                    <Image
                      src={resolveImageSrc(scenario.cover_image_url, SCENARIO_IMAGE_FALLBACK)}
                      alt={scenario.title}
                      fill
                      sizes="(max-width: 640px) 100vw, 50vw"
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-28 w-full items-center justify-center bg-black/40">
                    <BookOpen className="h-7 w-7 text-gold-500/30" />
                  </div>
                )}

                {locked && (
                  <div className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 backdrop-blur-sm">
                    <Lock className="h-3.5 w-3.5 text-gold-400" />
                  </div>
                )}

                <div className="flex flex-1 flex-col gap-1.5 p-3.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{scenario.genre}</Badge>
                    <span className="text-[11px] text-text-tertiary">{scenario.chapter_count} chapters</span>
                  </div>
                  <h3 className="font-serif text-[15px] font-semibold text-text-primary">{scenario.title}</h3>
                  <p className="line-clamp-2 text-sm text-text-secondary">{scenario.tagline}</p>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
