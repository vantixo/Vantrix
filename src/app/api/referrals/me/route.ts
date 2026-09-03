import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateCode } from '@/lib/referral-engine';

/**
 * GET /api/referrals/me
 *
 * Returns the current user's referral partner record — auto-creating a
 * free 'user' class one on first call (no application needed for that
 * tier; dev/influencer must go through /api/referrals/apply instead).
 * Includes lifetime stats for the dashboard.
 */
export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let { data: partner } = await supabase
    .from('referral_partners')
    .select('id,class,status,code,vanity_slug,created_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!partner) {
    const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
    const code = generateCode(profile?.display_name ?? user.email ?? user.id);
    const { data: created, error } = await supabase.from('referral_partners').insert({
      user_id: user.id, class: 'user', status: 'active', code,
    }).select('id,class,status,code,vanity_slug,created_at').single();
    if (error || !created) return NextResponse.json({ error: 'Failed to create referral profile' }, { status: 500 });
    partner = created;
  }

  const [{ count: clickCount }, { data: conversions }, { data: commissions }, { data: tokenRewards }] = await Promise.all([
    supabase.from('referral_clicks').select('id', { count: 'exact', head: true }).eq('partner_id', partner.id),
    supabase.from('referral_conversions').select('id,created_at').eq('partner_id', partner.id),
    supabase.from('referral_commissions').select('commission_ngn,status').eq('partner_id', partner.id),
    supabase.from('referral_token_rewards').select('tokens_awarded').eq('partner_id', partner.id),
  ]);

  const totalPayableNgn = (commissions ?? [])
    .filter(c => c.status === 'payable')
    .reduce((sum, c) => sum + Number(c.commission_ngn), 0);
  const totalPaidNgn = (commissions ?? [])
    .filter(c => c.status === 'paid')
    .reduce((sum, c) => sum + Number(c.commission_ngn), 0);
  const totalPendingNgn = (commissions ?? [])
    .filter(c => c.status === 'pending')
    .reduce((sum, c) => sum + Number(c.commission_ngn), 0);
  const totalTokens = (tokenRewards ?? []).reduce((sum, t) => sum + t.tokens_awarded, 0);

  const linkPath = partner.vanity_slug ? `/r/${partner.vanity_slug}` : `/r/${partner.code}`;

  return NextResponse.json({
    class: partner.class,
    status: partner.status,
    code: partner.code,
    referralLink: `https://vantrix.ink${linkPath}`,
    stats: {
      totalClicks: clickCount ?? 0,
      totalConversions: (conversions ?? []).length,
      totalTokensEarned: totalTokens,
      commissionPendingNgn: totalPendingNgn,
      commissionPayableNgn: totalPayableNgn,
      commissionPaidNgn: totalPaidNgn,
    },
  });
}
