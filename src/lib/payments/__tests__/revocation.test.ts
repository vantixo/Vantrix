import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/notifications/emit', () => ({
  emitNotification: vi.fn().mockResolvedValue('mock-notification-id'),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  bg: (label: string) => (_err: unknown) => {},
}));

import {
  flagForRevocation,
  clearRevocationFlag,
  sweepExpiredFlags,
  REVOCATION_GRACE_PERIOD_DAYS,
} from '../revocation';
import { emitNotification } from '@/lib/notifications/emit';

interface FlagRow {
  id: string;
  user_id: string;
  provider: string;
  source_payment_id: string;
  event_type: string;
  reason: string;
  status: 'pending' | 'cleared' | 'executed';
  grace_period_ends_at: string;
  created_at: string;
  cleared_at?: string | null;
  cleared_by?: string | null;
  clear_reason?: string | null;
  executed_at?: string | null;
  previous_tier?: string | null;
}

/**
 * Minimal purpose-built Supabase mock covering exactly the query shapes
 * revocation.ts issues: insert-with-unique-conflict on
 * subscription_revocation_flags, select/eq/lte sweeps, update+select+
 * maybeSingle for clearing, and the profiles/subscriptions reads/writes
 * executeRevocation() performs.
 */
function makeSupabaseMock(seed: {
  flags?: FlagRow[];
  profiles?: { id: string; tier: string }[];
  subscriptions?: { id: string; user_id: string; provider: string; status: string; expires_at: string }[];
} = {}) {
  const state = {
    subscription_revocation_flags: seed.flags ?? [],
    profiles: seed.profiles ?? [],
    subscriptions: seed.subscriptions ?? [],
  };
  let idCounter = 0;

  const client: any = {
    from(table: keyof typeof state) {
      return {
        insert: (row: any) => {
          if (table === 'subscription_revocation_flags') {
            const dup = state.subscription_revocation_flags.find(
              (f) => f.provider === row.provider && f.source_payment_id === row.source_payment_id
            );
            if (dup) {
              const err = { code: '23505', message: 'duplicate key value violates unique constraint' };
              return {
                select: () => ({ maybeSingle: async () => ({ data: null, error: err }) }),
              };
            }
            const withDefaults: FlagRow = {
              id: `flag-${++idCounter}`,
              created_at: new Date().toISOString(),
              status: 'pending',
              ...row,
            };
            state.subscription_revocation_flags.push(withDefaults);
            return {
              select: () => ({ maybeSingle: async () => ({ data: { id: withDefaults.id }, error: null }) }),
            };
          }
          throw new Error(`unexpected insert on ${String(table)}`);
        },
        select: (_cols?: string) => {
          const filters: [string, any][] = [];
          const chain: any = {
            eq: (col: string, val: any) => { filters.push([col, val]); return chain; },
            lte: (col: string, val: any) => { filters.push(['__lte__' + col, val]); return chain; },
            gt: (col: string, val: any) => { filters.push(['__gt__' + col, val]); return chain; },
            limit: () => chain,
            order: () => chain,
            maybeSingle: async () => {
              const rows = (state[table] as any[]).filter((r) => matches(r, filters));
              return { data: rows[0] ?? null, error: null };
            },
            then: (resolve: any) => {
              const rows = (state[table] as any[]).filter((r) => matches(r, filters));
              return resolve({ data: rows, error: null });
            },
          };
          return chain;
        },
        update: (patch: any) => {
          const filters: [string, any][] = [];
          const chain: any = {
            eq: (col: string, val: any) => { filters.push([col, val]); return chain; },
            select: (_cols?: string) => ({
              maybeSingle: async () => {
                const row = (state[table] as any[]).find((r) => matches(r, filters));
                if (!row) return { data: null, error: null };
                Object.assign(row, patch);
                return { data: row, error: null };
              },
            }),
            then: (resolve: any) => {
              const rows = (state[table] as any[]).filter((r) => matches(r, filters));
              rows.forEach((r) => Object.assign(r, patch));
              return resolve({ data: rows, error: null });
            },
          };
          return chain;
        },
      };
    },
    // Mirrors execute_subscription_revocation() (see
    // supabase/migrations/20261217_atomic_subscription_revocation.sql) —
    // executeRevocation() calls this RPC instead of issuing separate
    // writes (that's the whole point of the atomicity fix), so the mock
    // has to actually perform the same cancel/downgrade-if-no-other-
    // active/mark-executed sequence the real Postgres function does,
    // against this same in-memory `state`, rather than leaving `.rpc()`
    // undefined and letting the call throw.
    rpc: (fnName: string, params: { p_flag_id: string }) => {
      if (fnName !== 'execute_subscription_revocation') {
        throw new Error(`unexpected rpc call: ${fnName}`);
      }
      return {
        single: async () => {
          const flag = state.subscription_revocation_flags.find((f) => f.id === params.p_flag_id);
          if (!flag) {
            return { data: null, error: { message: `revocation flag ${params.p_flag_id} not found` } };
          }

          if (flag.status === 'executed') {
            return {
              data: {
                outcome: 'already_executed',
                out_user_id: flag.user_id,
                out_provider: flag.provider,
                out_reason: flag.reason,
                previous_tier: flag.previous_tier ?? null,
              },
              error: null,
            };
          }

          if (flag.status !== 'pending') {
            return {
              data: {
                outcome: 'not_pending',
                out_user_id: flag.user_id,
                out_provider: flag.provider,
                out_reason: flag.reason,
                previous_tier: null,
              },
              error: null,
            };
          }

          const profile = state.profiles.find((p) => p.id === flag.user_id);
          const previousTier = profile?.tier ?? null;

          state.subscriptions
            .filter((s) => s.user_id === flag.user_id && s.provider === flag.provider)
            .forEach((s) => { s.status = 'cancelled'; });

          const now = Date.now();
          const otherActive = state.subscriptions.find(
            (s) => s.user_id === flag.user_id && s.status === 'active' && new Date(s.expires_at).getTime() > now
          );

          const outcome: 'downgraded' | 'retained' = otherActive ? 'retained' : 'downgraded';
          if (!otherActive && profile) profile.tier = 'free';

          flag.status = 'executed';
          flag.executed_at = new Date().toISOString();
          flag.previous_tier = previousTier;

          return {
            data: {
              outcome,
              out_user_id: flag.user_id,
              out_provider: flag.provider,
              out_reason: flag.reason,
              previous_tier: previousTier,
            },
            error: null,
          };
        },
      };
    },
    _state: state,
  };

  function matches(row: any, filters: [string, any][]): boolean {
    return filters.every(([col, val]) => {
      if (col.startsWith('__lte__')) return row[col.slice(7)] <= val;
      if (col.startsWith('__gt__')) return row[col.slice(6)] > val;
      return row[col] === val;
    });
  }

  return client;
}

