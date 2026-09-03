// scripts/backfill-legendary-scenes.ts
// ─────────────────────────────────────────────────────────────────────────────
// One-time backfill: composes a real scene for a curated set of resident-
// having locations, via the exact same composeUniverseScene() the live Scene
// Builder uses (scene-composer.ts) — not a reimplementation, so moderation,
// R2 upload, and the universe_scenes write path are identical to production.
//
// WHY THIS EXISTS: every universe_scenes row before the IMAGE-PROVIDER FIX
// (see scene-composer.ts's own doc comment) was stuck in status: 'failed' —
// the composer was calling Fal.ai directly with no fallback, and Fal was
// rejecting every request ("Forbidden"). That's why Home's "Legendary
// Scenes" row (getFeaturedUniverseScenes only returns status: 'complete'
// rows) has been empty. The fix routes image generation through
// generatePrimaryImage() (HotAPI primary, Atlas backup, Fal last resort)
// instead — this script exists to populate real scenes once that fix is
// live, rather than waiting for one to appear organically.
//
// This does NOT fix the underlying credentials on its own. Run
// `npm run verify:prod` (or check HOTAPI_API_KEY / ATLAS_API_KEY in your
// deploy environment) first — if those are missing, every entry below will
// fail exactly the way the old ones did, just via a different provider.
//
// Cast IDs are pulled directly from companion_occupations for each location,
// so composeUniverseScene's residentIdsForLocation() check passes — see that
// file's own comment on why an arbitrary character ID would be rejected.
//
// Usage:
//   tsx --env-file=.env.local scripts/backfill-legendary-scenes.ts
//   tsx --env-file=.env.local scripts/backfill-legendary-scenes.ts --dry-run
//   tsx --env-file=.env.local scripts/backfill-legendary-scenes.ts --with-video
//
// --dry-run    prints what would be generated without calling any provider.
// --with-video also generates a short video for each scene (slower, pricier
//              — see PLATFORM_DAILY_VIDEO_BUDGET's own comment in env.ts).
//              Off by default so a first run is fast and cheap to sanity-check.

import { composeUniverseScene, type SceneGenre } from "@/lib/universe/scene-composer";

interface BackfillEntry {
  locationSlug: string;
  characterIds: string[];
  genre: SceneGenre;
  factionSlug?: string;
  customDirection?: string;
}

