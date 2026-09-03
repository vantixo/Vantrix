/**
 * Universe Image Backfill
 * ─────────────────────────────────────────────────────────────────────────────
 * Sweeps every world_location, faction, and character with no image and
 * generates one, so nothing in the Universe is text-only. Designed to be
 * called from an admin action or a cron route — processes in small batches
 * with a delay between Fal calls to stay under rate limits, and returns a
 * per-entity result list rather than throwing on the first failure, so one
 * bad prompt doesn't stop the rest of the sweep.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateLocationImage, generateFactionImage } from "./generate-entity-image";
import { generateCharacterImage, DEFAULT_SCENE_PROMPTS } from "./generate-image";
import { hasTrainedLora, type CharacterBibleRow } from "./character-bible";
import { logger } from "@/lib/logger";
import type { LocationArchetype } from "@/types/world-expansion";

export interface BackfillEntityResult {
  kind: "location" | "faction" | "character";
  id: string;
  name: string;
  success: boolean;
  error?: string;
}

const VALID_LOCATION_ARCHETYPES: readonly LocationArchetype[] =
  ["city", "district", "outpost", "landmark", "wilderness"];

/**
 * world_locations.archetype is plain TEXT at the DB layer (see
 * 20260811_universe_visual_coverage.sql — no check constraint), while the
 * app-level WorldLocation type narrows it to LocationArchetype for
 * everywhere else that relies on it being one of the known set. Rather
 * than loosening that type (and losing the safety it gives every other
 * caller) or silently dropping rows with an unexpected value (which would
 * quietly shrink the backfill sweep), validate here and fall back to the
 * most neutral archetype — this only affects the generated image prompt's
 * wording, never blocks the location from getting an image.
 */
function toLocationArchetype(value: string, locationId: string): LocationArchetype {
  if ((VALID_LOCATION_ARCHETYPES as readonly string[]).includes(value)) {
    return value as LocationArchetype;
  }
  logger.warn("backfill-universe-images: unexpected world_locations.archetype value, defaulting to 'city'", {
    locationId, value,
  });
  return "city";
}

export interface BackfillSummary {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: BackfillEntityResult[];
}

// OPTIMIZATION: the previous version processed one entity at a time with a
// fixed sleep between every single generation — a 20+20+20 sweep meant ~60
// sequential Fal round-trips (each several seconds) plus 60 fixed delays,
// often several minutes wall-clock for one cron run. Fal calls already sit
// behind `breakers.imageGen()` (5-failure/60s-timeout circuit breaker, see
// lora-pipeline.ts), so bounded concurrency is safe: it can't overwhelm a
// downstream outage any worse than the breaker already guards against, and
// within Fal's own rate limits, running a handful in flight at once is the
// actual bottleneck fix (network/generation latency, not CPU).
const CONCURRENCY = 4;

/** Runs `worker` over `items` with at most CONCURRENCY in flight at once. */
async function mapWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function runNext(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    results[i] = await worker(items[i]);
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, runNext));
  return results;
}

async function backfillLocations(limitPerKind: number): Promise<BackfillEntityResult[]> {
  const { data: locations } = await supabaseAdmin
    .from("world_locations")
    .select("id, name, archetype, description, culture, government_type, is_capital")
    .is("image_url", null)
    .limit(limitPerKind);

  return mapWithConcurrency(locations ?? [], async (loc) => {
    const result = await generateLocationImage({
      ...loc,
      archetype: toLocationArchetype(loc.archetype, loc.id),
    });
    if (result.success && result.imageUrl) {
      await supabaseAdmin
        .from("world_locations")
        .update({ image_url: result.imageUrl, image_generated_at: new Date().toISOString() })
        .eq("id", loc.id);
    }
    return { kind: "location" as const, id: loc.id, name: loc.name, success: result.success, error: result.error };
  });
}

async function backfillFactions(limitPerKind: number): Promise<BackfillEntityResult[]> {
  const { data: factions } = await supabaseAdmin
    .from("factions")
    .select("id, name, ideology, description, sigil_description, culture")
    .is("image_url", null)
    .limit(limitPerKind);

  return mapWithConcurrency(factions ?? [], async (f) => {
    const result = await generateFactionImage(f);
    if (result.success && result.imageUrl) {
      await supabaseAdmin
        .from("factions")
        .update({ image_url: result.imageUrl, image_generated_at: new Date().toISOString() })
        .eq("id", f.id);
    }
    return { kind: "faction" as const, id: f.id, name: f.name, success: result.success, error: result.error };
  });
}

async function backfillCharacters(limitPerKind: number): Promise<BackfillEntityResult[]> {
  // Only characters with a trained LoRA can go through generateCharacterImage
  // (identity-lock requirement — see generate-image.ts). Characters without
  // one yet are skipped here, not failed, since that's a separate prerequisite
  // step (LoRA training), not a bug in this sweep.
  const { data: characters } = await supabaseAdmin
    .from("characters")
    .select("*")
    .is("image_url", null)
    .limit(limitPerKind);

  return mapWithConcurrency((characters ?? []) as CharacterBibleRow[], async (c) => {
    if (!hasTrainedLora(c)) {
      return { kind: "character" as const, id: c.id, name: c.name, success: false, error: "no_trained_lora_yet" };
    }
    const scenePrompt = DEFAULT_SCENE_PROMPTS[Math.floor(Math.random() * DEFAULT_SCENE_PROMPTS.length)];
    const result = await generateCharacterImage(c, scenePrompt);
    if (result.success && result.imageUrl) {
      await supabaseAdmin.from("characters").update({ image_url: result.imageUrl }).eq("id", c.id);
    }
    return { kind: "character" as const, id: c.id, name: c.name, success: result.success, error: result.error };
  });
}

export async function backfillUniverseImages(limitPerKind = 20): Promise<BackfillSummary> {
  // The three kinds hit different Supabase tables and are independent of
  // each other, so they also run concurrently rather than one full kind
  // after another — locations/factions/characters no longer wait in line
  // behind each other, only within their own kind (via CONCURRENCY above).
  const [locationResults, factionResults, characterResults] = await Promise.all([
    backfillLocations(limitPerKind),
    backfillFactions(limitPerKind),
    backfillCharacters(limitPerKind),
  ]);

  const results = [...locationResults, ...factionResults, ...characterResults];
  const skipped = results.filter((r) => r.error === "no_trained_lora_yet").length;
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded - skipped;

  logger.info("backfill-universe-images: sweep complete", {
    processed: results.length,
    succeeded,
    failed,
    skipped,
  });

  return { processed: results.length, succeeded, failed, skipped, results };
}
