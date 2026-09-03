"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * §11's Payments/Premium cluster has four separate checkout-initiation
 * routes (Stripe card, Paddle card/MoR, Paystack NGN, NOWPayments crypto)
 * — see each route's own file. One button component parameterized by
 * provider covers all four instead of forking the component four ways;
 * each POST returns `{ url }` (or `{ error, code }` on failure), so the
 * redirect logic is identical regardless of provider.
 *
 * PROVIDER GATE (2026-08-28): only "paystack" and "nowpayments" are
 * currently rendered anywhere in the app — Stripe and Paddle are switched
 * off account-wide (see lib/payments/provider-gate.ts's
 * DISABLED_PROVIDERS). This component still supports all four provider
 * values and the ENDPOINT map below is untouched, so re-enabling either
 * provider is a matter of removing it from DISABLED_PROVIDERS and adding
 * its CheckoutButton back into tier-card.tsx/billing-period-picker.tsx —
 * no changes needed here.
 */
type Provider = "stripe" | "paystack" | "nowpayments" | "paddle";

const ENDPOINT: Record<Provider, string> = {
  stripe: "/api/payments/stripe/checkout",
  paystack: "/api/payments/paystack/initialize",
  nowpayments: "/api/payments/nowpayments/create",
  paddle: "/api/payments/paddle/checkout",
};

export function CheckoutButton({
  tierId,
  provider,
  children,
  variant = "primary",
  size,
  className,
  // Analytics-only — where this button lives, forwarded to the checkout
  // route so `checkout_started` (see lib/analytics/events.ts) can be
  // segmented by entry surface. Defaults to the only surface that renders
  // this component today (see this file's own header comment).
  surface = "premium_page",
  // Defaults to matching the old implicit behavior (primary only) so every
  // existing call site is unaffected. Explicit override lets a
  // secondary-variant button still stack full-width under a primary one
  // (see TierCard's Stripe/Paddle pairing) without changing the default
  // for secondary/ghost usage elsewhere (e.g. the inline crypto/naira
  // links, which must stay content-width).
  fullWidth,
}: {
  tierId: string;
  provider: Provider;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
  surface?: string;
  fullWidth?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(ENDPOINT[provider], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierId, surface }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        // CARD_PAYMENT_NOT_ALLOWED (NSFW-enabled accounts, see
        // lib/payments/provider-gate.ts) is the one failure worth a
        // specific message — every other case falls back to a generic one.
        setError(
          body.code === "CARD_PAYMENT_NOT_ALLOWED"
            ? "Card payments aren't available on this account — try Crypto instead."
            : body.error ?? "Couldn't start checkout. Try again."
        );
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Couldn't start checkout. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={className}>
      <Button
        variant={variant}
        size={size ?? (variant === "primary" ? "lg" : "md")}
        onClick={start}
        disabled={loading}
        className={cn((fullWidth ?? variant === "primary") && "w-full")}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
      </Button>
      {error && <p className="text-xs text-danger mt-1.5">{error}</p>}
    </div>
  );
}
