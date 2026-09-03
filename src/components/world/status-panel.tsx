"use client";

import { useEffect, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Loader2, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { resolveImageSrc } from "@/lib/utils";
import { STATUS_TIER_LABELS } from "@/types/legacy-systems";
import type { SocialStatus } from "@/types/legacy-systems";

/**
 * GET /api/universe/status (no characterId — leaderboard mode) had a
 * complete backend (getStatusLeaderboard(), Redis-cached, top 20 by
 * status_score) and zero UI, same "backend shipped, no consumer"
 * pattern LegendsPanel/GovernancePanel already closed for their own
 * routes. This copies that same self-contained fetch-on-mount shape.
 *
 * The per-character variant (?characterId=...) is intentionally left
 * unwired here — it's meant to back a status badge on an individual
 * companion's own page/profile, not this world-level leaderboard tab.
 */
export function StatusPanel() {
  const [leaderboard, setLeaderboard] = useState<SocialStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/universe/status")
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setLeaderboard(body.leaderboard ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the status leaderboard.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-text-tertiary py-8 text-center">{error}</p>;

  if (!leaderboard) {
    return (
      <div className="flex items-center justify-center py-16 text-text-secondary">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (leaderboard.length === 0) {
    return <p className="text-sm text-text-tertiary">No status has been earned yet.</p>;
  }

  return (
    <Card className="divide-y divide-border-hairline">
      {leaderboard.map((entry, i) => (
        <div key={entry.id} className="flex items-center gap-3 p-3">
          <span className="w-6 text-center text-sm font-semibold text-text-tertiary shrink-0">
            {i + 1}
          </span>
          <Image
            src={resolveImageSrc(entry.character?.image_url)}
            alt={entry.character?.name ?? "Character"}
            width={40}
            height={40}
            className="h-10 w-10 rounded-full object-cover shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary truncate">
              {entry.character?.name ?? "Unknown"}
            </p>
            <p className="text-xs text-text-tertiary">
              {STATUS_TIER_LABELS[entry.status_tier]}
            </p>
          </div>
          <div className="flex items-center gap-1 text-gold-400 text-sm font-semibold shrink-0">
            <TrendingUp className="h-3.5 w-3.5" />
            {entry.status_score.toLocaleString()}
          </div>
          {i === 0 && <Badge className="shrink-0">#1</Badge>}
        </div>
      ))}
    </Card>
  );
}
