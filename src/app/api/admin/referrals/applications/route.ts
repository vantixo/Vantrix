import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/admin';
import { ForbiddenError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * GET /api/admin/referrals/applications
 *
 * Lists pending (and optionally all) dev/influencer applications for the
 * admin review UI. Feeds components/admin/referral-applications.tsx.
 *
 * AUDIT FIX (2026-07-19): see approve/route.ts — same stale role-only check
 * replaced with the shared requireAdmin() helper.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await requireAdmin(user.id);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const VALID_STATUSES = ['active', 'pending_review', 'rejected', 'suspended'] as const;
  type PartnerStatus = (typeof VALID_STATUSES)[number];
  const rawStatus = req.nextUrl.searchParams.get('status') ?? 'pending_review';
  const statusFilter: PartnerStatus | 'all' =
    rawStatus === 'all' || (VALID_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as PartnerStatus | 'all')
      : 'pending_review';

  let query = supabase
    .from('referral_partners')
    .select('id,user_id,class,status,code,application_note,social_proof_url,follower_count,created_at')
    .in('class', ['dev', 'influencer'])
    .order('created_at', { ascending: true });

  if (statusFilter !== 'all') query = query.eq('status', statusFilter);

  const { data: applications, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load applications' }, { status: 500 });

  const userIds = (applications ?? []).map(a => a.user_id);
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabase.from('profiles').select('id,display_name').in('id', userIds)
    : { data: [] as { id: string; display_name: string | null }[], error: null };
  if (profilesError) {
    logger.warn('admin:referrals:applications:profiles-fetch-failed', { error: profilesError.message });
  }

  const profileById = new Map((profiles ?? []).map(p => [p.id, p]));

  const enriched = (applications ?? []).map(a => ({
    ...a,
    applicantName: profileById.get(a.user_id)?.display_name ?? 'Unknown',
  }));

  return NextResponse.json({ applications: enriched });
}
