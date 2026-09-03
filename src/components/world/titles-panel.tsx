"use client";

import { useEffect, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Loader2, Medal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { resolveImageSrc } from "@/lib/utils";
import type { CharacterTitle, ReputationTitleKey } from "@/types/world-expansion";

// Mirrors TITLE_LABELS in lib/universe/reputation-titles.ts (a server-only
// module — supabaseAdmin can't ship to the client bundle), and ALL_KEYS
// from the /api/universe/titles route, so the leaderboard order/labels
// here match the route's own default (unscoped) response exactly.
const TITLE_LABELS: Record<ReputationTitleKey, string> = {
  most_trusted: "Most Trusted",
  most_influential: "Most Influential",
  most_loved: "Most Loved",
  most_feared: "Most Feared",
  most_generous: "Most Generous",
  most_mysterious: "Most Mysterious",
  most_admired: "Most Admired",
  most_notorious: "Most Notorious",
};

const TITLE_KEYS = Object.keys(TITLE_LABELS) as ReputationTitleKey[];

/**
 * reputation-titles.ts: discrete, scarce, contested titles (at most 5
 * characters can hold any one title at once) — a fully built leaderboard
 * system with zero UI. Copies GovernancePanel's tab pattern.
 */
export function TitlesPanel() {
  const [leaderboards, setLeaderboards] = useState<Record<
    ReputationTitleKey,
    CharacterTitle[]
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/universe/titles")
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setLeaderboards(body.leaderboards ?? {});
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load titles.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-text-tertiary py-8 text-center">{error}</p>;

  if (!leaderboards) {
    return (
      <div className="flex items-center justify-center py-16 text-text-secondary">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {TITLE_KEYS.map((key) => {
        const holders = leaderboards[key] ?? [];
        return (
          <Card key={key} className="p-4">
            <h3 className="text-sm font-semibold text-gold-400 mb-3">{TITLE_LABELS[key]}</h3>
            {holders.length === 0 ? (
              <p className="text-xs text-text-tertiary">No one holds this title yet.</p>
            ) : (
              <div className="space-y-2">
                {holders.map((holder, i) => (
                  <div key={holder.id} className="flex items-center gap-2.5">
                    <span className="text-xs text-text-tertiary w-4 shrink-0 tabular-nums">
                      {i === 0 ? <Medal className="h-3.5 w-3.5 text-gold-400" /> : i + 1}
                    </span>
                    <Image
                      src={resolveImageSrc(holder.character?.image_url)}
                      alt={holder.character?.name ?? "Character"}
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-full object-cover shrink-0"
                    />
                    <span className="text-sm text-text-primary truncate flex-1">
                      {holder.character?.name ?? "Unknown"}
                    </span>
                    <span className="text-xs text-text-tertiary tabular-nums shrink-0">
                      {Math.round(holder.score)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
