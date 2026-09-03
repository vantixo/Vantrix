import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/admin';
import { requirePermission } from '@/lib/auth/permissions';
import { ForbiddenError } from '@/lib/errors';
import { recordAdminAction } from '@/lib/admin/audit';

const schema = z.object({
  partnerId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  rejectionReason: z.string().max(500).optional(),
});

/**
 * POST /api/admin/referrals/approve
 *
 * Admin-only. Approves or rejects a pending dev/influencer application.
 *
 * AUDIT FIX (2026-07-19): previously re-implemented the admin check inline
 * as `profile.role !== 'admin'`, which — like the bug already fixed once in
 * requireAdmin() itself — silently rejects an account granted admin only
 * via the is_admin boolean. Now defers to the single shared requireAdmin()
 * helper so this can't drift out of sync again.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await requireAdmin(user.id);
    await requirePermission(user.id, 'referrals.approve');
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const { partnerId, decision, rejectionReason } = parsed.data;

  const { data: partner } = await supabase.from('referral_partners').select('id,status').eq('id', partnerId).single();
  if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (partner.status !== 'pending_review') {
    return NextResponse.json({ error: `Application is already ${partner.status}` }, { status: 409 });
  }

  const update = decision === 'approve'
    ? { status: 'active' as const, approved_at: new Date().toISOString(), approved_by: user.id }
    : { status: 'rejected' as const, application_note: rejectionReason ?? null };

  const { error } = await supabase.from('referral_partners').update(update).eq('id', partnerId);
  if (error) return NextResponse.json({ error: 'Update failed', detail: error.message }, { status: 500 });

  await recordAdminAction({
    adminId: user.id,
    action: decision === 'approve' ? 'referral.approved' : 'referral.rejected',
    targetType: 'referral_partner',
    targetId: partnerId,
    metadata: decision === 'reject' ? { rejectionReason: rejectionReason ?? null } : {},
  });

  return NextResponse.json({ partnerId, status: update.status });
}