describe('flagForRevocation', () => {
  it('creates a pending flag with a grace period N days out', async () => {
    const supabase = makeSupabaseMock();
    const before = Date.now();
    const result = await flagForRevocation(supabase, {
      userId: 'user-1', provider: 'stripe', sourcePaymentId: 'pi_123',
      eventType: 'charge.refunded', reason: 'refund',
    });
    expect(result.flagged).toBe(true);
    expect(result.alreadyFlagged).toBe(false);
    expect(supabase._state.subscription_revocation_flags).toHaveLength(1);
    const flag = supabase._state.subscription_revocation_flags[0];
    expect(flag.status).toBe('pending');
    const graceMs = new Date(flag.grace_period_ends_at).getTime() - before;
    expect(graceMs).toBeGreaterThan((REVOCATION_GRACE_PERIOD_DAYS - 0.01) * 24 * 60 * 60 * 1000);
    expect(graceMs).toBeLessThan((REVOCATION_GRACE_PERIOD_DAYS + 0.01) * 24 * 60 * 60 * 1000);
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', urgency: 'high' }));
  });

  it('is idempotent per (provider, source_payment_id) — a webhook retry does not reset the clock', async () => {
    const supabase = makeSupabaseMock();
    await flagForRevocation(supabase, {
      userId: 'user-1', provider: 'stripe', sourcePaymentId: 'pi_123',
      eventType: 'charge.refunded', reason: 'refund',
    });
    const second = await flagForRevocation(supabase, {
      userId: 'user-1', provider: 'stripe', sourcePaymentId: 'pi_123',
      eventType: 'charge.refunded', reason: 'refund',
    });
    expect(second.alreadyFlagged).toBe(true);
    expect(second.flagged).toBe(false);
    expect(supabase._state.subscription_revocation_flags).toHaveLength(1);
  });
});

