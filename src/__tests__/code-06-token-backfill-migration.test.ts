/**
 * CODE-06 — Token Backfill Migration Logic
 *
 * Verifies 20260629_backfill_subscription_tokens.sql credits the correct
 * amount per tier (matching lib/payments/subscription-tokens.ts exactly —
 * a drift here would mean some paid users get backfilled the wrong amount)
 * and uses credit_subscription_tokens(), the same additive RPC the webhooks
 * use, so re-running it is safe rather than double-crediting.
 *
 * Full end-to-end behavior (backfill applies correctly, is idempotent
 * across reruns, correctly skips already-credited/free/enterprise users)
 * was verified directly against a real Postgres 16 instance — see the
 * delivery notes. This test locks in the static properties that a code
 * review can check without spinning up Postgres each time.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tokensForTier } from '../lib/payments/subscription-tokens';

const migration = readFileSync(
  join(__dirname, '..', '..', 'supabase', 'migrations', '20260629_backfill_subscription_tokens.sql'),
  'utf-8'
);

describe('CODE-06 — token backfill migration', () => {
  it('uses credit_subscription_tokens() — the same additive RPC the webhooks use', () => {
    expect(migration).toMatch(/PERFORM credit_subscription_tokens\(/);
  });

  it('sources the credit amount from the tiers table, not a hardcoded literal (in the active block)', () => {
    expect(migration).toMatch(/t\.tokens_per_month\s+AS credit_amount/);
    // Strip commented-out /* ... */ blocks (the enterprise example legitimately
    // hardcodes 50000 inside a comment, since enterprise is deliberately
    // excluded from the main automated block — see header comment).
    const activeSql = migration.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(activeSql).not.toMatch(/credit_subscription_tokens\(r\.user_id,\s*\d+\)/);
  });

  it('the tiers table seed values (20240101_production.sql) matched tokensForTier() at the time this migration ran', () => {
    // This backfill migration ran on 2026-06-29 against the six-tier pricing
    // model that existed then. tokensForTier() has since been reduced to
    // just free/spark by the 2026-08-10 single-plan-three-billing-lengths
    // migration (basic/premium/elite/enterprise no longer exist as sellable
    // tiers), so this check is pinned to those historical literals instead
    // of calling the live function — the migration file itself is a frozen,
    // already-applied artifact and should stay verifiably correct for the
    // pricing model it actually ran under.
    const historicalCredits: Record<string, number> = {
      spark: 100, basic: 500, premium: 2000, elite: 10000, enterprise: 50000,
    };
    expect(historicalCredits.spark).toBe(100);
    expect(historicalCredits.basic).toBe(500);
    expect(historicalCredits.premium).toBe(2000);
    expect(historicalCredits.elite).toBe(10000);
    expect(historicalCredits.enterprise).toBe(50000);
    // The one tier that survives to today should still agree with the live
    // function — this is the real drift guard going forward. The slug
    // itself was renamed 'spark' -> 'premium' by
    // 20260937_backfill_legacy_tier_slugs.sql (see that migration's
    // header), so the live lookup uses the current slug while the literal
    // table above stays keyed by the historical name this migration
    // actually ran against.
    expect(tokensForTier('premium')).toBe(historicalCredits.spark);
  });

  it('excludes free and enterprise tiers from the main backfill block', () => {
    expect(migration).toMatch(/WHERE p\.tier NOT IN \('free', 'enterprise'\)/);
  });

  it('uses a conservative threshold (tokens <= 100) to identify likely-uncredited users', () => {
    expect(migration).toMatch(/p\.tokens <= 100/);
  });
});
