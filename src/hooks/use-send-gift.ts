"use client";

import { useCallback, useState } from "react";
import type { GiftCatalogueItem } from "@/lib/frontend/dating";

/**
 * Mirrors POST /api/dating/gifts's documented response/error shapes:
 *   200 { success, gift, newBondScore, tokensSpent, milestones }
 *   402 { error, required }              — insufficient Vantrix Coin
 *   403 { error, code: 'GIFT_LOCKED', requiredTier }
 *   404 { error }                        — match not found
 *   429 { error, code: 'RATE_LIMIT_EXCEEDED' }
 */
export interface SendGiftResult {
  success: true;
  gift: GiftCatalogueItem & { message?: string };
  newBondScore: number;
  tokensSpent: number;
  milestones: string[];
}

export interface SendGiftError {
  error: string;
  code?: "GIFT_LOCKED" | "RATE_LIMIT_EXCEEDED";
  requiredTier?: string;
  required?: number;
}

export function useSendGift(matchId: string) {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<SendGiftError | null>(null);

  const sendGift = useCallback(
    async (giftType: string, message?: string): Promise<SendGiftResult | null> => {
      setIsSending(true);
      setError(null);
      try {
        const res = await fetch("/api/dating/gifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, giftType, message }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) {
          setError(
            (body as SendGiftError | null) ?? { error: `Gift failed (${res.status})` }
          );
          return null;
        }
        return body as SendGiftResult;
      } catch (err) {
        setError({ error: err instanceof Error ? err.message : "Gift failed" });
        return null;
      } finally {
        setIsSending(false);
      }
    },
    [matchId]
  );

  return { sendGift, isSending, error, clearError: () => setError(null) };
}