// Locations chosen from world_locations rows that actually have residents
// (composeUniverseScene requires cast to be residents — see
// residentIdsForLocation() in scene-composer.ts). Genre picked to match
// each location's own archetype/culture/description rather than generically
// reused, so these don't all read the same once they're on Home together.
// Character IDs are the first few companion_occupations rows for that
// location as of the audit that produced this list — re-check
// `select character_id from companion_occupations where location_id = ...`
// if a location's residents have changed since.
const BACKFILL_ENTRIES: BackfillEntry[] = [
  {
    locationSlug: "the-capital",
    genre: "political-drama",
    characterIds: [
      "126dc769-d0b0-4fc8-9b80-03ee8c9c7970",
      "0204e365-aa9f-4880-a500-f2f51ddc4f81",
      "c735a164-de16-4660-87fe-07cccafd4733",
      "79981484-2712-44bc-8520-e3e347439799",
    ],
  },
  {
    locationSlug: "iron-reach",
    genre: "heist",
    characterIds: [
      "f1030e41-0548-463c-b662-8b1bfdc5dd23",
      "b4ece831-aae2-4a72-af94-22d34f19521c",
      "3d273314-8a27-4d9f-9293-2b2e4d95797f",
    ],
  },
  {
    locationSlug: "the-undercroft",
    genre: "noir-thriller",
    characterIds: [
      "d3988777-d4a1-4c5e-9793-dc7a655d01e4",
      "7546beba-fc4b-40c6-b1a1-ebfd5ab15af4",
      "498c8fc5-c241-4530-84f9-0e63fbed5283",
    ],
  },
  {
    locationSlug: "cloudspire",
    genre: "cyberpunk",
    characterIds: [
      "6b79f90e-3020-4bba-ae84-a53f8f15e91c",
      "80e25f8b-fb62-4223-998d-049cc0efdd40",
    ],
  },
  {
    locationSlug: "the-archive",
    genre: "slice-of-life",
    characterIds: [
      "e7b37b30-8b9d-4751-ad53-74781ff68896",
      "17f0670d-0d65-41e1-ad33-5fec5b4baf54",
    ],
  },
  {
    locationSlug: "obsidian-tower",
    genre: "high-fantasy",
    characterIds: [
      "7ce1cccf-475d-4da8-aef1-e5d59f080718",
      "f8330421-36f7-4613-8672-3096d4d609b6",
      "e8413970-dbad-4dd7-88e4-3e0abb2ef675",
    ],
  },
  {
    locationSlug: "wing-of-the-drowned-court",
    genre: "high-fantasy",
    factionSlug: "drowned-court",
    characterIds: [
      "15762e58-f88d-4456-a4d6-908517f571c7",
      "fc0799bc-7b83-410e-beec-24a00c4c2e79",
    ],
  },
  {
    locationSlug: "wing-of-the-ash-camps",
    genre: "war-and-conflict",
    factionSlug: "ash-banners",
    characterIds: [
      "d173bcc3-2c4c-4ab1-8a62-822dfcc136e2",
      "5c5b064e-1b2b-4160-b92d-cecbc6d340c5",
    ],
  },
  {
    locationSlug: "wing-of-the-long-sky",
    genre: "high-fantasy",
    factionSlug: "long-sky-circle",
    characterIds: [
      "47436ec7-122b-4f1a-8815-5346b00365ad",
      "cb3aff66-04a8-443b-a5bb-9ac610ec7f04",
    ],
  },
  {
    locationSlug: "the-fourth-wall-wing",
    genre: "horror",
    characterIds: [
      "edb05e90-3503-4c06-bfab-42c019ec5dbd",
      "d49b55e6-a935-42f0-8e88-cbd8b1321244",
    ],
  },
];

const DRY_RUN = process.argv.includes("--dry-run");
const WITH_VIDEO = process.argv.includes("--with-video");

// Stay well under the imageGen circuit breaker's failure threshold and give
// each provider room to breathe between calls — this is a one-time backfill,
// not a latency-sensitive path, so there's no reason to hammer the router.
const DELAY_BETWEEN_CALLS_MS = 4000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Backfilling ${BACKFILL_ENTRIES.length} legendary scene(s)${DRY_RUN ? " (dry run)" : ""}${WITH_VIDEO ? " with video" : ""}...\n`);

  let succeeded = 0;
  let failed = 0;

  for (const entry of BACKFILL_ENTRIES) {
    if (DRY_RUN) {
      console.log(`[dry-run] would compose: ${entry.locationSlug} · ${entry.genre} · ${entry.characterIds.length} cast${entry.factionSlug ? ` · faction ${entry.factionSlug}` : ""}`);
      continue;
    }

    process.stdout.write(`${entry.locationSlug} (${entry.genre})... `);
    try {
      const result = await composeUniverseScene({
        locationSlug: entry.locationSlug,
        factionSlug: entry.factionSlug,
        characterIds: entry.characterIds,
        genre: entry.genre,
        customDirection: entry.customDirection,
        generateVideo: WITH_VIDEO,
      });

      if (result.success) {
        succeeded++;
        console.log(`OK — scene ${result.sceneId}${result.videoUrl ? " (with video)" : ""}`);
      } else {
        failed++;
        console.log(`FAILED — ${result.error ?? "unknown error"}`);
      }
    } catch (err) {
      failed++;
      console.log(`FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }

    await sleep(DELAY_BETWEEN_CALLS_MS);
  }

  if (DRY_RUN) return;

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
  if (failed > 0) {
    console.log("Failures usually mean HOTAPI_API_KEY/ATLAS_API_KEY aren't set in this environment yet — check `npm run verify:prod` before re-running.");
  }
  if (succeeded > 0) {
    console.log("Home's \"Legendary Scenes\" row and each location's Scene Gallery pull live from universe_scenes, so no further step is needed — refresh to see them.");
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Backfill script crashed:", err);
  process.exit(1);
});
