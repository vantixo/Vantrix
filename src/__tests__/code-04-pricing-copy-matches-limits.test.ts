/**
 * CODE-04 — Pricing Copy Matches Enforced Limits
 *
 * Regression test for a real bug class this codebase has hit before (see the
 * H-02 comment in lib/tiers/limits.ts): marketing copy and the actual
 * Redis-enforced daily cap drifting apart.
 *
 * REWRITTEN for the single-plan pivot (see limits.ts PREMIUM_TIER comment
 * and config.ts's "PRODUCT DECISION" comment): spark/basic/premium/elite/
 * enterprise all resolve to the same ungated PREMIUM_TIER limits now, so
 * per-tier numeric message-count copy ("150 messages a day" for Spark, "300"
 * for Premium) no longer describes anything real — those exact assertions
 * were dropped. The two things that ARE still real commitments, and still
 * drift-prone, are: (1) the free tier's numeric cap, and (2) paid-tier copy
 * not silently reintroducing a fake numeric ceiling. The original bug
 * (free tier promising 75/day while enforcement capped at 20) is still
 * covered by the free-tier assertions below.
 *
 * The previous version of this test also referenced
 * components/premium/free-trial-modal.tsx, which doesn't exist in this
 * codebase — dropped along with the stale assertions it supported.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TIER_LIMITS } from '../lib/tiers/limits';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('CODE-04 — pricing copy matches enforced limits', () => {
  it('free tier is 5/day total, capped at 5/day per individual character', () => {
    // PRODUCT DECISION (latest revision): free tier is 5/day total with a
    // 5-per-character sub-cap (the sub-cap no longer binds first at this
    // size, but stays in place so a future increase to dailyMessages can't
    // let one character silently absorb the whole allowance). Guests
    // (unauthenticated) get 0 everywhere — see GUEST_MESSAGE_LIMIT default
    // in env.ts.
    //
    // This is the enforced Redis-gate value (FREE_TIER in limits.ts) and
    // must equal 5, matching the marketing copy exactly — a prior bug here
    // had these drift apart.
    expect(TIER_LIMITS.free.dailyMessages).toBe(5);
    expect(TIER_LIMITS.free.perCharacterMessages).toBe(5);
  });

  it('free tier feature copy (tiers/config.ts) says 5, matching the enforced cap', () => {
    const config = src('lib', 'tiers', 'config.ts');
    expect(config).toMatch(/5 messages per day/);
  });

  it('paid-tier copy (tiers/config.ts) advertises unlimited/ungated access, matching PREMIUM_TIER', () => {
    // limits.ts's PREMIUM_TIER (2000/day, 60/min burst) is deliberately high
    // enough that no legitimate user ever hits it — the product commitment
    // is "unlimited, rate-limited for abuse only, never feature-gated."
    // config.ts's feature copy for every paid tier must say exactly that,
    // not a specific daily number that would re-create the H-02 bug class.
    // The free tier's own "5 messages per day" line (asserted above) is the
    // one legitimate numeric match in this file — anything else matching
    // the pattern would mean a paid tier re-introduced a fake ceiling.
    const config = src('lib', 'tiers', 'config.ts');
    expect(config).toMatch(/Unlimited messages/);
    const matches = config.match(/\d+ messages (a|per) day/g) ?? [];
    for (const m of matches) {
      expect(m).toBe('5 messages per day');
    }
  });

  it('SEO landing pages (lib/seo/landing-pages.ts) say 5 messages per day for free, not a stale number', () => {
    // Same false-advertising exposure the H-02 fix was meant to close —
    // every FAQ answer across indexed public landing pages (/ai-girlfriend,
    // /ai-boyfriend, etc) must quote the current enforced free-tier number.
    const landingPages = src('lib', 'seo', 'landing-pages.ts');
    expect(landingPages).not.toMatch(/50 messages per day/);
    const matches = landingPages.match(/\d+ messages per day/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m).toBe('5 messages per day');
    }
  });

  it('SEO landing pages do not promise per-tier companion counts that no longer exist', () => {
    // Every tier (including free) unlocks every character now —
    // characterSlots is 99999 across the board in tiers/config.ts. Landing
    // pages previously claimed "one companion" on free / "3 companions" on
    // Premium / "20+" on Elite, which is no longer true for any of them.
    const landingPages = src('lib', 'seo', 'landing-pages.ts');
    expect(landingPages).not.toMatch(/one (AI )?companion\b/i);
    expect(landingPages).not.toMatch(/\d+\+? companions/i);
  });

  it('SEO landing pages quote a single, consistent Naira price for the paid plan', () => {
    // Only one paid plan exists (spark, repurposed as the $9.99/mo base
    // plan — see config.ts BASE_MONTHLY_PRICE). price_ngn = price_usd*1500
    // (see the 20261010 migration), so every ₦ mention across landing pages
    // must agree — a page quoting a different Elite/Premium price than
    // another page quotes for the same plan is exactly the drift this test
    // class exists to catch.
    const landingPages = src('lib', 'seo', 'landing-pages.ts');
    const matches = landingPages.match(/₦[\d,]+\/month/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m).toBe('₦14,985/month');
    }
  });
});
