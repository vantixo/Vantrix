"use client";

import { useState } from "react";
import { Lock, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DATING_TIER_ORDER,
  DATING_TIER_LABELS,
  isGiftUnlocked,
  type DatingMatchTier,
} from "@/lib/dating/constants";
import { useSendGift } from "@/hooks/use-send-gift";
import type { GiftCatalogueItem } from "@/lib/frontend/dating";

export function GiftPicker({
  matchId,
  matchTier,
  catalogue,
  onSent,
}: {
  matchId: string;
  matchTier: string;
  catalogue: GiftCatalogueItem[];
  onSent?: (newBondScore: number) => void;
}) {
  const [selected, setSelected] = useState<GiftCatalogueItem | null>(null);
  const [message, setMessage] = useState("");
  const [sentGift, setSentGift] = useState<string | null>(null);
  const { sendGift, isSending, error, clearError } = useSendGift(matchId);

  async function handleSend() {
    if (!selected) return;
    const result = await sendGift(selected.type, message.trim() || undefined);
    if (result) {
      setSentGift(selected.name);
      setSelected(null);
      setMessage("");
      onSent?.(result.newBondScore);
      setTimeout(() => setSentGift(null), 2500);
    }
  }

  const byTier = DATING_TIER_ORDER.map((tier) => ({
    tier,
    gifts: catalogue.filter((g) => g.tier === tier),
  }));

  return (
    <div>
      {sentGift && (
        <p className="mb-3 flex items-center gap-2 rounded-sm border border-gold-500/30 bg-gold-500/5 px-3 py-2 text-sm text-gold-400">
          <Check className="h-4 w-4" /> Sent {sentGift}
        </p>
      )}

      {error && (
        <p className="mb-3 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error.code === "GIFT_LOCKED"
            ? `Reach ${DATING_TIER_LABELS[(error.requiredTier as DatingMatchTier) ?? "spark"]} tier to unlock this gift.`
            : error.error}
        </p>
      )}

      <div className="flex flex-col gap-5">
        {byTier.map(({ tier, gifts }) =>
          gifts.length === 0 ? null : (
            <div key={tier}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-secondary">
                {DATING_TIER_LABELS[tier]}
              </h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {gifts.map((gift) => {
                  const unlocked = isGiftUnlocked(gift.tier, matchTier);
                  const isSelected = selected?.type === gift.type;
                  return (
                    <button
                      key={gift.type}
                      disabled={!unlocked}
                      onClick={() => {
                        clearError();
                        setSelected(gift);
                      }}
                      className={cn(
                        "relative flex flex-col items-center gap-1 rounded-md border p-3 text-center transition-colors ease-premium",
                        unlocked
                          ? isSelected
                            ? "border-gold-500 bg-gold-500/10"
                            : "border-border-hairline hover:border-gold-500/40"
                          : "border-border-hairline opacity-40"
                      )}
                    >
                      {!unlocked && (
                        <Lock className="absolute right-2 top-2 h-3 w-3 text-text-tertiary" />
                      )}
                      <span className="text-2xl">{gift.emoji}</span>
                      <span className="line-clamp-1 text-xs text-text-primary">{gift.name}</span>
                      <span className="text-[11px] text-gold-400">{gift.tokens}c</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )
        )}
      </div>

      {selected && (
        <div className="mt-5 border-t border-border-hairline pt-4">
          <p className="mb-2 text-sm text-text-secondary">
            Sending <span className="text-text-primary">{selected.name}</span> for{" "}
            <span className="text-gold-400">{selected.tokens} coins</span>
          </p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            placeholder="Add a note (optional)"
            rows={2}
            className="w-full resize-none rounded-sm border border-interactive bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 focus:outline-none"
          />
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={handleSend} disabled={isSending}>
              {isSending && <Loader2 className="h-4 w-4 animate-spin" />}
              Send Gift
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
