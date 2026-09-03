import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { generateCode } from '@/lib/referral-engine';
import { CLASS_REQUIREMENTS } from '@/lib/referral-config';

const schema = z.object({
  requestedClass: z.enum(['dev', 'influencer']),
  applicationNote: z.string().min(20).max(2000),
  socialProofUrl: z.string().url(),
  followerCount: z.number().int().min(0).optional(),
  vanitySlug: z.string().regex(/^[a-z0-9-]{3,24}$/).optional(),
});

/**
 * POST /api/referrals/apply
 *
 * Entry point for devs and influencers to apply for a cash-commission
 * tier. Both classes require manual approval (CLASS_REQUIREMENTS) — this
 * route creates a 'pending_review' partner row and never auto-approves,
 * even for influencer follower counts that clear the minimum, because a
 * follower count alone doesn't tell you about audience quality or fraud
 * risk. An admin approves via /api/admin/referrals/approve.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { requestedClass, applicationNote, socialProofUrl, followerCount, vanitySlug } = parsed.data;

  const requirements = CLASS_REQUIREMENTS[requestedClass];
  if (requirements.minFollowers && (followerCount ?? 0) < requirements.minFollowers) {
    return NextResponse.json({
      error: `${requestedClass} tier requires at least ${requirements.minFollowers} followers`,
      code: 'BELOW_MINIMUM',
    }, { status: 403 });
  }

  const { data: existing } = await supabase
    .from('referral_partners').select('id,status').eq('user_id', user.id).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'You already have a referral partner record', status: existing.status }, { status: 409 });
  }

  if (vanitySlug) {
    const { data: slugTaken } = await supabase
      .from('referral_partners').select('id').eq('vanity_slug', vanitySlug).maybeSingle();
    if (slugTaken) return NextResponse.json({ error: 'That vanity link is already taken' }, { status: 409 });
  }

  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  const code = generateCode(profile?.display_name ?? user.email ?? user.id);

  const { data: partner, error } = await supabase.from('referral_partners').insert({
    user_id: user.id,
    class: requestedClass,
    status: 'pending_review',
    code,
    vanity_slug: vanitySlug ?? null,
    application_note: applicationNote,
    social_proof_url: socialProofUrl,
    follower_count: followerCount ?? null,
  }).select('id,status,code').single();

  if (error || !partner) {
    return NextResponse.json({ error: 'Failed to submit application', detail: error?.message }, { status: 500 });
  }

  return NextResponse.json({ applicationId: partner.id, status: partner.status, code: partner.code });
}
