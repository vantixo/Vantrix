"use client";

import { useEffect, useMemo, useState } from "react";
import { Landmark } from "lucide-react";
import { RevealGroup, RevealItem } from "@/components/admin/motion/reveal";
import { WorldImageRow } from "@/components/admin/world/world-image-row";
import {
  fetchWorldImages,
  type AdminWorldLocation,
  type AdminWorldFaction,
} from "@/lib/frontend/admin-world-images";

/**
 * Backfill console for world_locations.image_url / factions.image_url —
 * see 20260827_world_location_faction_images.sql for why these columns
 * (referenced by the frontend since the World hub shipped) didn't exist
 * until now. Paste in banner art generated from the World location prompt
 * sheet and it's live on /world immediately — locations/factions with no
 * image_url set here just keep rendering WORLD_IMAGE_FALLBACK.
 */
export default function AdminWorldPage() {
  const [locations, setLocations] = useState<AdminWorldLocation[]>([]);
  const [factions, setFactions] = useState<AdminWorldFaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWorldImages()
      .then(({ locations, factions }) => {
        setLocations(locations);
        setFactions(factions);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setIsLoading(false));
  }, []);

  const missingCount = useMemo(
    () => [...locations, ...factions].filter((r) => !r.image_url).length,
    [locations, factions],
  );

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-16">
      <div>
        <h2 className="font-display text-2xl mb-1">World</h2>
        <p className="text-text-secondary text-sm">
          Banner images for the{" "}
          <a href="/world" target="_blank" rel="noreferrer" className="text-gold-400 hover:text-gold-300">
            World hub
          </a>
          {" "}— each location/faction card and detail-page hero.
          {!isLoading && (
            <>
              {" "}
              {missingCount > 0
                ? `${missingCount} still on the placeholder.`
                : "All set."}
            </>
          )}
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {isLoading ? (
        <p className="text-text-secondary text-sm">Loading…</p>
      ) : (
        <>
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Landmark className="h-4 w-4 text-gold-500" strokeWidth={1.75} />
              <h3 className="font-display text-lg">Locations ({locations.length})</h3>
            </div>
            <RevealGroup className="space-y-2.5">
              {locations.map((loc) => (
                <RevealItem key={loc.id}>
                  <WorldImageRow
                    type="location"
                    id={loc.id}
                    name={loc.name}
                    subtitle={loc.archetype}
                    badge={loc.is_capital ? "Capital" : undefined}
                    imageUrl={loc.image_url}
                  />
                </RevealItem>
              ))}
            </RevealGroup>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-3">
              <Landmark className="h-4 w-4 text-gold-500" strokeWidth={1.75} />
              <h3 className="font-display text-lg">Factions ({factions.length})</h3>
            </div>
            <RevealGroup className="space-y-2.5">
              {factions.map((f) => (
                <RevealItem key={f.id}>
                  <WorldImageRow
                    type="faction"
                    id={f.id}
                    name={f.name}
                    subtitle="faction"
                    badge={f.is_ruling ? "Ruling" : undefined}
                    imageUrl={f.image_url}
                  />
                </RevealItem>
              ))}
            </RevealGroup>
          </section>
        </>
      )}
    </div>
  );
}
