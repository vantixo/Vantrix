import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/env', () => ({
  env: { PAYSTACK_SECRET_KEY: 'sk_test_mock' },
}));

import {
  resolveAccountNumber,
  createTransferRecipient,
  initiateTransfer,
  payPartner,
  PaystackTransferError,
} from '../paystack-transfer';

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as any;
}

describe('resolveAccountNumber', () => {
  it('returns the account name on success', async () => {
    mockFetchOnce(200, { status: true, data: { account_name: 'Jane Doe' } });
    const result = await resolveAccountNumber({ accountNumber: '0123456789', bankCode: '058' });
    expect(result.accountName).toBe('Jane Doe');
  });

  it('throws PaystackTransferError on an invalid account', async () => {
    mockFetchOnce(422, { status: false, message: 'Could not resolve account name' });
    await expect(resolveAccountNumber({ accountNumber: '0000000000', bankCode: '058' }))
      .rejects.toBeInstanceOf(PaystackTransferError);
  });
});

describe('createTransferRecipient', () => {
  it('returns a recipient code', async () => {
    mockFetchOnce(201, { status: true, data: { recipient_code: 'RCP_xyz123' } });
    const result = await createTransferRecipient({ accountName: 'Jane Doe', accountNumber: '0123456789', bankCode: '058' });
    expect(result.recipientCode).toBe('RCP_xyz123');
  });
});

describe('initiateTransfer', () => {
  it('converts NGN to kobo correctly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ status: true, data: { transfer_code: 'TRF_abc', status: 'success' } }),
    });
    global.fetch = fetchMock as any;

    await initiateTransfer({ amountNgn: 1250.5, recipientCode: 'RCP_xyz123', reference: 'payout-1' });

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callBody.amount).toBe(125050); // 1250.50 NGN -> kobo
  });

  it('throws on failed transfer', async () => {
    mockFetchOnce(400, { status: false, message: 'Insufficient balance' });
    await expect(initiateTransfer({ amountNgn: 1000, recipientCode: 'RCP_x', reference: 'payout-2' }))
      .rejects.toThrow('Insufficient balance');
  });
});

describe('payPartner', () => {
  function makeSupabaseMock(partner: any) {
    return {
      from: (_table: string) => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: partner, error: null }) }) }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      }),
    };
  }

  it('reuses a cached recipient code instead of re-registering', async () => {
    const supabase = makeSupabaseMock({
      payout_bank_code: '058', payout_account_no: '0123456789',
      payout_account_name: 'Jane Doe', paystack_recipient_code: 'RCP_cached',
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ status: true, data: { transfer_code: 'TRF_abc', status: 'success' } }),
    });
    global.fetch = fetchMock as any;

    const result = await payPartner(supabase, { partnerId: 'p-1', amountNgn: 5000, payoutId: 'payout-1' });
    expect(result.transferCode).toBe('TRF_abc');
    // Only ONE fetch call — the transfer — because the recipient code was already cached.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the partner has no bank details on file', async () => {
    const supabase = makeSupabaseMock({ payout_bank_code: null, payout_account_no: null });
    await expect(payPartner(supabase, { partnerId: 'p-1', amountNgn: 5000, payoutId: 'payout-1' }))
      .rejects.toBeInstanceOf(PaystackTransferError);
  });
});
