/**
 * GET /api/ads
 *
 * Public, unauthenticated read of active advertising rows only.
 * This is the sole feed for the ad board / hero-banner-for-ads slot —
 * it never joins or falls back to `characters`. Admin add/remove
 * (POST /api/admin with action create_ad / toggle_ad / delete_ad)
 * is the only way rows here change; this route just reads what's active.
 *
 * Query params:
 *   position — "hero" | "sidebar" | "inline" (omit for all positions)
 *   audience — "female" | "male" | "anime" (omit for no audience filter —
 *              returns ads targeted at that audience plus any 'all' ad,
 *              so the three gender-locked Discover homepages each get
 *              their own distinct creative without losing shared/global ads)
 *   limit    — max rows to return (default 10, max 20)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const VALID_POSITIONS = new Set(['hero', 'sidebar', 'inline']);
const VALID_AUDIENCES = new Set(['female', 'male', 'anime']);

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const positionParam = sp.get('position');
    const audienceParam = sp.get('audience');
    const rawLimit = parseInt(sp.get('limit') ?? '10', 10);
    const limit = Math.min(20, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 10));

    let q = supabaseAdmin
      .from('ads')
      .select('id,title,image_url,link,position,audience')
      .eq('active', true);

    if (positionParam) {
      if (!VALID_POSITIONS.has(positionParam)) {
        return NextResponse.json({ error: 'Invalid position', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      q = q.eq('position', positionParam);
    }

    if (audienceParam) {
      if (!VALID_AUDIENCES.has(audienceParam)) {
        return NextResponse.json({ error: 'Invalid audience', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      // Ads targeted at this specific homepage, plus untargeted ('all') ads
      // that run everywhere — so a female-only creative never leaks onto
      // /discover/male, but a global brand ad still shows on all three.
      q = q.in('audience', [audienceParam, 'all']);
    }

    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;

    return NextResponse.json(
      { ads: data ?? [] },
      { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' } },
    );
  } catch (err) {
    logger.error('Public ads GET error', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Failed to fetch ads', ads: [] }, { status: 500 });
  }
}

/**
 * POST /api/ads
 *
 * Fire-and-forget stat pings from the ad board — no auth, matches the
 * existing increment_ad_stat() grant to `anon, authenticated` in the DB.
 * Body: { id: string, stat: 'impression' | 'click' }
 */
export async function POST(req: NextRequest) {
  try {
    const { id, stat } = await req.json() as { id?: string; stat?: string };
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof id !== 'string' || !UUID_RE.test(id) || (stat !== 'impression' && stat !== 'click')) {
      return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const column = stat === 'impression' ? 'impressions' : 'clicks';
    const { error } = await supabaseAdmin.rpc('increment_ad_stat', { p_ad_id: id, p_column: column });
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Public ads POST (stat) error', { error: err instanceof Error ? err.message : String(err) });
    // Stat pings should never break the user's experience — fail quiet.
    return NextResponse.json({ success: false }, { status: 200 });
  }
}
