import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression coverage for the daily-reset cron's subscription-expiry step.
 *
 * Context: the route used to hand-roll pagination + direct table updates,
 * which downgraded a user's tier on ANY expired subscription without
 * checking whether they had another active one. That's fixed by routing
 * through the canonical `expire_subscriptions()` DB RPC (see
 * supabase/migrations/20240101_production.sql +
 * 20260902_expire_subscriptions_return_counts.sql).
 *
 * These tests exercise the ROUTE's contract with that RPC — that it calls
 * expire_subscriptions exactly once (no pagination loop), reports the
 * counts the RPC returns, and surfaces RPC failures as a non-fatal,
 * logged error rather than crashing the whole cron. The RPC's own SQL
 * logic (the "does the user have another active subscription" check) is
 * plpgsql and isn't exercised by vitest — it should additionally be
 * covered by a pgTAP/staging-migration test against a real Postgres
 * instance if one exists in this repo; that's out of scope here.
 */

vi.mock('@/lib/security', () => ({
  requireCronAuth: vi.fn(() => true),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/env', () => ({
  env: { CRON_SECRET: 'test-secret-at-least-32-characters-long' },
}));

vi.mock('@/lib/cron/heartbeat', () => ({
  heartbeatStart: vi.fn(),
  heartbeatSuccess: vi.fn(),
  heartbeatFail: vi.fn(),
}));

// Every other cron step in the route (message reset, trial expiry,
// initiative purge, webhook purge, session prune, message archive) is
// stubbed to a no-op success so this suite isolates step 2 only.
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import { GET } from '@/app/api/cron/daily-reset/route';

function makeRequest() {
  return new Request('https://example.com/api/cron/daily-reset', {
    headers: { Authorization: 'Bearer test-secret-at-least-32-characters-long' },
  }) as unknown as Parameters<typeof GET>[0];
}

/** Default no-op behavior for every RPC/table this route touches besides expire_subscriptions. */
function stubOtherSteps() {
  fromMock.mockImplementation((table: string) => {
    const chain: any = {
      delete: () => chain,
      eq: () => chain,
      lt: () => chain,
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      in: () => chain,
      upsert: async () => ({ error: null }),
    };
    // delete()/select() chains resolve when awaited directly too
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], count: 0, error: null });
    return chain;
  });
}

describe('daily-reset subscription expiry', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    stubOtherSteps();
  });

  it('case 1: expired subscription, no other active sub → RPC reports the downgrade, route calls it exactly once', async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'expire_subscriptions') {
        return { data: { expired: 1, downgraded: 1 }, error: null };
      }
      return { data: null, error: null };
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    const expireCalls = rpcMock.mock.calls.filter(([fn]) => fn === 'expire_subscriptions');
    expect(expireCalls).toHaveLength(1);
    expect(body.subscriptionExpiry).toEqual({ expired: 1, downgraded: 1 });
  });

  it('case 2: expired sub but another active sub on a different provider → RPC reports zero downgrades', async () => {
    // The RPC itself decides this (no active-elsewhere → skip downgrade);
    // the route just needs to faithfully report whatever it returns.
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'expire_subscriptions') {
        return { data: { expired: 1, downgraded: 0 }, error: null };
      }
      return { data: null, error: null };
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.subscriptionExpiry).toEqual({ expired: 1, downgraded: 0 });
    expect(body.ok).toBe(true);
  });

  it('case 3: expired sub but a newer active sub from the same provider → RPC reports zero downgrades', async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'expire_subscriptions') {
        return { data: { expired: 1, downgraded: 0 }, error: null };
      }
      return { data: null, error: null };
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.subscriptionExpiry).toEqual({ expired: 1, downgraded: 0 });
  });

  it('case 4: 1001 expired subscriptions → all processed in a single RPC call (no pagination loop)', async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'expire_subscriptions') {
        return { data: { expired: 1001, downgraded: 1001 }, error: null };
      }
      return { data: null, error: null };
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    const expireCalls = rpcMock.mock.calls.filter(([fn]) => fn === 'expire_subscriptions');
    // Regression guard: this must stay 1. If someone reintroduces
    // pagination, this call count will climb with batch size.
    expect(expireCalls).toHaveLength(1);
    expect(body.subscriptionExpiry).toEqual({ expired: 1001, downgraded: 1001 });
  });

  it('RPC failure is reported as a non-fatal, logged error (207) rather than throwing', async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'expire_subscriptions') {
        return { data: null, error: { message: 'connection reset' } };
      }
      return { data: null, error: null };
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(207);
    expect(body.ok).toBe(false);
    expect(typeof body.subscriptionExpiry).toBe('string');
    expect(body.subscriptionExpiry).toMatch(/error/i);
  });
});
