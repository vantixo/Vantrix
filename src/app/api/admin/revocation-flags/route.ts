/**
 * GET   /api/admin/revocation-flags        — list flags (default: pending only)
 * PATCH /api/admin/revocation-flags         — clear a pending flag before it executes
 *
 * Companion route to src/lib/payments/revocation.ts. Every refund/dispute
 * webhook (Stripe/Paystack/NOWPayments) flags the paying user's tier for
 * automatic downgrade after a grace period (see REVOCATION_GRACE_PERIOD_DAYS).
 * This route is where an admin reviews those flags and clears the ones that
 * don't warrant losing access (dispute resolved in the user's favor,
 * provider error, duplicate charge, etc) before the sweep cron acts on them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser }             from '@/lib/auth/get-authed-user';
import { requireAdmin }              from '@/lib/auth/admin';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { clearRevocationFlag }       from '@/lib/payments/revocation';
import { recordAdminAction }         from '@/lib/admin/audit';
import { toErrorBody, AppError }     from '@/lib/errors';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const statusParam = req.nextUrl.searchParams.get('status') ?? 'pending';
    const status = ['pending', 'cleared', 'executed', 'all'].includes(statusParam) ? statusParam : 'pending';

    let query = supabaseAdmin
      .from('subscription_revocation_flags')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw new Error(`revocation-flags list failed: ${error.message}`);

    return NextResponse.json({ flags: data ?? [] });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}

const patchSchema = z.object({
  flagId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { cleared, flag } = await clearRevocationFlag(supabaseAdmin, {
      flagId: parsed.data.flagId,
      adminId: user.id,
      reason: parsed.data.reason,
    });

    if (!cleared) {
      return NextResponse.json(
        { error: 'Flag not found or no longer pending', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    await recordAdminAction({
      adminId: user.id,
      action: 'revocation_flag.cleared',
      targetType: 'user',
      targetId: flag!.user_id,
      metadata: { revocationFlagId: flag!.id, provider: flag!.provider, reason: parsed.data.reason ?? null },
    });

    return NextResponse.json({ ok: true, flag });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}
