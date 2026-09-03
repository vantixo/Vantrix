import { describe, it, expect} from 'vitest';
import { getCommissionPct, COMMISSION_WINDOW_MONTHS } from '../referral-config';
import { recordCommissionForPayment, attributeConversion, clawBackCommission } from '../referral-engine';

// ── Pure commission math ─────────────────────────────────────────────────

describe('getCommissionPct — decay table', () => {
  it('user class never earns cash commission', () => {
    expect(getCommissionPct('user', 1)).toBe(0);
    expect(getCommissionPct('user', 2)).toBe(0);
  });

  it('dev class decays across 3 months then stops', () => {
    expect(getCommissionPct('dev', 1)).toBeCloseTo(0.12);
    expect(getCommissionPct('dev', 2)).toBeCloseTo(0.06);
    expect(getCommissionPct('dev', 3)).toBeCloseTo(0.03);
    expect(getCommissionPct('dev', 4)).toBe(0); // window closed — house keeps 100%
  });

  it('influencer class is front-loaded, decays faster than dev by month 2', () => {
    expect(getCommissionPct('influencer', 1)).toBeGreaterThan(getCommissionPct('dev', 1));
    expect(getCommissionPct('influencer', 3)).toBeLessThan(getCommissionPct('influencer', 1));
    expect(getCommissionPct('influencer', 4)).toBe(0);
  });

  it('never pays commission beyond the documented window', () => {
    expect(getCommissionPct('dev', COMMISSION_WINDOW_MONTHS + 1)).toBe(0);
    expect(getCommissionPct('influencer', COMMISSION_WINDOW_MONTHS + 1)).toBe(0);
  });

  it('rejects month 0 or negative months', () => {
    expect(getCommissionPct('dev', 0)).toBe(0);
    expect(getCommissionPct('dev', -1)).toBe(0);
  });
});

// ── Engine behavior with a mocked Supabase client ────────────────────────

function makeSupabaseMock(overrides: Record<string, any> = {}) {
  // Real table names used by referral-engine.ts — the mock keys its state
  // by these directly so `state[table]` in `_chain` resolves correctly.
  const state: Record<string, any[]> = {
    referral_conversions: overrides.conversions ?? [],
    referral_partners: overrides.partners ?? [],
    referral_commissions: overrides.commissions ?? [],
    referral_token_rewards: overrides.tokenRewards ?? [],
    referral_clicks: overrides.clicks ?? [],
  };

  const client: any = {
    from(table: string) {
      return {
        select: () => client._chain(table, 'select'),
        insert: (row: any) => client._insert(table, row),
        update: (row: any) => client._chain(table, 'update', row),
      };
    },
    _chain(table: string, _op: string, _updateRow?: any) {
      const chain: any = {
        eq: (col: string, val: any) => { chain._filters.push([col, val]); return chain; },
        in: () => chain,
        gte: () => chain,
        lt: () => chain,
        order: () => chain,
        _filters: [],
        maybeSingle: async () => {
          const row = (state[table as keyof typeof state] as any[]).find((r: any) =>
            chain._filters.every(([c, v]: [string, any]) => r[c] === v)
          );
          return { data: row ?? null, error: null };
        },
        single: async () => {
          const row = (state[table as keyof typeof state] as any[]).find((r: any) =>
            chain._filters.every(([c, v]: [string, any]) => r[c] === v)
          );
          return { data: row ?? null, error: row ? null : { message: 'not found' } };
        },
        select: async () => {
          const rows = (state[table as keyof typeof state] as any[]).filter((r: any) =>
            chain._filters.every(([c, v]: [string, any]) => r[c] === v)
          );
          return { data: rows, error: null };
        },
      };
      return chain;
    },
    _insert(table: string, row: any) {
      const withId = { id: `mock-${Math.random().toString(36).slice(2)}`, ...row };
      (state[table as keyof typeof state] as any[]).push(withId);
      return {
        select: () => ({ single: async () => ({ data: withId, error: null }) }),
      };
    },
    rpc: async () => ({ data: null, error: null }),
    _state: state,
  };
  // Friendly aliases so existing assertions (supabase._state.commissions etc)
  // keep working without every test needing to know real table names.
  Object.defineProperties(client._state, {
    conversions:  { get: () => state.referral_conversions },
    partners:     { get: () => state.referral_partners },
    commissions:  { get: () => state.referral_commissions },
    tokenRewards: { get: () => state.referral_token_rewards },
    clicks:       { get: () => state.referral_clicks, set: (v) => { state.referral_clicks = v; } },
  });
  return client;
}

