import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { resolveAccountNumber, listBanks, PaystackTransferError } from '@/lib/paystack-transfer';

const resolveSchema = z.object({
  accountNumber: z.string().regex(/^\d{10}$/, 'Must be a 10-digit NUBAN account number'),
  bankCode: z.string().min(1),
});

/**
 * POST /api/referrals/verify-bank
 *
 * Resolves account number + bank code to the account holder's name via
 * Paystack, so the UI can show "Is this you? [Name]" before the partner
 * confirms — catches typos before they cause a failed/misdirected payout.
 * This does NOT save anything; /api/referrals/bank-details does that.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = resolveSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });

  try {
    const { accountName } = await resolveAccountNumber(parsed.data);
    return NextResponse.json({ accountName });
  } catch (err) {
    const message = err instanceof PaystackTransferError ? err.message : 'Could not resolve account';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

/** GET /api/referrals/verify-bank — returns the bank list for a dropdown. */
export async function GET() {
  try {
    const banks = await listBanks();
    return NextResponse.json({ banks });
  } catch (err) {
    const message = err instanceof PaystackTransferError ? err.message : 'Could not fetch bank list';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
