import { Suspense } from "react";
import { searchCharacters } from "@/lib/frontend/characters";
import { CharactersBrowse } from "@/components/characters/characters-browse";

export const dynamic = "force-dynamic";

/**
 * §11: Home's "View All" link, the Characters nav item, and the top
 * bar's search icon all target this route (all previously 404s — see
 * top-bar.tsx and featured-companions.tsx, both already written against
 * this path). §12 Phase 3 (Discovery) covers this alongside the Home
 * page itself.
 *
 * SUSPENSE FIX: CharactersBrowse now calls useSearchParams() (to seed
 * `q` from Home's search bar — see its own URL-SEED FIX comment). The
 * App Router requires a Suspense boundary around any useSearchParams()
 * consumer regardless of force-dynamic, or Next.js flags/deopts the
 * whole route at build time. `initial` still renders instantly as the
 * fallback since it's already resolved server-side above.
 */
export default async function CharactersPage() {
  // Mirrors CharactersBrowse's default `gender` state ("female" — see its
  // own comment on why "all" is no longer a selectable option). This used
  // to be an unfiltered fetch, which quietly stopped matching the client's
  // default filter once that pill was removed; `initial` would show mixed
  // genders under an actively-highlighted "Female" pill, so the client
  // only trusted it when gender==="all" — a state nothing in the UI can
  // produce anymore. Fetching with the same default filter here makes
  // `initial` valid to show again, restoring the instant-first-paint this
  // route was built for instead of every visit starting on a loading spinner.
  const initial = await searchCharacters({ limit: 60, gender: "female" });
  return (
    <Suspense fallback={<CharactersBrowse initial={initial} />}>
      <CharactersBrowse initial={initial} />
    </Suspense>
  );
}
