"use client";

import { useEffect, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Loader2, Crown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, resolveImageSrc } from "@/lib/utils";
import type { Legend, LegendType } from "@/types/legacy-systems";

const LEGEND_TYPE_LABELS: Record<LegendType, string> = {
  wealth: "Wealth",
  discovery: "Discovery",
  political: "Political",
  military: "Military",
  cultural: "Cultural",
  reputation: "Reputation",
  founder: "Founder",
  tragic: "Tragic",
};

/**
 * getActiveLegends() (status-legend.ts) had a complete backend — hard
 * scarcity cap of 12 active legends universe-wide — and zero UI. Copies
 * GovernancePanel's self-contained fetch-on-mount tab pattern.
 */
export function LegendsPanel() {
  const [legends, setLegends] = useState<Legend[] | null>(null);
  const [maxLegends, setMaxLegends] = useState(12);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/universe/legends")
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setLegends(body.legends ?? []);
        if (typeof body.max_legends === "number") setMaxLegends(body.max_legends);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load legends.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-text-tertiary py-8 text-center">{error}</p>;

  if (!legends) {
    return (
      <div className="flex items-center justify-center py-16 text-text-secondary">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-text-tertiary uppercase tracking-wide mb-4">
        {legends.length} of {maxLegends} legend slots claimed — legendary status is rare by design.
      </p>

      {legends.length === 0 ? (
        <p className="text-sm text-text-tertiary">No legends have been declared yet.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {legends.map((legend) => (
            <Card key={legend.id} className="p-4 flex gap-3">
              <Image
                src={resolveImageSrc(legend.character?.image_url)}
                alt={legend.character?.name ?? "Legend"}
                width={48}
                height={48}
                className="h-12 w-12 rounded-full object-cover shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Crown className="h-3.5 w-3.5 text-gold-500 shrink-0" />
                  <span className="text-sm font-semibold text-text-primary truncate">
                    {legend.legend_title}
                  </span>
                  <Badge variant="outline" className="shrink-0">
                    {LEGEND_TYPE_LABELS[legend.legend_type]}
                  </Badge>
                </div>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {legend.character?.name ?? "Unknown"}
                </p>
                <p className={cn("text-sm text-text-secondary mt-2 line-clamp-3")}>
                  {legend.biography}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