describe('clearRevocationFlag', () => {
  it('clears a pending flag and records who cleared it', async () => {
    const supabase = makeSupabaseMock({
      flags: [{
        id: 'flag-1', user_id: 'user-1', provider: 'stripe', source_payment_id: 'pi_123',
        event_type: 'charge.refunded', reason: 'refund', status: 'pending',
        grace_period_ends_at: new Date(Date.now() + 100000).toISOString(),
        created_at: new Date().toISOString(),
      }],
    });
    const result = await clearRevocationFlag(supabase, { flagId: 'flag-1', adminId: 'admin-1', reason: 'dup charge' });
    expect(result.cleared).toBe(true);
    expect(supabase._state.subscription_revocation_flags[0].status).toBe('cleared');
    expect(supabase._state.subscription_revocation_flags[0].cleared_by).toBe('admin-1');
  });

  it('no-ops on a flag that already executed', async () => {
    const supabase = makeSupabaseMock({
      flags: [{
        id: 'flag-1', user_id: 'user-1', provider: 'stripe', source_payment_id: 'pi_123',
        event_type: 'charge.refunded', reason: 'refund', status: 'executed',
        grace_period_ends_at: new Date(Date.now() - 100000).toISOString(),
        created_at: new Date().toISOString(),
      }],
    });
    const result = await clearRevocationFlag(supabase, { flagId: 'flag-1', adminId: 'admin-1' });
    expect(result.cleared).toBe(false);
  });
});

describe('sweepExpiredFlags', () => {
  it('downgrades a user with no other active subscription once grace period lapses', async () => {
    const supabase = makeSupabaseMock({
      flags: [{
        id: 'flag-1', user_id: 'user-1', provider: 'stripe', source_payment_id: 'pi_123',
        event_type: 'charge.refunded', reason: 'refund', status: 'pending',
        grace_period_ends_at: new Date(Date.now() - 1000).toISOString(), // already lapsed
        created_at: new Date().toISOString(),
      }],
      profiles: [{ id: 'user-1', tier: 'premium' }],
      subscriptions: [{ id: 'sub-1', user_id: 'user-1', provider: 'stripe', status: 'active', expires_at: new Date(Date.now() + 100000).toISOString() }],
    });
    const result = await sweepExpiredFlags(supabase);
    expect(result.processed).toBe(1);
    expect(result.downgraded).toBe(1);
    expect(result.retained).toBe(0);
    expect(supabase._state.profiles[0].tier).toBe('free');
    expect(supabase._state.subscription_revocation_flags[0].status).toBe('executed');
  });

  it('ignores flags whose grace period has not lapsed yet', async () => {
    const supabase = makeSupabaseMock({
      flags: [{
        id: 'flag-1', user_id: 'user-1', provider: 'stripe', source_payment_id: 'pi_123',
        event_type: 'charge.refunded', reason: 'refund', status: 'pending',
        grace_period_ends_at: new Date(Date.now() + 100000).toISOString(), // still in the future
        created_at: new Date().toISOString(),
      }],
      profiles: [{ id: 'user-1', tier: 'premium' }],
    });
    const result = await sweepExpiredFlags(supabase);
    expect(result.processed).toBe(0);
    expect(supabase._state.profiles[0].tier).toBe('premium');
  });

  it('never downgrades a cleared flag', async () => {
    const supabase = makeSupabaseMock({
      flags: [{
        id: 'flag-1', user_id: 'user-1', provider: 'stripe', source_payment_id: 'pi_123',
        event_type: 'charge.refunded', reason: 'refund', status: 'cleared',
        grace_period_ends_at: new Date(Date.now() - 1000).toISOString(),
        created_at: new Date().toISOString(),
        cleared_at: new Date().toISOString(), cleared_by: 'admin-1',
      }],
      profiles: [{ id: 'user-1', tier: 'premium' }],
    });
    const result = await sweepExpiredFlags(supabase);
    expect(result.processed).toBe(0);
    expect(supabase._state.profiles[0].tier).toBe('premium');
  });
});
