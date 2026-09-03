import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getBillingPlans, type BillingPeriod } from "@/lib/tiers/config";

/**
 * §11: Payments/Premium routes are all POST (checkout/portal/cancel) —
 * there's no GET route that lists tiers, because nothing before this
 * page needed one. `tiers_read` is an open `USING (TRUE)` RLS policy
 * (see 20240101_production.sql), so this is a plain anon-scoped read,
 * same pattern as lib/frontend/characters.ts's direct query rather than
 * a route hop for a thin, unauthenticated SELECT.
 */
export interface PremiumTier {
  id: string;
  name: string;
  slug: string;
  // BUGFIX (see getPremiumBillingOptions call site in premium/page.tsx):
  // 20260937_backfill_legacy_tier_slugs.sql renamed every paid row's
  // base_tier_slug from 'spark' to 'premium' (the stable feature-gating
  // value written to profiles.tier), but this interface never surfaced
  // the column, so callers had no way to pass anything but the
  // ever-changing checkout `slug` ('spark') into getPremiumBillingOptions()
  // — which now matches zero rows post-migration. Selecting it here (and
  // below) closes that gap.
  base_tier_slug: string | null;
  price_usd: number;
  price_ngn: number;
  price_crypto: number;
  features: string[];
  daily_message_limit: number;
  can_create_characters: boolean;
  tokens_per_month: number;
}

const TIER_SELECT =
  "id,name,slug,base_tier_slug,price_usd,price_ngn,price_crypto,features,daily_message_limit,can_create_characters,tokens_per_month";

export async function getPremiumTiers(): Promise<PremiumTier[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tiers")
    // Annual/quarterly variants of a plan share a base_tier_slug (see
    // stripe/checkout's comment on that column) — filtering to slugs
    // without an "_annual"/"_quarterly" suffix keeps the pricing grid to
    // one card per plan family; interval choice happens at checkout time
    // instead of the grid, matching how paystack/initialize already
    // treats billingInterval as a separate parameter rather than a
    // separate tier.
    .select(TIER_SELECT)
    .not("slug", "like", "%_annual")
    .not("slug", "like", "%_quarterly")
    .order("price_usd", { ascending: true });

  return (data as PremiumTier[] | null) ?? [];
}

/**
 * Whether the current user can still start the PREMIUM_TRIAL_DAYS-day Stripe free trial
 * (see /api/payments/stripe/trial). Used by the premium page to show or
 * hide the trial CTA — the route itself is the actual enforcement point
 * (this is a display-only convenience, not a security boundary; the route
 * re-checks trial_used server-side regardless of what this returns).
 */
export async function getTrialEligibility(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("trial_used")
    .eq("id", userId)
    .maybeSingle();
  // Fail closed on the display layer too — if we can't tell, don't offer
  // a CTA that the route would just reject anyway.
  if (error || !data) return false;
  return data.trial_used !== true;
}

/**
 * One selectable billing length for the paid plan, ready for the pricing
 * grid: the checkout-able `tiers.id` (spark / spark_quarterly / spark_annual
 * — see 20260810_single_plan_three_billing_lengths.sql) merged with the
 * discounted per-month figures from getBillingPlans() (tiers/config.ts),
 * which stays the single source of truth for the *displayed* prices so
 * this file never recomputes a discount by hand. Ordered annual → quarterly
 * → monthly (Yearly first, Quarterly second, Monthly last), matching
 * getBillingPlans()'s own order — the pricing grid renders these as-is,
 * no re-sorting needed.
 */
export interface PremiumBillingOption {
  tierId: string; // pass this as CheckoutButton's tierId, not the base plan's id
  billingInterval: BillingPeriod;
  label: string; // "1 Year" / "3 Months" / "1 Month"
  months: number;
  discountPct: number; // 0.6 for annual, 0.3 for quarterly, 0 for monthly
  pricePerMonth: number; // the discounted, monthly-equivalent price to lead with
  totalPrice: number; // full amount actually billed per cycle
}

/**
 * Every billing-length row that shares `baseTierSlug` (its base_tier_slug —
 * for the monthly row this equals its own slug, see that migration's
 * INSERT). Pass the paid tier's own `slug` from getPremiumTiers() here.
 * Returns [] if this environment's `tiers` table only has the monthly row
 * seeded (billing-length picker degrades to a single option in that case —
 * see TierCard's fallback).
 */
export async function getPremiumBillingOptions(baseTierSlug: string): Promise<PremiumBillingOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tiers")
    .select("id,billing_interval")
    .eq("base_tier_slug", baseTierSlug);

  const rows = (data as { id: string; billing_interval: string }[] | null) ?? [];
  const idByInterval = new Map(rows.map(r => [r.billing_interval as BillingPeriod, r.id]));

  return getBillingPlans()
    .filter(plan => idByInterval.has(plan.id))
    .map(plan => ({
      tierId: idByInterval.get(plan.id)!,
      billingInterval: plan.id,
      label: plan.label,
      months: plan.months,
      discountPct: plan.discountPct,
      pricePerMonth: plan.pricePerMonth,
      totalPrice: plan.totalPrice,
    }));
}

export { TOKEN_PACKS, getTokenPack, type TokenPack } from "@/lib/economy/token-packs";
