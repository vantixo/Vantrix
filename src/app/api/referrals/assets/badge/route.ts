import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderQlinkBadge } from '@/lib/referral-assets';

/**
 * GET /api/referrals/assets/badge?code=PARTNERCODE&size=120
 *
 * Circular "Qlink" badge — a small round partner pin, meant for a sidebar,
 * footer, or next to a bio. Same validation and caching approach as the
 * banner route.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const sizeParam = req.nextUrl.searchParams.get('size');
  const diameter = Math.min(400, Math.max(48, Number(sizeParam) || 120));

  if (!code) {
    return NextResponse.json({ error: 'Missing ?code=<your referral code>' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const { data: partner } = await supabase
    .from('referral_partners').select('id,status,class').eq('code', code).maybeSingle();

  if (!partner || partner.status !== 'active') {
    return NextResponse.json({ error: 'Unknown or inactive referral code' }, { status: 404 });
  }

  const label = partner.class === 'influencer' ? 'Vantrix Creator' : partner.class === 'dev' ? 'Vantrix Dev Partner' : 'Vantrix Partner';
  const svg = renderQlinkBadge({ diameter, label });

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
