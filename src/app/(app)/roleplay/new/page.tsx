import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { getScenarioBySlug, getEligibleCastForScenario } from "@/lib/roleplay/scenarios";
import { getDiscoverChars } from "@/lib/frontend/discover";
import { MediaCard } from "@/components/ui/media-card";
import { resolveImageSrc } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Scenario-first Story Mode entry — reached from a scenario slug (Home's
 * Popular Scenarios tiles: First Date / Late Night Talk / Jealousy / At the
 * Beach) rather than a character page. Story Mode has always required a
 * character (see /roleplay/new/[characterId]'s own docstring — POST
 * /api/roleplay/start needs both), so this is the missing first step: show
 * the scenario, let the user pick who they want to play it with, then hand
 * off to the existing per-character flow with the scenario preselected so
 * it starts immediately instead of asking them to pick it again.
 *
 * AREA-RESTRICTION FIX: a faction/location-scoped scenario (see
 * getEligibleCastForScenario's own doc comment) now only offers characters
 * who actually belong to that faction or live in that place, instead of the
 * entire discover pool — "who do you want this story with" used to include
 * companions with zero connection to the scene. Universal scenarios are
 * unaffected: getEligibleCastForScenario returns `null` for those and this
 * falls back to the same getDiscoverChars pool as before. The engine also
 * enforces this server-side at session start (see engine.ts's
 * SCENARIO_FACTION_LOCKED/SCENARIO_LOCATION_LOCKED checks) — this is UX,
 * not the security boundary.
 *
 * No auth check here — (app)/layout.tsx already redirects a signed-out
 * visitor to /login?redirect=<pathname> for every route except "/", and
 * Popular Scenarios is reachable from the signed-out Home view. (Note: that
 * redirect only preserves the pathname, not this page's ?scenario= query —
 * a pre-existing limitation of that redirect, not new here. A guest who
 * logs in from this link lands back on a bare /roleplay/new and needs to
 * tap the Home tile again to get the scenario back.)
 */
export default async function NewRoleplayFromScenarioPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { scenario: slug } = await searchParams;
  if (!slug) notFound();

  const scenario = await getScenarioBySlug(slug);
  if (!scenario) notFound();

  const { cast, scopeLabel } = await getEligibleCastForScenario(scenario, 24);
  const characters = cast ?? (await getDiscoverChars({ limit: 24 })).allCharacters;
  const isScoped = cast !== null;

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-8 py-6">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Home
      </Link>

      <h1 className="mb-1 font-serif text-xl font-semibold text-text-primary">{scenario.title}</h1>
      <p className="mb-1 text-sm text-text-secondary">{scenario.tagline}</p>
      <p className="mb-6 text-sm text-text-tertiary">{scenario.setting}</p>

      <p className="mb-1 text-sm font-semibold text-text-primary">Who do you want this story with?</p>
      {isScoped && scopeLabel && (
        <p className="mb-4 flex items-center gap-1.5 text-xs text-gold-400">
          <Users className="h-3.5 w-3.5" />
          Only characters connected to {scopeLabel} can live this scene.
        </p>
      )}
      {!isScoped && <div className="mb-4" />}

      {characters.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-tertiary">
          {isScoped
            ? `No one from ${scopeLabel ?? "here"} is available right now — try again in a moment.`
            : "No companions available right now — try again in a moment."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {characters.map((character) => (
            <MediaCard
              key={character.id}
              href={`/roleplay/new/${character.id}?scenario=${encodeURIComponent(scenario.slug)}`}
              image={resolveImageSrc(character.image_url)}
              alt={character.name}
              className="w-full"
            >
              <div className="truncate text-[15px] font-semibold leading-tight text-text-primary">
                {character.name}
              </div>
            </MediaCard>
          ))}
        </div>
      )}
    </div>
  );
}
