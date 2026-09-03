"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Gift, Loader2, X } from "lucide-react";
import { GiftPicker } from "@/components/dating/gift-picker";
import type { GiftCatalogueItem } from "@/lib/frontend/dating";

interface ShopState {
  matchId: string;
  matchTier: string;
  catalogue: GiftCatalogueItem[];
}

/**
 * Chat-context entry point for gifting, per gift-access/route.ts's own doc
 * comment: "purely plumbing so the in-chat Gift button can open the Gift
 * Shop directly instead of redirecting into /dating." That button never
 * existed anywhere in the app — this is it.
 */
export function GiftDrawer({
  characterId,
  characterName,
}: {
  characterId: string;
  characterName: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [shop, setShop] = useState<ShopState | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    setOpen(true);
    if (shop) return;
    setLoading(true);
    setError(null);
    try {
      const accessRes = await fetch("/api/dating/gift-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      const access = await accessRes.json().catch(() => null);
      if (!accessRes.ok || !access) throw new Error(access?.error ?? "Could not open gift shop");

      const shopRes = await fetch(`/api/dating/gifts?matchId=${encodeURIComponent(access.matchId)}`);
      const shopBody = await shopRes.json().catch(() => null);
      if (!shopRes.ok || !shopBody) throw new Error("Could not load gift shop");

      setShop({
        matchId: access.matchId,
        matchTier: access.matchTier ?? "spark",
        catalogue: shopBody.catalogue ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open gift shop");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={handleOpen}
        aria-label={`Send ${characterName} a gift`}
        className="text-text-secondary transition-colors ease-premium hover:text-gold-400"
      >
        <Gift className="h-5 w-5" />
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
            onClick={() => setOpen(false)}
          >
          <div
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-lg border border-border-hairline bg-base p-4 sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-base text-text-primary">
                Gift for {characterName}
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-text-secondary hover:text-text-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {loading && (
              <p className="flex items-center gap-2 py-8 text-sm text-text-tertiary">
                <Loader2 className="h-4 w-4 animate-spin" /> Opening gift shop...
              </p>
            )}

            {error && !loading && (
              <p className="rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            {shop && !loading && (
              <GiftPicker
                matchId={shop.matchId}
                matchTier={shop.matchTier}
                catalogue={shop.catalogue}
                onSent={() => {
                  // GIFT-LIVE-FIX: tells any open ChatWindow for this
                  // character to poll for the gift line + her reaction
                  // that /api/dating/gifts just wrote server-side (fire-
                  // and-forget, so this response has already returned
                  // before that insert lands) — see chat-window.tsx's own
                  // GIFT-LIVE-FIX comment for the full story. A plain
                  // window event rather than prop-drilling because
                  // GiftDrawer (chat-header.tsx) and ChatWindow are
                  // siblings under the same server-rendered page with no
                  // shared client state to lift this into.
                  window.dispatchEvent(
                    new CustomEvent("vantrix:gift-sent", { detail: { characterId } })
                  );
                }}
              />
            )}
          </div>
          </div>,
          document.body,
        )}
    </>
  );
}
