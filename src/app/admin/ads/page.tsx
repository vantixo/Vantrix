"use client";

import { useState, useEffect } from "react";
import { RevealGroup } from "@/components/admin/motion/reveal";
import { AdForm } from "@/components/admin/ads/ad-form";
import { AdRowCard } from "@/components/admin/ads/ad-row-card";
import { fetchAds, type AdRow } from "@/lib/frontend/admin-ads";

export default function AdminAdsPage() {
  const [ads, setAds] = useState<AdRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchAds()
      .then(setAds)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl mb-1">Ads</h2>
          <p className="text-text-secondary text-sm">
            {ads.length} placement{ads.length === 1 ? "" : "s"}
          </p>
        </div>
        <AdForm onCreated={(ad) => setAds((prev) => [ad, ...prev])} />
      </div>

      {isLoading ? (
        <p className="text-text-secondary text-sm">Loading…</p>
      ) : ads.length === 0 ? (
        <p className="text-text-tertiary text-sm py-12 text-center border border-border-hairline rounded-md">
          No ads yet.
        </p>
      ) : (
        <RevealGroup className="space-y-2.5">
          {ads.map((ad) => (
            <AdRowCard
              key={ad.id}
              ad={ad}
              onDeleted={(id) => setAds((prev) => prev.filter((a) => a.id !== id))}
            />
          ))}
        </RevealGroup>
      )}
    </div>
  );
}
