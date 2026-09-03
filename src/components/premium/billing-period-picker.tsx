"use client";

import { useState } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { CheckoutButton } from "./checkout-button";
import { cn } from "@/lib/utils";
import { BASE_MONTHLY_PRICE } from "@/lib/tiers/config";
import type { PremiumBillingOption } from "@/lib/frontend/premium";

const PERIOD_NAME: Record<PremiumBillingOption["billingInterval"], string> = {
  annual: "Yearly",
  quarterly: "Quarterly",
  monthly: "Monthly",
};

// Exported so TierCard's headline caption can describe the SAME option
// this picker has selected, instead of a hardcoded "billed yearly" string
// that would go stale the moment someone picks Quarterly or Monthly.
export function billedCopy(opt: PremiumBillingOption): string {
  if (opt.billingInterval === "monthly") return "billed monthly";
  return `billed $${opt.totalPrice.toFixed(2)} every ${opt.months} months`;
}

// The pre-discount total for this billing length — what the same number of
// months would cost at the flat, undiscounted monthly rate. Derived from
// BASE_MONTHLY_PRICE (tiers/config.ts's single source of truth for the
// discount math) rather than back-computing from opt.totalPrice /
// (1 - opt.discountPct), since pricePerMonth is already floor-rounded to
// the .99 convention before totalPrice is derived from it — dividing back
// out would drift a few cents off the true anchor (e.g. $47.88 / 0.4 =
// $119.70, not the actual $119.88 undiscounted annual price).
function originalTotal(opt: PremiumBillingOption): number {
  return BASE_MONTHLY_PRICE * opt.months;
}

const SWIPE_THRESHOLD = 60;

/**
 * Billing-length picker for the single paid plan. `options` must already be
 * in display order (getPremiumBillingOptions() returns annual → quarterly →
 * monthly, i.e. Yearly first / Quarterly second / Monthly last) — this
 * component renders them as-is and never re-sorts.
 *
 * Controlled by the parent (TierCard) rather than owning its own
 * selection state: TierCard's headline price above this picker needs to
 * reflect whichever option is currently selected, so the selection has to
 * live one level up where both the headline and this picker can read it.
 *
 * Two ways to change the selection, both animated off the same
 * direction-aware slide: tapping a tab in the segmented control (with a
 * layout-animated gold pill sliding under the active tab), or swiping the
 * panel itself left/right — same gesture convention as the dating deck's
 * SwipeCard, just constrained to a horizontal carousel between 2-3 known
 * stops instead of a free drag-off-screen.
 */
