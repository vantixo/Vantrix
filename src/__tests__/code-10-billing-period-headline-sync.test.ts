/**
 * CODE-10 — Billing-period picker headline stays in sync with selection
 *
 * Regression test for a bug introduced while wiring the Yearly/Quarterly/
 * Monthly picker into TierCard: the big headline price (and its "billed
 * ..." caption) at the top of the card was computed once from
 * billingOptions[0] (Yearly) and never updated again, while
 * BillingPeriodPicker managed its OWN separate selection state below it.
 * Clicking "Monthly" in the picker changed which tier the checkout
 * buttons targeted, but the headline above kept showing the yearly
 * discounted price — a real product bug (subscribers would see one price
 * and pay another) had it not been caught before this session used it.
 *
 * Fix: selection state moved up into TierCard (the single source of
 * truth for "what's currently selected" on the card), and
 * BillingPeriodPicker became a controlled component driven by that state
 * instead of owning its own. These tests pin that shape structurally so
 * the bug can't silently come back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('CODE-10 — TierCard owns billing-period selection, not BillingPeriodPicker', () => {
  const tierCard = src('components', 'premium', 'tier-card.tsx');
  const picker = src('components', 'premium', 'billing-period-picker.tsx');

  it('TierCard is a client component holding the selected billing option in state', () => {
    expect(tierCard).toMatch(/^"use client";/);
    expect(tierCard).toMatch(/useState\(billingOptions\?\.\[0\]\?\.tierId\)/);
  });

  it('TierCard\'s headline price reads from the selected option, not a hardcoded billingOptions[0]', () => {
    // The bug: `${(hasBillingChoice ? billingOptions![0].pricePerMonth : ...`
    // Guards against that literal pattern reappearing.
    expect(tierCard).not.toMatch(/billingOptions!\[0\]\.pricePerMonth/);
    expect(tierCard).toMatch(/\(selected \? selected\.pricePerMonth : tier\.price_usd\)/);
  });

  it('TierCard\'s caption is never the hardcoded "billed yearly" string', () => {
    // That copy was only ever true when Yearly happened to be selected;
    // it must describe whichever option is actually selected.
    expect(tierCard).not.toMatch(/billed yearly — or pick a shorter length below/);
  });

  it('BillingPeriodPicker still doesn\'t own its OWN idea of which tier is selected — selectedIndex is derived from the selectedTierId prop every render, not stored in its own state', () => {
    // UPDATED (sidebar-upgrade-final, swipe-gesture refactor): the picker
    // now holds trivial local `useState` for the swipe-transition direction
    // (purely cosmetic — which way to animate — not "which tier is
    // selected"), so a blanket `not.toMatch(/useState/)` is no longer the
    // right guard. The actual bug this test protects against was the
    // picker maintaining an INDEPENDENT selected-tier id instead of
    // reading the parent's; that guarantee is checked directly below.
    expect(picker).toMatch(/selectedTierId:\s*string/);
    expect(picker).toMatch(/onSelect:\s*\(tierId:\s*string\)\s*=>\s*void/);
    expect(picker).toMatch(/options\.findIndex\(o\s*=>\s*o\.tierId\s*===\s*selectedTierId\)/);
    // Guards against the picker going back to owning its own selection —
    // e.g. `useState(selectedTierId)` or `useState<string>` — as opposed
    // to the derived-every-render pattern asserted above.
    expect(picker).not.toMatch(/useState\(selectedTierId\)/);
    expect(picker).not.toMatch(/useState<string>/);
  });

  it('TierCard passes its own selection state into BillingPeriodPicker as controlled props', () => {
    expect(tierCard).toMatch(/<BillingPeriodPicker[\s\S]*?selectedTierId=\{selected!\.tierId\}[\s\S]*?onSelect=\{setSelectedTierId\}/);
  });

  it('billedCopy is a single shared implementation, imported by TierCard rather than duplicated', () => {
    expect(picker).toMatch(/export function billedCopy/);
    expect(tierCard).toMatch(/import\s*\{\s*BillingPeriodPicker,\s*billedCopy\s*\}\s*from\s*"\.\/billing-period-picker"/);
    // Only one function body should exist for it across both files.
    const bodies = [tierCard, picker].join('\n').match(/function billedCopy/g) ?? [];
    expect(bodies.length).toBe(1);
  });
});

describe('CODE-10 — display order is Yearly first, Quarterly second, Monthly last', () => {
  it('getBillingPlans() (tiers/config.ts) — the single source of truth for the order — is annual, quarterly, monthly', () => {
    const config = src('lib', 'tiers', 'config.ts');
    expect(config).toMatch(/\(\['annual', 'quarterly', 'monthly'\] as const\)\.map/);
  });

  it('getPremiumBillingOptions() renders getBillingPlans() as-is, with no re-sort', () => {
    const premium = src('lib', 'frontend', 'premium.ts');
    // Should filter/map getBillingPlans() output directly, never call
    // .sort()/.reverse() on it or otherwise reorder before returning.
    expect(premium).toMatch(/getBillingPlans\(\)\s*\n?\s*\.filter/);
    expect(premium).not.toMatch(/getPremiumBillingOptions[\s\S]*?\.sort\(/);
  });

  it('BillingPeriodPicker renders options in the order it receives them, never re-sorting', () => {
    const picker = src('components', 'premium', 'billing-period-picker.tsx');
    // UPDATED (swipe-gesture refactor): the map callback now also takes an
    // index (for the pill/dot navigation), so `opt =>` alone is too
    // literal — the guarantee this pins is "no re-sort", checked below.
    expect(picker).toMatch(/options\.map\(\(?opt\b/);
    expect(picker).not.toMatch(/options\s*\.slice\(\)\s*\.sort/);
    expect(picker).not.toMatch(/\[\.\.\.options\]\.sort/);
  });
});

describe('CODE-10 — Yearly leads with the discounted monthly-equivalent price', () => {
  it('getBillingPlans() computes pricePerMonth for annual at the 60%-off rate, not the full yearly total', () => {
    const config = src('lib', 'tiers', 'config.ts');
    expect(config).toMatch(/annual:\s*0\.60/);
    expect(config).toMatch(/pricePerMonth\s*=\s*Math\.floor\(BASE_MONTHLY_PRICE \* \(1 - discountPct\) \* 100\) \/ 100/);
  });

  it('BillingPeriodPicker displays pricePerMonth (not totalPrice) as the large "/mo" figure for every option', () => {
    const picker = src('components', 'premium', 'billing-period-picker.tsx');
    // UPDATED (swipe-gesture refactor): the picker now shows one option at
    // a time (`selected`, driven by the swipe/pill controls) instead of
    // mapping the price line over every `opt` — the guarantee is which
    // *field* backs the figure (pricePerMonth, never totalPrice), not the
    // loop variable's name.
    expect(picker).toMatch(/\$\{(?:opt|selected)\.pricePerMonth\.toFixed\(2\)\}/);
    expect(picker).not.toMatch(/\$\{(?:opt|selected)\.totalPrice\.toFixed\(2\)\}.*\/mo/);
    expect(picker).toMatch(/\/mo</);
  });

  it('TierCard defaults the selected option to billingOptions[0] (Yearly), so first paint shows the discounted price', () => {
    const tierCard = src('components', 'premium', 'tier-card.tsx');
    expect(tierCard).toMatch(/useState\(billingOptions\?\.\[0\]\?\.tierId\)/);
  });
});