describe('recordCommissionForPayment — fraud & idempotency guards', () => {
  it('does nothing for a payer with no referral attribution', async () => {
    const supabase = makeSupabaseMock();
    const result = await recordCommissionForPayment(supabase, {
      payerId: 'user-1', sourcePaymentId: 'pay-1', paymentAmountNgn: 5000, monthNumber: 1,
    });
    expect(result.status).toBe('no_referral');
  });

  it('records a cash commission for a dev-class referral on month 1', async () => {
    const supabase = makeSupabaseMock({
      conversions: [{ id: 'conv-1', partner_id: 'partner-1', referred_user_id: 'user-1', fraud_flag: null }],
      partners: [{ id: 'partner-1', class: 'dev', status: 'active' }],
    });
    const result = await recordCommissionForPayment(supabase, {
      payerId: 'user-1', sourcePaymentId: 'pay-1', paymentAmountNgn: 10000, monthNumber: 1,
    });
    expect(result.status).toBe('commission_recorded');
    expect(supabase._state.commissions).toHaveLength(1);
    expect(supabase._state.commissions[0].commission_ngn).toBeCloseTo(1200); // 12% of 10000
    expect(supabase._state.commissions[0].status).toBe('pending');
  });

  it('is idempotent — the same payment reference never generates two commissions', async () => {
    const supabase = makeSupabaseMock({
      conversions: [{ id: 'conv-1', partner_id: 'partner-1', referred_user_id: 'user-1', fraud_flag: null }],
      partners: [{ id: 'partner-1', class: 'dev', status: 'active' }],
    });
    await recordCommissionForPayment(supabase, { payerId: 'user-1', sourcePaymentId: 'pay-1', paymentAmountNgn: 10000, monthNumber: 1 });
    const second = await recordCommissionForPayment(supabase, { payerId: 'user-1', sourcePaymentId: 'pay-1', paymentAmountNgn: 10000, monthNumber: 1 });
    expect(second.status).toBe('already_recorded');
    expect(supabase._state.commissions).toHaveLength(1);
  });

  it('pays no commission once the referral is flagged fraudulent', async () => {
    const supabase = makeSupabaseMock({
      conversions: [{ id: 'conv-1', partner_id: 'partner-1', referred_user_id: 'user-1', fraud_flag: 'self_referral_suspected' }],
      partners: [{ id: 'partner-1', class: 'dev', status: 'active' }],
    });
    const result = await recordCommissionForPayment(supabase, {
      payerId: 'user-1', sourcePaymentId: 'pay-1', paymentAmountNgn: 10000, monthNumber: 1,
    });
    expect(result.status).toBe('no_referral');
  });

  it('gives user-class partners a token bonus instead of cash, once only', async () => {
    const supabase = makeSupabaseMock({
      conversions: [{ id: 'conv-1', partner_id: 'partner-1', referred_user_id: 'user-1', fraud_flag: null }],
      partners: [{ id: 'partner-1', class: 'user', status: 'active' }],
    });
    const first = await recordCommissionForPayment(supabase, { payerId: 'user-1', sourcePaymentId: 'pay-1', paymentAmountNgn: 10000, monthNumber: 1 });
    expect(first.status).toBe('token_bonus');
    expect(supabase._state.tokenRewards).toHaveLength(1);

    const second = await recordCommissionForPayment(supabase, { payerId: 'user-1', sourcePaymentId: 'pay-2', paymentAmountNgn: 10000, monthNumber: 2 });
    expect(second.status).toBe('no_referral'); // month 2 — bonus already spent on month 1
  });

  it('pays no commission past the decay window', async () => {
    const supabase = makeSupabaseMock({
      conversions: [{ id: 'conv-1', partner_id: 'partner-1', referred_user_id: 'user-1', fraud_flag: null }],
      partners: [{ id: 'partner-1', class: 'influencer', status: 'active' }],
    });
    const result = await recordCommissionForPayment(supabase, {
      payerId: 'user-1', sourcePaymentId: 'pay-1', paymentAmountNgn: 10000, monthNumber: 4,
    });
    expect(result.status).toBe('no_referral');
    expect(supabase._state.commissions).toHaveLength(0);
  });
});

describe('attributeConversion — self-referral guard', () => {
  it('refuses to attribute a partner referring themselves', async () => {
    const supabase = makeSupabaseMock();
    supabase._state.clicks = [{ partner_id: 'partner-1', created_at: new Date().toISOString(), visitor_hash: 'hash-1' }];
    supabase.from = (table: string) => {
      if (table === 'referral_clicks') {
        return { select: () => ({ eq: () => ({ gte: () => ({ order: async () => ({ data: supabase._state.clicks, error: null }) }) }) }) };
      }
      if (table === 'referral_partners') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'partner-1', user_id: 'same-user', status: 'active' }, error: null }) }) }) };
      }
      return supabase._chain(table, 'select');
    };

    const result = await attributeConversion(supabase, { newUserId: 'same-user', visitorHash: 'hash-1' });
    expect(result).toEqual({ skipped: 'self_referral' });
  });
});

describe('clawBackCommission', () => {
  it('reverses a pending commission on refund', async () => {
    const supabase = makeSupabaseMock({
      commissions: [{ id: 'c-1', source_payment_id: 'pay-1', status: 'pending' }],
    });
    supabase.from = (table: string) => {
      if (table === 'referral_commissions') {
        return {
          update: () => ({
            eq: () => ({
              in: () => ({
                select: async () => ({
                  data: supabase._state.commissions.filter((c: any) => c.source_payment_id === 'pay-1'),
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return supabase._chain(table, 'update');
    };
    const result = await clawBackCommission(supabase, 'pay-1');
    expect(result.reversed).toBe(true);
  });
});
