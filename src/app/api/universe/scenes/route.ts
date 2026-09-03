/**
 * POST /api/universe/scenes — compose a full multi-character scene tied to
 * a city/town/faction + genre, generating an image and (optionally) video.
 * GET  /api/universe/scenes?locationSlug=... — list previously generated
 * scenes for a location, newest first.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { composeUniverseScene, SCENE_GENRES, type SceneGenre } from "@/lib/universe/scene-composer";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

// Scene generation is expensive (Fal + optional Kling round-trip) and the
// list barely changes between requests, so a short cache — same TTL/pattern
// world-atlas.ts already uses for locations/factions — avoids re-querying
// Supabase (plus a join) on every gallery view/refresh.
const SCENES_CACHE_TTL = 60;
const scenesCacheKey = (locationSlug: string | null) => `vantrix:universe:scenes:${locationSlug ?? "all"}`;

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: {
    locationSlug?: string;
    factionSlug?: string;
    characterIds?: string[];
    genre?: string;
    customDirection?: string;
    generateVideo?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { locationSlug, factionSlug, characterIds = [], genre, customDirection, generateVideo = false } = body;

  if (!locationSlug) return NextResponse.json({ error: "locationSlug_required" }, { status: 400 });
  if (!genre || !SCENE_GENRES.includes(genre as SceneGenre)) {
    return NextResponse.json({ error: "invalid_genre", validGenres: SCENE_GENRES }, { status: 400 });
  }
  if (!Array.isArray(characterIds) || characterIds.length === 0) {
    return NextResponse.json({ error: "at_least_one_character_required" }, { status: 400 });
  }
  if (characterIds.length > 6) {
    return NextResponse.json({ error: "too_many_characters_max_6" }, { status: 400 });
  }

  try {
    const result = await composeUniverseScene({
      locationSlug,
      factionSlug,
      characterIds,
      genre: genre as SceneGenre,
      customDirection,
      generateVideo,
      createdBy: user.id,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? "generation_failed", sceneId: result.sceneId }, { status: 502 });
    }

    // A newly-generated scene invalidates both the "all scenes" cache and
    // this specific location's cache — otherwise the gallery would keep
    // serving the pre-generation snapshot for up to SCENES_CACHE_TTL.
    try {
      await Promise.all([
        redis.del(scenesCacheKey(null)),
        redis.del(scenesCacheKey(locationSlug)),
      ]);
    } catch { /* cache invalidation is best-effort, not fatal */ }

    return NextResponse.json(result);
  } catch (err) {
    logger.error("api/universe/scenes: unhandled error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const locationSlug = req.nextUrl.searchParams.get("locationSlug");
  const cacheKey = scenesCacheKey(locationSlug);

  try {
    const cached = await redis.get<{ scenes: unknown[] }>(cacheKey);
    if (cached) return NextResponse.json(cached);
  } catch { /* cache miss/unavailable — fall through to DB */ }

  let query = supabaseAdmin
    .from("universe_scenes")
    .select("id, location_id, faction_id, character_ids, genre, image_url, video_url, status, created_at, location:world_locations(slug, name)")
    .order("created_at", { ascending: false })
    .limit(30);

  if (locationSlug) {
    const { data: loc } = await supabaseAdmin.from("world_locations").select("id").eq("slug", locationSlug).maybeSingle();
    if (!loc) return NextResponse.json({ scenes: [] });
    query = query.eq("location_id", loc.id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const payload = { scenes: data ?? [] };
  try { await redis.set(cacheKey, payload, { ex: SCENES_CACHE_TTL }); } catch { /* ok */ }

  return NextResponse.json(payload);
}
