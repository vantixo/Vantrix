"use client";

import { useEffect, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { Loader2, Gem } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn, resolveImageSrc } from "@/lib/utils";
import type { ScarceAsset, AssetRarity } from "@/types/legacy-systems";

// Gold-monochrome only (§1/§9.4: no mixed accent colors) — rarity is
// distinguished by intensity + weight, same resolution already applied
// to the Studio Market leaderboard's 6-way rarity distinction.
const RARITY_STYLES: Record<AssetRarity, string> = {
  rare: "text-gold-500/70 border-gold-500/30",
  epic: "text-gold-400 border-gold-500/50",
  legendary: "text-gold-300 border-gold-400/70 font-semibold",
  unique: "text-gold-200 border-gold-300 font-bold",
};

/**
 * scarcity.ts: finite world assets (artifacts, titles, offices, historic
 * properties, relics, council seats), each with at most one holder and a
 * permanent transfer history — fully built, zero UI. Copies GovernancePanel's
 * tab pattern.
 */
export function ArtifactsPanel() {
  const [assets, setAssets] = useState<ScarceAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/universe/artifacts")
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setAssets(body.assets ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load artifacts.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-text-tertiary py-8 text-center">{error}</p>;

  if (!assets) {
    return (
      <div className="flex items-center justify-center py-16 text-text-secondary">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (assets.length === 0) {
    return <p className="text-sm text-text-tertiary">No scarce assets exist yet.</p>;
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {assets.map((asset) => (
        <Card key={asset.id} className="p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Gem className="h-3.5 w-3.5 text-gold-500 shrink-0" />
              <span className="text-sm font-semibold text-text-primary truncate">
                {asset.name}
              </span>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-xs border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                RARITY_STYLES[asset.rarity]
              )}
            >
              {asset.rarity}
            </span>
          </div>

          <p className="text-xs text-text-tertiary capitalize mb-3">{asset.asset_type}</p>
          <p className="text-sm text-text-secondary line-clamp-2 mb-3">{asset.description}</p>

          {asset.holder ? (
            <Link
              href={`/characters/${asset.holder.id}`}
              className="flex items-center gap-2 text-xs text-text-secondary hover:text-gold-400 transition-colors ease-premium"
            >
              <Image
                src={resolveImageSrc(asset.holder.image_url)}
                alt={asset.holder.name}
                width={20}
                height={20}
                className="h-5 w-5 rounded-full object-cover"
              />
              Held by {asset.holder.name}
            </Link>
          ) : (
            <p className="text-xs text-gold-400">Unclaimed</p>
          )}

          {asset.location && (
            <p className="text-xs text-text-tertiary mt-1">{asset.location.name}</p>
          )}
        </Card>
      ))}
    </div>
  );
}
