import { Crown } from "lucide-react";
import { getPremiumTiers, getTrialEligibility, getPremiumBillingOptions } from "@/lib/frontend/premium";
import { getShellSession } from "@/lib/frontend/session";
import { TierCard } from "@/components/premium/tier-card";
import { TrialButton } from "@/components/premium/trial-button";
import { PaywallViewed } from "@/components/premium/paywall-viewed";
import { isProviderEnabled } from "@/lib/payments/provider-gate";

export const dynamic = "force-dynamic";

/**
 * §12 Phase 7 — "checkout flow off the upsell banner." Home's
 * PremiumBanner already links `/premium` (see its own comment: "billing/
 * payments routes aren't wired yet — that's the next phase this banner
 * sets up"); this is that phase.
 */
export default async function PremiumPage() {
  const session = await getShellSession();
  const currentTier = session?.profile.tier;

  // Drives the "Go Premium" upsell copy below — someone already on a paid
  // tier has nothing to upgrade into, so that pitch is free/signed-out-only.
  // (app) layout's own auth guard means a signed-out visitor never reaches
  // this page, but `currentTier` still comes back undefined for them here,
  // so this treats "no tier on record" the same as "free" rather than
  // accidentally hiding the pitch from someone the session just hasn't
  // resolved for.
  const isFreeUser = !currentTier || currentTier === "free";

  const [tiers, trialEligible] = await Promise.all([
    getPremiumTiers(),
    // Only worth checking for free-tier users on a signed-in session —
    // paid users have nothing to trial into, and signed-out users hit the
    // (app) layout's auth guard before this page ever renders.
    //
    // PROVIDER GATE (2026-08-28): this trial is a Stripe Checkout session
    // under the hood (see api/payments/stripe/trial) with no Paystack/
    // NOWPayments equivalent, and Stripe is currently switched off
    // account-wide — see lib/payments/provider-gate.ts's
    // DISABLED_PROVIDERS. Short-circuits to false while that's the case so
    // the button/copy below never renders pointing at a route that would
    // just 503, without needing a DB round-trip to find that out.
    session && currentTier === "free" && isProviderEnabled("stripe")
      ? getTrialEligibility(session.profile.id)
      : Promise.resolve(false),
  ]);

  // This page is a single-plan upsell now — the free row is what everyone
  // lands on already, so surfacing it again here just competes for
  // attention with the one thing this page exists to sell. Paid-only list;
  // the "Plans unavailable" empty state below now keys off this instead of
  // the raw `tiers` fetch so an all-free catalog still reports correctly.
  const paidTiers = tiers.filter(t => t.price_usd > 0);

  // Yearly/Quarterly/Monthly variants of the (single) paid plan — fetched
  // once tiers are known since it needs the paid tier's own slug as
  // base_tier_slug. Keyed by tier id so TierCard only wires the picker onto
  // the card it belongs to.
  const paidTier = paidTiers[0];
  // BUGFIX: getPremiumBillingOptions() filters tiers by base_tier_slug, not
  // by a row's own checkout `slug`. Post-20260937 migration, base_tier_slug
  // is 'premium' for every paid row while `slug` stays 'spark' — passing
  // `slug` here matched zero rows and silently collapsed the pricing card
  // to a flat monthly-only price with no quarterly/annual choice. Falls
  // back to `slug` only for pre-migration/local envs that never got that
  // backfill.
  const billingOptions = paidTier
    ? await getPremiumBillingOptions(paidTier.base_tier_slug ?? paidTier.slug)
    : [];

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-8 py-10">
      <PaywallViewed surface="premium_page" currentTier={currentTier ?? "free"} />
      {isFreeUser && (
        <div className="text-center max-w-lg mx-auto">
          <div className="h-14 w-14 mx-auto rounded-full border border-gold-500/50 flex items-center justify-center">
            <Crown className="h-6 w-6 text-gold-500" strokeWidth={1.75} />
          </div>
          <h1 className="font-display text-3xl text-text-primary mt-4">
            Go Premium
          </h1>
          <p className="text-text-secondary mt-2">
            Unlock unlimited conversations, exclusive companions, and the full
            depth of Vantrix&rsquo;s living world.
          </p>

          {trialEligible && (
            <div className="mt-6 max-w-xs mx-auto">
              <TrialButton />
              <p className="text-text-tertiary text-xs mt-2">
                Card required, cancel anytime before day 7 to avoid the
                $9.99/mo charge.
              </p>
            </div>
          )}
        </div>
      )}

      {paidTiers.length === 0 ? (
        <p className="text-center text-text-tertiary mt-10">
          Plans are unavailable right now — check back shortly.
        </p>
      ) : (
        // Solo, enlarged card — no free-tier column to share the row with
        // anymore, so this is a single centered plan rather than a grid.
        <div className="max-w-xl mx-auto mt-10">
          {paidTiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              highlighted
              large
              currentTier={currentTier}
              billingOptions={tier.id === paidTier?.id ? billingOptions : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
