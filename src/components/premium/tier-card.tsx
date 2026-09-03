"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CheckoutButton } from "./checkout-button";
import { BillingPeriodPicker, billedCopy } from "./billing-period-picker";
import type { PremiumTier, PremiumBillingOption } from "@/lib/frontend/premium";
import { BASE_MONTHLY_PRICE } from "@/lib/tiers/config";

export function TierCard({
  tier,
  highlighted,
  large,
  currentTier,
  billingOptions,
}: {
  tier: PremiumTier;
  highlighted?: boolean;
  // Solo-card sizing for the single-plan /premium page (no free column
  // beside it anymore to keep this compact for) — bumps padding/type scale
  // up a step. Grid contexts with multiple cards should leave this unset.
  large?: boolean;
  currentTier?: string;
  // Yearly/Quarterly/Monthly variants of this tier, already in display
  // order (see getPremiumBillingOptions()) — undefined/empty for tiers with
  // no paid billing lengths (free) or in an environment where only the
  // monthly row is seeded, in which case this card falls back to the flat
  // single-price layout below.
  billingOptions?: PremiumBillingOption[];
}) {
  const isCurrent = currentTier === tier.slug;
  const hasBillingChoice = (billingOptions?.length ?? 0) > 1;

  // Selection lives here, not inside BillingPeriodPicker, because the
  // headline price/caption just above the picker also needs to reflect
  // whichever length is currently selected — defaults to billingOptions[0]
  // (Yearly, per getPremiumBillingOptions()'s display order), so a new
  // visitor's first-paint price is the discounted annual figure.
  const [selectedTierId, setSelectedTierId] = useState(billingOptions?.[0]?.tierId);
  const selected = hasBillingChoice
    ? billingOptions!.find(o => o.tierId === selectedTierId) ?? billingOptions![0]
    : undefined;

  return (
    <Card
      interactive={false}
      className={`flex flex-col ${large ? "p-6 sm:p-10" : "p-6"} ${highlighted ? "border-gold-500/50 shadow-gold-glow" : ""}`}
    >
      <h3 className={`font-display text-text-primary ${large ? "text-lg sm:text-2xl" : "text-lg"}`}>{tier.name}</h3>
      <div className={`flex items-baseline gap-1.5 ${large ? "mt-2 sm:mt-3" : "mt-2"}`}>
        <span className={`font-display text-text-primary ${large ? "text-3xl sm:text-5xl" : "text-3xl"}`}>
          ${(selected ? selected.pricePerMonth : tier.price_usd).toFixed(2)}
        </span>
        <span className={`text-text-secondary ${large ? "text-sm sm:text-base" : "text-sm"}`}>/mo</span>
        {/* Real (pre-discount) price, struck through, so the offer reads as
            "was $9.99, now $3.99" rather than just stating a number.
            Computed off BASE_MONTHLY_PRICE directly (same convention as
            billing-period-picker.tsx's originalTotal()) rather than a
            shared-interface field, so this doesn't touch PremiumBillingOption. */}
        {selected && selected.discountPct > 0 && (
          <span className={`text-text-tertiary line-through ${large ? "text-base sm:text-xl" : "text-base"}`}>
            ${BASE_MONTHLY_PRICE.toFixed(2)}
          </span>
        )}
      </div>
      {selected && (
        <p className={`text-text-tertiary mt-0.5 flex flex-wrap items-center gap-x-1.5 ${large ? "text-xs sm:text-sm" : "text-xs"}`}>
          <span>{billedCopy(selected)}</span>
          {selected.discountPct > 0 && (
            <span className="font-semibold text-gold-400">
              Save {Math.round(selected.discountPct * 100)}% (${(BASE_MONTHLY_PRICE * selected.months - selected.totalPrice).toFixed(2)})
            </span>
          )}
        </p>
      )}

      <ul className={`flex-1 space-y-2.5 ${large ? "mt-5 sm:mt-7" : "mt-5"}`}>
        {tier.features.map((f) => (
          <li key={f} className={`flex items-start gap-2 text-text-secondary ${large ? "text-sm sm:text-base" : "text-sm"}`}>
            <Check className={`text-gold-500 shrink-0 mt-0.5 ${large ? "h-4 w-4 sm:h-5 sm:w-5" : "h-4 w-4"}`} />
            {f}
          </li>
        ))}
        {tier.tokens_per_month > 0 && (
          <li className={`flex items-start gap-2 text-text-secondary ${large ? "text-sm sm:text-base" : "text-sm"}`}>
            <Check className={`text-gold-500 shrink-0 mt-0.5 ${large ? "h-4 w-4 sm:h-5 sm:w-5" : "h-4 w-4"}`} />
            {tier.tokens_per_month.toLocaleString()} Vantrix Coin / month
          </li>
        )}
      </ul>

      <div className={large ? "mt-6 sm:mt-8" : "mt-6"}>
        {isCurrent ? (
          <div className="h-11 flex items-center justify-center rounded-sm border border-border-hairline text-text-secondary text-sm font-semibold">
            Current plan
          </div>
        ) : hasBillingChoice ? (
          // Yearly/Quarterly/Monthly picker, controlled by the state above
          // so the headline price stays in sync with whatever's selected.
          // Owns its own checkout rail (Stripe/Paddle/Crypto/Naira) scoped
          // to whichever length is selected.
          <BillingPeriodPicker
            options={billingOptions!}
            selectedTierId={selected!.tierId}
            onSelect={setSelectedTierId}
            large={large}
          />
        ) : (
          // PROVIDER GATE (2026-08-28): only Paystack and NOWPayments are
          // live checkout rails right now — Stripe and Paddle are switched
          // off account-wide (see lib/payments/provider-gate.ts's
          // DISABLED_PROVIDERS; their routes 503 if hit directly).
          <>
            <CheckoutButton tierId={tier.id} provider="paystack" variant="primary">
              Subscribe with Paystack
            </CheckoutButton>
            <CheckoutButton tierId={tier.id} provider="nowpayments" variant="secondary" fullWidth className="mt-2">
              Pay with Crypto
            </CheckoutButton>
          </>
        )}
      </div>
    </Card>
  );
}
