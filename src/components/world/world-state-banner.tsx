import { Sparkles } from "lucide-react";
import type { UniverseState } from "@/types/world-expansion";

const SEASON_LABEL: Record<string, string> = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  winter: "Winter",
};

const MOOD_LABEL: Record<string, string> = {
  hopeful: "Hopeful",
  tense: "Tense",
  prosperous: "Prosperous",
  volatile: "Volatile",
  melancholic: "Melancholic",
  celebratory: "Celebratory",
  grim: "Grim",
  uncertain: "Uncertain",
};

/**
 * §12 Phase 5's "world state" — season/mood/tick/year — surfaced as the
 * ambient header GET /api/universe/world's own docstring says it backs.
 * No new "meaning" color introduced for mood (§1's no-mixed-accent rule
 * applies here too); gold marks the values, plain text carries the mood
 * word itself.
 */
export function WorldStateBanner({ state }: { state: UniverseState }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-border-hairline px-5 py-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-gold-500" strokeWidth={1.75} />
        <span className="text-sm text-text-secondary">
          Year <span className="text-text-primary font-semibold">{state.year}</span>,{" "}
          {SEASON_LABEL[state.season] ?? state.season}
        </span>
      </div>
      <div className="text-sm text-text-secondary">
        World mood{" "}
        <span className="text-gold-400 font-semibold">
          {MOOD_LABEL[state.world_mood] ?? state.world_mood}
        </span>
      </div>
      <div className="text-sm text-text-secondary tabular-nums">
        Tick <span className="text-text-primary font-semibold">{state.tick_count.toLocaleString()}</span>
      </div>
    </div>
  );
}
