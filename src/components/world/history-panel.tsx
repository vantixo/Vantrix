"use client";

import { useEffect, useState } from "react";
import { Loader2, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineEntry } from "@/types/legacy-systems";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * world-history.ts: the global event timeline (getWorldTimeline) — fully
 * built, zero UI. Copies GovernancePanel's tab pattern. Uses the default
 * unscoped route (global timeline) — per-location/per-character history
 * already renders elsewhere (location/faction detail pages, a character's
 * own profile), so this tab stays global rather than duplicating those.
 */
export function HistoryPanel() {
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/universe/history")
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setTimeline(body.timeline ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load world history.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-text-tertiary py-8 text-center">{error}</p>;

  if (!timeline) {
    return (
      <div className="flex items-center justify-center py-16 text-text-secondary">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (timeline.length === 0) {
    return <p className="text-sm text-text-tertiary">No recorded history yet.</p>;
  }

  return (
    <div className="space-y-0">
      {timeline.map((entry, i) => (
        <div key={`${entry.occurred_at}-${i}`} className="flex gap-3 pb-5">
          <div className="flex flex-col items-center shrink-0">
            <span
              className={cn(
                "h-2 w-2 rounded-full mt-1.5",
                entry.significance >= 4 ? "bg-gold-400" : "bg-gold-500/30"
              )}
            />
            {i < timeline.length - 1 && (
              <span className="w-px flex-1 bg-border-hairline mt-1" />
            )}
          </div>
          <div className="min-w-0 flex-1 -mt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <ScrollText className="h-3 w-3 text-text-tertiary shrink-0" />
              <span className="text-sm font-medium text-text-primary">{entry.title}</span>
              <span className="text-xs text-text-tertiary">{formatDate(entry.occurred_at)}</span>
            </div>
            <p className="text-sm text-text-secondary mt-1">{entry.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
