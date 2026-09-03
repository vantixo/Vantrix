/**
 * paystack-transfer.ts
 *
 * Real implementation of Paystack's Transfer API, used to actually pay
 * referral partners. Mirrors the style of your existing
 * src/lib/payments/paystack.ts (same base URL, same auth header pattern).
 *
 * Paystack's transfer flow is two calls:
 *   1. POST /transferrecipient  — register the bank account, get a recipient_code
 *   2. POST /transfer           — send money to that recipient_code
 *
 * Recipient codes are cached on referral_partners.paystack_recipient_code
 * (added by the migration in this package) so we don't re-register the
 * same bank account on every payout run.
 */

import { env } from '@/env';

const PAYSTACK_BASE = 'https://api.paystack.co';

function authHeaders() {
  return {
    Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

export class PaystackTransferError extends Error {
  constructor(message: string, public readonly paystackResponse?: unknown) {
    super(message);
    this.name = 'PaystackTransferError';
  }
}

/** Resolves an account number + bank code to the account holder's name, so partners can't typo their own payout details. */
export async function resolveAccountNumber(params: { accountNumber: string; bankCode: string }): Promise<{ accountName: string }> {
  const url = `${PAYSTACK_BASE}/bank/resolve?account_number=${encodeURIComponent(params.accountNumber)}&bank_code=${encodeURIComponent(params.bankCode)}`;
  const res = await fetch(url, { headers: authHeaders() });
  const json = await res.json();
  if (!res.ok || !json.status) {
    throw new PaystackTransferError(json.message ?? 'Account resolution failed', json);
  }
  return { accountName: json.data.account_name };
}

/** Returns the list of supported banks (NGN, active only) — for populating a bank-select dropdown. */
export async function listBanks(): Promise<{ name: string; code: string }[]> {
  const res = await fetch(`${PAYSTACK_BASE}/bank?currency=NGN`, { headers: authHeaders() });
  const json = await res.json();
  if (!res.ok || !json.status) throw new PaystackTransferError(json.message ?? 'Failed to list banks', json);
  return (json.data as { name: string; code: string }[]).map(b => ({ name: b.name, code: b.code }));
}

/** Registers (or re-registers) a transfer recipient. Idempotent on Paystack's side per account+bank pair. */
export async function createTransferRecipient(params: {
  accountName: string; accountNumber: string; bankCode: string;
}): Promise<{ recipientCode: string }> {
  const res = await fetch(`${PAYSTACK_BASE}/transferrecipient`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      type: 'nuban',
      name: params.accountName,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: 'NGN',
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.status) {
    throw new PaystackTransferError(json.message ?? 'Failed to create transfer recipient', json);
  }
  return { recipientCode: json.data.recipient_code };
}

/**
 * Sends the actual transfer. `reference` should be your internal
 * referral_payouts.id — Paystack deduplicates on reference, so retrying
 * this function with the same payout id after a network error is safe and
 * will not double-pay.
 */
export async function initiateTransfer(params: {
  amountNgn: number; recipientCode: string; reference: string; reason?: string;
}): Promise<{ transferCode: string; status: string }> {
  const res = await fetch(`${PAYSTACK_BASE}/transfer`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      source: 'balance',
      amount: Math.round(params.amountNgn * 100), // kobo
      recipient: params.recipientCode,
      reference: params.reference,
      reason: params.reason ?? 'Vantrix referral commission payout',
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.status) {
    throw new PaystackTransferError(json.message ?? 'Transfer failed', json);
  }
  return { transferCode: json.data.transfer_code, status: json.data.status };
}

/**
 * Minimal structural type for the Supabase client this function needs —
 * narrowed to exactly the two calls made below (a `select().eq().single()`
 * read and an `update().eq()` write on referral_partners), the same
 * narrow-to-what's-read pattern used for embed-select shapes elsewhere in
 * this codebase (e.g. lib/universe/community-engine.ts), in place of a
 * blanket `any`. Deliberately loose enough that both the real
 * `@supabase/supabase-js` client and the lightweight test mock in
 * paystack-transfer.test.ts satisfy it structurally.
 */
interface PayPartnerSupabaseClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        single(): PromiseLike<{
          data: {
            payout_bank_code: string | null;
            payout_account_no: string | null;
            payout_account_name: string | null;
            paystack_recipient_code: string | null;
          } | null;
          error: { message?: string } | null;
        }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
}

/**
 * Convenience wrapper used by the payout cron: resolves-or-reuses a
 * recipient code, then sends the transfer. Callers pass a Supabase client
 * so this can read/write the cached recipient code on referral_partners.
 */
export async function payPartner(
  supabase: PayPartnerSupabaseClient,
  params: { partnerId: string; amountNgn: number; payoutId: string }
): Promise<{ transferCode: string }> {
  const { data: partner, error } = await supabase
    .from('referral_partners')
    .select('payout_bank_code,payout_account_no,payout_account_name,paystack_recipient_code')
    .eq('id', params.partnerId)
    .single();

  if (error || !partner) throw new PaystackTransferError(`Partner ${params.partnerId} not found`);
  if (!partner.payout_bank_code || !partner.payout_account_no) {
    throw new PaystackTransferError(`Partner ${params.partnerId} has no bank details on file`);
  }

  let recipientCode = partner.paystack_recipient_code as string | null;

  if (!recipientCode) {
    const { recipientCode: newCode } = await createTransferRecipient({
      accountName: partner.payout_account_name ?? '',
      accountNumber: partner.payout_account_no,
      bankCode: partner.payout_bank_code,
    });
    recipientCode = newCode;
    await supabase.from('referral_partners')
      .update({ paystack_recipient_code: recipientCode })
      .eq('id', params.partnerId);
  }

  const { transferCode } = await initiateTransfer({
    amountNgn: params.amountNgn,
    recipientCode,
    reference: params.payoutId,
  });

  return { transferCode };
}
