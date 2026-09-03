-- ─────────────────────────────────────────────────────────────────────────────
-- Pricing correction: quarterly discount 35% → 30%, annual discount 70% → 60%
--
-- SUPERSEDES the discount rates set by
-- 20260810_single_plan_three_billing_lengths.sql (35% quarterly / 70%
-- annual). Product decision: the single paid plan ('spark' slug, 'premium'
-- base_tier_slug — see that migration's own header for why the slug and the
-- feature-gating value differ) keeps its $9.99/mo monthly price unchanged,
-- but the two longer billing lengths now discount off that base price at:
--
--   1 month   — $9.99/mo   (no discount)              → $9.99  total
--   3 months  — $6.99/mo   (30% off)                   → $20.97 total
--   1 year    — $3.99/mo   (60% off)                   → $47.88 total
--
-- Per-month figures use the same Math.floor-to-cent convention as
-- lib/tiers/config.ts's annualMonthlyEquivalent()/getBillingPlans() — e.g.
-- 9.99 * 0.70 = 6.993 floors to 6.99, not rounds to 6.99 (round would only
-- coincidentally match here; 9.99 * 0.40 = 3.996 is the case where floor and
-- round actually diverge: floor -> 3.99, round -> 4.00). Total price for a
-- billing length is pricePerMonth * months, NOT (monthly * months) * (1 -
-- discount) — the two formulas can differ by a cent after flooring, and the
-- per-month figure (not the raw discount-off-total figure) is what's
-- authoritative, matching getBillingPlans() in application code.
--
-- price_usd for a monthly row is the per-month charge; for quarterly/annual
-- rows it is the FULL charge for that billing length (unchanged convention
-- from 20260810_single_plan_three_billing_lengths.sql). price_ngn = price_usd
-- * 1500 (see that migration and code-04-pricing-copy-matches-limits.test.ts,
-- which pins the monthly NGN figure to ₦14,985 — unaffected by this
-- migration since the monthly price itself doesn't change). price_crypto =
-- price_usd / 62500, rounded to 8 decimal places, same as that migration.
--
-- ⚠️  PAYSTACK MANUAL STEP: Paystack recurring (plan-based) subscriptions
-- bill whatever amount is configured on the Plan in the Paystack Dashboard —
-- passing `plan` in initializePaystackTransaction() makes Paystack IGNORE
-- the `amount` field entirely (see lib/payments/paystack.ts and
-- scripts/verify-paystack-pricing.ts, which exists specifically to catch
-- this class of drift). This migration updates ONLY the `tiers` table.
-- If PAYSTACK_PLAN_CODE_SPARK_QUARTERLY / PAYSTACK_PLAN_CODE_SPARK_ANNUAL
-- are configured in this environment, the corresponding Plans must also be
-- updated (or recreated — Paystack plans are immutable on amount in some
-- API versions, recreate if in doubt) to ₦31,455/quarter and ₦71,820/year
-- respectively, or Paystack subscribers will keep being charged the old
-- 35%/70%-discounted amounts despite this migration. Run
-- `npx tsx scripts/verify-paystack-pricing.ts` after updating the Dashboard
-- to confirm DB and Paystack agree. Stripe and NOWPayments both read
-- tiers.price_usd live at checkout time, so they need no manual step.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE tiers
SET price_usd    = 20.97,
    price_ngn    = ROUND(20.97 * 1500),
    price_crypto = ROUND((20.97 / 62500.0)::numeric, 8)
WHERE slug = 'spark_quarterly';

UPDATE tiers
SET price_usd    = 47.88,
    price_ngn    = ROUND(47.88 * 1500),
    price_crypto = ROUND((47.88 / 62500.0)::numeric, 8)
WHERE slug = 'spark_annual';

-- Monthly row is intentionally untouched — $9.99/mo is not discounted at
-- either the old (35%/70%) or new (30%/60%) rates, so its price_usd/
-- price_ngn/price_crypto already hold the correct values from
-- 20260810_single_plan_three_billing_lengths.sql.

-- Verify:
--   SELECT slug, billing_interval, price_usd, price_ngn, price_crypto
--   FROM tiers ORDER BY price_usd;
--   -- Expect: spark=9.99/14985/0.00015984,
--   --         spark_quarterly=20.97/31455/0.00033552,
--   --         spark_annual=47.88/71820/0.00076608
-- ─────────────────────────────────────────────────────────────────────────────
