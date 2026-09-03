import { TrendingUp, ThumbsUp, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { RelationshipForecast } from "@/lib/frontend/dating";

const LEVEL_LABELS: Record<RelationshipForecast["connectionLevel"], string> = {
  new: "New connection",
  building: "Building",
  strong: "Strong",
  deep: "Deep",
};

export function ForecastCard({ forecast }: { forecast: RelationshipForecast }) {
  const dims: Array<[string, string]> = [
    ["Conversation", forecast.dimensions.conversation],
    ["Emotional connection", forecast.dimensions.emotionalConnection],
    ["Shared interests", forecast.dimensions.sharedInterests],
    ["Pacing", forecast.dimensions.pacing],
  ];

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-gold-400" />
        <h2 className="text-sm font-semibold text-text-primary">Forecast</h2>
      </div>
      <p className="mb-4 text-lg text-gold-400">
        {forecast.headline}
        <span className="ml-2 text-xs font-normal text-text-secondary">
          {LEVEL_LABELS[forecast.connectionLevel]}
        </span>
      </p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {dims.map(([label, value]) => (
          <div key={label}>
            <p className="text-[11px] text-text-secondary">{label}</p>
            <p className="text-sm text-text-primary">{value}</p>
          </div>
        ))}
      </div>

      {forecast.strengthens.length > 0 && (
        <div className="mt-4 border-t border-border-hairline pt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
            <ThumbsUp className="h-3.5 w-3.5 text-gold-400" /> What&apos;s working
          </p>
          <ul className="flex flex-col gap-1">
            {forecast.strengthens.map((s, i) => (
              <li key={i} className="text-xs text-text-primary">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {forecast.friction.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
            <AlertCircle className="h-3.5 w-3.5 text-text-tertiary" /> Worth noticing
          </p>
          <ul className="flex flex-col gap-1">
            {forecast.friction.map((f, i) => (
              <li key={i} className="text-xs text-text-secondary">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-text-tertiary">
        {forecast.disclaimer}
      </p>
    </Card>
  );
}
