"use client";

import { useEffect, useMemo, useState } from "react";
import { Clapperboard } from "lucide-react";
import { RevealGroup, RevealItem } from "@/components/admin/motion/reveal";
import { ScenarioImageRow } from "@/components/admin/scenarios/scenario-image-row";
import { fetchScenarioImages, type AdminScenario } from "@/lib/frontend/admin-scenario-images";

/**
 * Backfill console for roleplay_scenarios.cover_image_url — see
 * 20260903_seed_scenario_dedicated_images.sql for the 4 scenarios that
 * already had art (just wired inconsistently before this page existed)
 * and the scenario prompt sheet for the rest. Paste in a cover and it's
 * live everywhere the scenario renders — scenario-picker, World hub
 * "Scenarios Here", the roleplay stage backdrop, and Home's Popular
 * Scenarios — immediately, same as /admin/world.
 */
export default function AdminScenariosPage() {
  const [scenarios, setScenarios] = useState<AdminScenario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchScenarioImages()
      .then(setScenarios)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setIsLoading(false));
  }, []);

  const missingCount = useMemo(
    () => scenarios.filter((s) => !s.cover_image_url).length,
    [scenarios],
  );

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-16">
      <div>
        <h2 className="font-display text-2xl mb-1">Scenarios</h2>
        <p className="text-text-secondary text-sm">
          Cover images for Story Mode — the scenario picker, World hub
          &quot;Scenarios Here&quot; sections, and the roleplay stage backdrop.
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
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Clapperboard className="h-4 w-4 text-gold-500" strokeWidth={1.75} />
            <h3 className="font-display text-lg">All Scenarios ({scenarios.length})</h3>
          </div>
          <RevealGroup className="space-y-2.5">
            {scenarios.map((s) => (
              <RevealItem key={s.id}>
                <ScenarioImageRow scenario={s} />
              </RevealItem>
            ))}
          </RevealGroup>
        </section>
      )}
    </div>
  );
}
