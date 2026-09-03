import "server-only";
import {
  getWorldOverview,
  getAllLocations,
  getLocationBySlug,
  getAllFactions,
  getFactionBySlug,
  getFeaturedUniverseScenes,
  getLocationImages,
} from "@/lib/universe/world-atlas";
import { getActiveDailyChoice, type DailyWorldChoice } from "@/lib/universe/daily-choice";
import type {
  WorldOverview,
  LocationSummary,
  LocationDetail,
  FactionSummary,
  FactionDetail,
} from "@/types/universe-views";
import type { WorldEvent, WorldStory } from "@/types/world-expansion";
import type { FeaturedScene } from "@/lib/universe/world-atlas";

/**
 * §11 Domain Map: "universe/world, /status, ... -> World page". All four
 * routes this page needs (world, locations, factions, and each detail
 * variant) are thin wrappers — an auth check plus a direct call into
 * lib/universe/world-atlas.ts (see those route files) — so per §10 this
 * calls the same lib functions directly from the World Server Component
 * instead of adding a redundant HTTP hop through fetchInternal. The
 * underlying functions already fail soft (empty array / null on error,
 * see world-atlas.ts), so no extra try/catch is needed here.
 */
export interface WorldHubData {
  overview: WorldOverview;
  locations: LocationSummary[];
  factions: FactionSummary[];
}

export async function getWorldHub(): Promise<WorldHubData> {
  const [overview, locations, factions] = await Promise.all([
    getWorldOverview(),
    getAllLocations(),
    getAllFactions(),
  ]);
  return { overview, locations, factions };
}

export async function getWorldLocation(
  slug: string
): Promise<LocationDetail | null> {
  return getLocationBySlug(slug);
}

export async function getWorldFaction(
  slug: string
): Promise<FactionDetail | null> {
  return getFactionBySlug(slug);
}

/**
 * Home's "Legendary Scenes" row — see getFeaturedUniverseScenes's own doc
 * comment for how "most valuable" is scored. Same thin-wrapper pattern as
 * the rest of this file.
 */
export async function getFeaturedScenes(limit?: number): Promise<FeaturedScene[]> {
  return getFeaturedUniverseScenes(limit);
}

export interface HomeWorldTeaser {
  event: WorldEvent | null;
  /** Real photo for event.location_id, resolved below — null if the event
   *  has no location or that location has no image_url set yet. */
  eventLocationImage: string | null;
  story: WorldStory | null;
  choice: DailyWorldChoice | null;
  /** Real photo for choice.locationId, same resolution as above. */
  choiceLocationImage: string | null;
}

/**
 * Home's "Your World" strip — a 3-tile teaser (one live event, one
 * ongoing story, today's world choice) pointing back at the full World
 * hub, rather than a fourth full data surface of its own.
 *
 * Deliberately calls getWorldOverview() directly instead of getWorldHub()
 * above — getWorldHub() also fetches every location and faction (with
 * their governance/economy joins), and Home only ever renders the first
 * event and first story, so pulling those extra ~30-40 rows onto Home's
 * critical path would be pure waste. getWorldOverview() and
 * getActiveDailyChoice() are both public-read and already fail soft to
 * empty/null internally (see world-atlas.ts / daily-choice.ts), so the
 * try/catch here is just an extra guard against something failing
 * between those two calls, not the primary safety net.
 *
 * A resolved choice is dropped rather than shown — "today's decision" is
 * only worth a tile while it's still open to react to; once resolved,
 * its outcome belongs to the World hub's own history, not this teaser.
 *
 * REAL-IMAGE FIX: this teaser used to hand YourWorld nothing but text,
 * on the stated assumption that no location photography existed for
 * events/stories/choices (see your-world.tsx's prior doc comment) — that
 * assumption is no longer true. Locations now carry a real image_url
 * (world_locations.image_url, same field world-cards.tsx's LocationCard
 * already renders), and world stories already resolve each participant's
 * real character photo via participant_characters[i].image_url (see
 * WorldStory's own doc comment in types/world-expansion.ts) — so only the
 * event and choice tiles needed a new lookup here; the story tile can
 * read straight off data this function already fetched. Uses the same
 * lightweight getLocationImages() (id/image_url only, no governance/
 * economy fan-out) rather than getAllLocations() or getWorldHub(), for
 * the same "don't pull ~30-40 unused rows onto Home's critical path"
 * reason the rest of this doc comment already gives.
 */
export async function getHomeWorldTeaser(): Promise<HomeWorldTeaser> {
  try {
    const [{ events, stories }, choice] = await Promise.all([
      getWorldOverview(),
      getActiveDailyChoice(),
    ]);
    const event = events[0] ?? null;
    const activeChoice = choice && !choice.resolved ? choice : null;

    const locationIds = [event?.location_id, activeChoice?.locationId].filter(
      (id): id is string => Boolean(id)
    );
    const imagesByLocation = await getLocationImages(locationIds);

    return {
      event,
      eventLocationImage: event?.location_id ? imagesByLocation.get(event.location_id) ?? null : null,
      story: stories[0] ?? null,
      choice: activeChoice,
      choiceLocationImage: activeChoice?.locationId
        ? imagesByLocation.get(activeChoice.locationId) ?? null
        : null,
    };
  } catch {
    return { event: null, eventLocationImage: null, story: null, choice: null, choiceLocationImage: null };
  }
}