export function BillingPeriodPicker({
  options,
  selectedTierId,
  onSelect,
  large,
}: {
  options: PremiumBillingOption[];
  selectedTierId: string;
  onSelect: (tierId: string) => void;
  large?: boolean;
}) {
  const [direction, setDirection] = useState(1);
  const selectedIndex = Math.max(0, options.findIndex(o => o.tierId === selectedTierId));
  const selected = options[selectedIndex] ?? options[0];

  if (!selected) return null;

  function goTo(nextIndex: number) {
    const clamped = Math.max(0, Math.min(options.length - 1, nextIndex));
    if (clamped === selectedIndex) return;
    setDirection(clamped > selectedIndex ? 1 : -1);
    onSelect(options[clamped].tierId);
  }

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x <= -SWIPE_THRESHOLD) goTo(selectedIndex + 1);
    else if (info.offset.x >= SWIPE_THRESHOLD) goTo(selectedIndex - 1);
  }

  return (
    <div>
      {/* Segmented control — sliding gold pill tracks the active tab via
          framer-motion's shared layoutId, so tapping between periods
          animates the same way swiping does. */}
      <div
        role="radiogroup"
        aria-label="Billing length"
        onKeyDown={(e) => {
          // WAI-ARIA radiogroup pattern: Left/Up moves to the previous
          // option, Right/Down to the next, Home/End jump to the ends.
          // The click handlers below already call goTo() — this just
          // wires the same function to the keyboard, since role="radio"
          // implies this interaction and nothing was handling it.
          if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            goTo(selectedIndex - 1);
          } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            goTo(selectedIndex + 1);
          } else if (e.key === "Home") {
            e.preventDefault();
            goTo(0);
          } else if (e.key === "End") {
            e.preventDefault();
            goTo(options.length - 1);
          }
        }}
        className="relative flex rounded-sm border border-border-hairline p-1 gap-1"
      >
        {options.map((opt, i) => {
          const isSelected = opt.tierId === selected.tierId;
          return (
            <button
              key={opt.tierId}
              type="button"
              role="radio"
              aria-checked={isSelected}
              // Roving tabindex: only the checked option is in the Tab
              // order (standard radiogroup behavior) — the others are
              // reached via arrow keys, not repeated Tabs.
              tabIndex={isSelected ? 0 : -1}
              onClick={() => {
                setDirection(i > selectedIndex ? 1 : -1);
                onSelect(opt.tierId);
              }}
              className={cn(
                "relative flex-1 rounded-xs py-2 text-center transition-colors duration-150 ease-premium",
                large ? "text-xs sm:text-sm" : "text-xs"
              )}
            >
              {isSelected && (
                <motion.span
                  layoutId="billing-period-pill"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  className="absolute inset-0 rounded-xs bg-gold-500/[0.12] border border-gold-500/70"
                />
              )}
              <span
                className={cn(
                  "relative z-10 font-semibold",
                  isSelected ? "text-gold-500" : "text-text-secondary"
                )}
              >
                {PERIOD_NAME[opt.billingInterval]}
              </span>
              {opt.discountPct > 0 && (
                <span className="relative z-10 ml-1.5">
                  <Badge variant="solid">-{Math.round(opt.discountPct * 100)}%</Badge>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Swipeable price panel — drag left/right to step between billing
          lengths; snaps back if the swipe doesn't clear SWIPE_THRESHOLD. */}
      <div className={cn("relative overflow-hidden", large ? "mt-3 sm:mt-4" : "mt-3")}>
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={selected.tierId}
            custom={direction}
            initial={{ x: direction * 48, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction * -48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.6}
            onDragEnd={handleDragEnd}
            className="flex items-center justify-between gap-3 rounded-sm border border-border-hairline px-3.5 py-3 cursor-grab active:cursor-grabbing"
          >
            <div>
              <div className={cn("font-display text-text-primary", large ? "text-sm sm:text-lg" : "text-sm")}>
                ${selected.pricePerMonth.toFixed(2)}
                <span className="text-text-tertiary font-sans font-normal">/mo</span>
              </div>

              {/* Anchor pricing: struck-through undiscounted total next to
                  the real discounted total, so the "-X%" claim above has
                  something concrete to be a percentage OF. Monthly has no
                  discount, so it skips this row and falls straight to the
                  billing-cadence caption below. */}
              {selected.discountPct > 0 && (
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-text-tertiary line-through text-[11px]">
                    ${originalTotal(selected).toFixed(2)}
                  </span>
                  <span className="text-gold-400 font-semibold text-[11px]">
                    ${selected.totalPrice.toFixed(2)}
                  </span>
                </div>
              )}

              {/* Exact renewal price + cadence, spelled out in full every
                  time — never just the discount badge on its own. */}
              <div className="text-[11px] text-text-tertiary mt-0.5">{billedCopy(selected)}</div>
            </div>

            {/* Circular discount seal — the "-X%" claim needs an anchor
                price to be meaningful (see the struck-through total to the
                left), so this is decoration on top of that context, not a
                substitute for it. Hidden on Monthly, which has nothing to
                discount off of. */}
            {selected.discountPct > 0 && (
              <div
                className="relative h-12 w-12 shrink-0 rounded-full bg-gold-500 text-[#160F02] flex flex-col items-center justify-center text-center leading-none ring-1 ring-gold-300/60 shadow-gold-glow -rotate-6"
                aria-hidden="true"
              >
                <span className="text-[13px] font-extrabold">{Math.round(selected.discountPct * 100)}%</span>
                <span className="text-[6.5px] font-bold uppercase tracking-wide mt-0.5">off</span>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {options.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-2">
            {options.map((opt, i) => (
              <button
                key={opt.tierId}
                type="button"
                aria-label={`Show ${PERIOD_NAME[opt.billingInterval]} pricing`}
                onClick={() => goTo(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-200 ease-premium",
                  i === selectedIndex ? "w-4 bg-gold-500" : "w-1.5 bg-border-hairline"
                )}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        {/* PROVIDER GATE (2026-08-28): only Paystack and NOWPayments are
            live checkout rails right now — Stripe and Paddle are switched
            off account-wide (see lib/payments/provider-gate.ts's
            DISABLED_PROVIDERS; their routes 503 if hit directly). Paystack
            leads as primary since it's the card/bank rail; NOWPayments
            (crypto) is the secondary option, available to everyone
            regardless of NSFW status. */}
        <CheckoutButton tierId={selected.tierId} provider="paystack" variant="primary">
          Subscribe with Paystack
        </CheckoutButton>
        <CheckoutButton tierId={selected.tierId} provider="nowpayments" variant="secondary" fullWidth className="mt-2">
          Pay with Crypto
        </CheckoutButton>
      </div>
    </div>
  );
}
