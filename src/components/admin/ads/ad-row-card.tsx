"use client";

import { useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Trash2, Loader2, MousePointerClick, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { RevealItem } from "@/components/admin/motion/reveal";
import { toggleAd, deleteAd, type AdRow } from "@/lib/frontend/admin-ads";
import { cn } from "@/lib/utils";
import { PromoHeroArt, isPromoHeroCode, promoHeroSlugFrom } from "@/components/home/promo-hero-art";

export function AdRowCard({
  ad,
  onDeleted,
}: {
  ad: AdRow;
  onDeleted: (id: string) => void;
}) {
  const [active, setActive] = useState(ad.active);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function toggle() {
    setBusy(true);
    const next = !active;
    setActive(next);
    try {
      await toggleAd(ad.id, next);
    } catch {
      setActive(!next);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await deleteAd(ad.id);
      onDeleted(ad.id);
    } catch {
      setDeleting(false);
    }
  }

  const ctr = ad.impressions > 0 ? ((ad.clicks / ad.impressions) * 100).toFixed(1) : "0.0";

  return (
    <RevealItem>
      <Card interactive={false} className="p-3.5 flex items-center gap-3.5">
        <div className="relative h-12 w-20 rounded-xs overflow-hidden shrink-0 border border-border-hairline bg-white/5">
          {isPromoHeroCode(ad.image_url) ? (
            <PromoHeroArt slug={promoHeroSlugFrom(ad.image_url)} />
          ) : (
            <Image src={ad.image_url} alt="" fill sizes="80px" className="object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-primary truncate">{ad.title}</p>
          <p className="text-xs text-text-tertiary capitalize">
            {ad.position} · {ad.audience}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-4 text-xs text-text-secondary shrink-0">
          <span className="flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" /> {ad.impressions.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <MousePointerClick className="h-3.5 w-3.5" /> {ad.clicks.toLocaleString()} ({ctr}%)
          </span>
        </div>
        <button
          onClick={toggle}
          disabled={busy}
          className={cn(
            "h-5 w-9 rounded-full relative transition-colors ease-premium shrink-0",
            active ? "bg-gold-500" : "bg-white/10"
          )}
          aria-label={active ? "Deactivate ad" : "Activate ad"}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-base transition-transform ease-premium",
              active ? "translate-x-4" : "translate-x-0.5"
            )}
          />
        </button>
        <button
          onClick={remove}
          disabled={deleting}
          aria-label="Delete ad"
          className="h-7 w-7 flex items-center justify-center rounded-xs text-text-tertiary hover:text-danger hover:bg-danger/10 shrink-0"
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </Card>
    </RevealItem>
  );
}
