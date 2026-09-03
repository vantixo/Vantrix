"use client";

import { useState } from "react";
import { SceneBuilder } from "./scene-builder";
import { SceneGallery } from "./scene-gallery";
import type { LocationResident } from "@/types/universe-views";
import type { LocationScene } from "@/lib/universe/world-atlas";

/**
 * Ties the Scene Builder form to the gallery below it: a newly-composed
 * scene is prepended immediately (POST /api/universe/scenes already
 * returns the finished image/video synchronously — see composeUniverseScene
 * — so there's no polling to wire up, just local state) rather than
 * requiring a full page refresh to see what was just made.
 */
export function SceneStudio({
  locationSlug,
  residents,
  factions,
  initialScenes,
}: {
  locationSlug: string;
  residents: LocationResident[];
  factions: { id: string; name: string; slug: string }[];
  initialScenes: LocationScene[];
}) {
  const [scenes, setScenes] = useState<LocationScene[]>(initialScenes);

  return (
    <div className="space-y-5">
      <SceneBuilder
        locationSlug={locationSlug}
        residents={residents}
        factions={factions}
        onCreated={(scene) => setScenes((prev) => [scene, ...prev])}
      />
      <SceneGallery scenes={scenes} residents={residents} factions={factions} />
    </div>
  );
}
