"use client";

import { useState } from "react";
import { Check, Loader2, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { saveScenarioImage } from "@/lib/frontend/admin-scenario-images";
import type { AdminScenario } from "@/lib/frontend/admin-scenario-images";

const inputCls =
  "w-full h-10 px-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 outline-none";

/** Same independent-save-per-row pattern as WorldImageRow — see that
 * component's doc comment for why (28 rows here, same argument applies). */
export function ScenarioImageRow({ scenario }: { scenario: AdminScenario }) {
  const [value, setValue] = useState(scenario.cover_image_url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedJustNow, setSavedJustNow] = useState(false);

  const dirty = value !== (scenario.cover_image_url ?? "");
  const place = scenario.location_slug ?? scenario.faction_slug;

  async function save() {
    setSaving(true);
    setError(null);
    setSavedJustNow(false);
    try {
      const saved = await saveScenarioImage(scenario.id, value.trim());
      setValue(saved ?? "");
      setSavedJustNow(true);
      setTimeout(() => setSavedJustNow(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card interactive={false} className="p-3.5 flex items-center gap-3.5">
      <div className="relative h-14 w-24 rounded-xs overflow-hidden shrink-0 border border-border-hairline bg-white/5">
        {value.trim() && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.visibility = "hidden";
            }}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-sm font-medium text-text-primary truncate">{scenario.title}</span>
          <Badge>{scenario.genre}</Badge>
          {scenario.min_tier === "premium" && <Badge>Premium</Badge>}
          {place && <span className="text-xs text-text-tertiary truncate">{place}</span>}
        </div>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="/images/scenarios/… or https://…"
          maxLength={500}
          className={inputCls}
        />
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        aria-label="Save image"
        className="h-9 w-9 flex items-center justify-center rounded-xs text-text-tertiary hover:text-gold-400 hover:bg-gold-500/10 shrink-0 disabled:opacity-30 disabled:pointer-events-none"
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : savedJustNow ? (
          <Check className="h-4 w-4 text-gold-400" />
        ) : (
          <Save className="h-4 w-4" />
        )}
      </button>
    </Card>
  );
}
