import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ChemistryDimensions } from "@/lib/frontend/dating";

const DIMENSION_LABELS: Record<
  Exclude<keyof ChemistryDimensions, "pacing" | "headline" | "reason">,
  string
> = {
  conversation: "Conversation",
  emotionalDepth: "Emotional Depth",
  humor: "Humor",
  playfulness: "Playfulness",
  intellectual: "Intellectual",
  adventure: "Adventure",
  affection: "Affection",
  directness: "Directness",
  mystery: "Mystery",
  engagement: "Engagement",
  progression: "Progression",
};

const PACING_LABELS: Record<ChemistryDimensions["pacing"], string> = {
  slow_burn: "Slow burn",
  steady: "Steady",
  fast: "Fast-moving",
};

function DimensionBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-primary">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gold-fill"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export function ChemistryCard({ dimensions }: { dimensions: ChemistryDimensions }) {
  const { headline } = dimensions;
  const rows = (Object.keys(DIMENSION_LABELS) as Array<keyof typeof DIMENSION_LABELS>).map(
    (key) => ({ key, label: DIMENSION_LABELS[key], value: dimensions[key] as number })
  );

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-gold-400" />
        <h2 className="text-sm font-semibold text-text-primary">Chemistry</h2>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="font-display text-2xl text-gold-400">{headline.chemistry}%</p>
          <p className="mt-0.5 text-[11px] text-text-secondary">Chemistry</p>
        </div>
        <div>
          <p className="font-display text-2xl text-gold-400">{headline.conversation}%</p>
          <p className="mt-0.5 text-[11px] text-text-secondary">Conversation</p>
        </div>
        <div>
          <p className="font-display text-2xl text-gold-400">{headline.attraction}%</p>
          <p className="mt-0.5 text-[11px] text-text-secondary">Attraction</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <DimensionBar key={row.key} label={row.label} value={row.value} />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border-hairline pt-3 text-xs">
        <span className="text-text-secondary">Pacing</span>
        <span className="text-gold-400">{PACING_LABELS[dimensions.pacing]}</span>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-text-tertiary">{dimensions.reason}</p>
    </Card>
  );
}
