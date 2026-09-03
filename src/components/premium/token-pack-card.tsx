"use client";

import { useState } from "react";
import { Loader2, Coins } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TokenPack } from "@/lib/frontend/premium";

/**
 * PROVIDER GATE (2026-08-28): only Paystack and NOWPayments are live
 * checkout rails right now — Stripe and Paddle are switched off
 * account-wide (see lib/payments/provider-gate.ts's DISABLED_PROVIDERS;
 * their routes 503 if hit directly). Mirrors tier-card.tsx's identical
 * gating for subscriptions.
 *
 * TOKEN-PACK FIX: this card used to call the Stripe/Paddle checkout-tokens
 * routes directly, with no gate check at all — since both providers are
 * disabled, every purchase attempt hit a live-but-non-functional API call
 * and surfaced only as a generic "An unexpected error occurred" (see
 * lib/errors.ts's toErrorBody() — it sanitizes any non-AppError down to
 * that message). Token packs had no working checkout at all as a result.
 * Repointed at the new paystack/checkout-tokens and nowpayments/create-tokens
 * routes instead, which credit tokens the same way stripe/webhook's
 * (now-dead) token_pack branch used to.
 */
type Provider = "paystack" | "nowpayments";

const ENDPOINT: Record<Provider, string> = {
  paystack: "/api/payments/paystack/checkout-tokens",
  nowpayments: "/api/payments/nowpayments/create-tokens",
};

export function TokenPackCard({ pack }: { pack: TokenPack }) {
  const [loading, setLoading] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(provider: Provider) {
    setLoading(provider);
    setError(null);
    try {
      const res = await fetch(ENDPOINT[provider], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: pack.id }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setError(
          body.code === "CARD_PAYMENT_NOT_ALLOWED"
            ? "Card payments aren't available on this account — try Crypto instead."
            : body.code === "EMAIL_REQUIRED"
            ? "Add an email to your account to pay by card."
            : body.error ?? "Couldn't start checkout."
        );
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Couldn't start checkout. Try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card interactive={false} className="p-5 flex flex-col items-center text-center relative">
      {pack.badge && (
        <div className="absolute -top-2.5">
          <Badge>{pack.badge}</Badge>
        </div>
      )}
      <Coins className="h-6 w-6 text-gold-500 mt-2" strokeWidth={1.75} />
      <div className="font-display text-2xl text-text-primary mt-2 tabular-nums">
        {pack.tokens.toLocaleString()}
      </div>
      <div className="text-[11px] text-text-tertiary -mt-0.5">Vantrix Coin</div>
      {pack.bonusTokens > 0 && (
        <div className="text-xs text-gold-400 font-semibold">
          +{pack.bonusTokens.toLocaleString()} bonus
        </div>
      )}
      <div className="text-sm text-text-secondary mt-1">{pack.label}</div>

      <Button
        variant="secondary"
        size="sm"
        onClick={() => buy("paystack")}
        disabled={loading !== null}
        className="mt-4 w-full"
      >
        {loading === "paystack" ? <Loader2 className="h-4 w-4 animate-spin" /> : `$${pack.priceUsd.toFixed(2)}`}
      </Button>
      <button
        onClick={() => buy("nowpayments")}
        disabled={loading !== null}
        className="mt-1.5 text-[11px] text-text-tertiary hover:text-gold-400 transition-colors ease-premium disabled:opacity-40"
      >
        {loading === "nowpayments" ? (
          <Loader2 className="h-3 w-3 animate-spin inline" />
        ) : (
          "or pay with Crypto"
        )}
      </button>
      {error && <p className="text-xs text-danger mt-1.5">{error}</p>}
    </Card>
  );
}
