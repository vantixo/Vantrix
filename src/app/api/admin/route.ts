import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin }   from '@/lib/supabase/admin';
import { requireAdmin }    from '@/lib/auth/admin';
import { toErrorBody, errorLogFields }     from '@/lib/errors';
import { logger }          from '@/lib/logger';
import { z }               from 'zod';
import { isSafeExternalUrl, isSafeLocalImagePath, isSafeInternalLinkPath } from '@/lib/security';
import { isAllowedImageHost } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Module-level — used in both GET and POST handlers
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const adCreateSchema = z.object({
  title:     z.string().min(1).max(200),
  // EXT-LINK-FIX duplication bug (Phase B audit, 2026-08-06): this schema
  // duplicates ads/route.ts's adSchema but was missing the
  // isSafeExternalUrl refinement that route already had — meaning the
  // admin panel's create_ad action (this file) accepted javascript:/data:
  // URIs while the public ads/route.ts POST correctly rejected them. Same
  // feature, two schemas, one fixed. Brought into parity here.
  //
  // image_url also accepts a site-relative /public asset path (e.g.
  // "/images/characters/rumi.jpg") so admins can run ads off images
  // already shipped with the app instead of needing an external CDN URL
  // for every creative. isSafeLocalImagePath rejects "..", "//", and any
  // scheme, so this can't be abused as an open redirect or traversal.
  image_url: z.string().min(1).max(500).refine(
    (v) => isSafeLocalImagePath(v) || (z.string().url().safeParse(v).success && isSafeExternalUrl(v)),
    { message: 'image_url must be an http(s) URL or a /public asset path' },
  ),
  // ADS-INAPP-FIX: link now also accepts a site-relative app route (e.g.
  // "/pricing", "/create-character") so admin ads pointing at Vantrix's
  // own features are treated — by AdBoard — as in-app navigation rather
  // than forced through an absolute URL and rendered as an outside
  // sponsored ad. A genuine external URL still requires http(s) and
  // passes the same isSafeExternalUrl scheme check as before.
  link:      z.string().min(1).max(500).refine(
    (v) => isSafeInternalLinkPath(v) || (z.string().url().safeParse(v).success && isSafeExternalUrl(v)),
    { message: 'link must be an in-app path (e.g. /pricing) or an http(s) URL' },
  ),
  position:  z.enum(['hero', 'sidebar', 'inline']),
  // Which Discover homepage this ad targets — 'all' (default) keeps prior
  // behavior (runs everywhere); female/male/anime scope it to one of the
  // three gender-locked homepages so each can carry its own distinct ad.
  audience:  z.enum(['all', 'female', 'male', 'anime']).optional().default('all'),
  active:    z.boolean().optional().default(true),
  // See 20261220_seed_baked_hero_ad_creatives.sql — true for creatives
  // that already have their headline/CTA designed into the image, so
  // HeroAdsCarousel skips its own gradient+title overlay for the row.
  hide_overlay: z.boolean().optional().default(false),
});

// Login page portrait collage (/auth/login) — stored as JSON in
// app_config.login_portraits and served publicly via
// /api/config/login-portraits. Same src rules as ad images, PLUS a
// hostname check ad images don't have: this one renders through next/image
// directly on the public login route, and next/image hard-throws a
// render-crashing error for any host not in next.config.js's
// images.remotePatterns — not a broken-image icon, a page-down error, on
// the one page every signed-out visitor must load to sign in. isSafeExternalUrl
// only checks the scheme (http/https), so without this an admin could save
// a perfectly "valid" URL here that still takes down /auth/login for
// everyone the moment it renders. isAllowedImageHost mirrors that same
// remotePatterns list, so a bad host is now rejected here with a clear
// error instead of blowing up the login page after the fact.
const loginPortraitSchema = z.object({
  src: z.string().min(1).max(500).refine(
    (v) => {
      if (isSafeLocalImagePath(v)) return true;
      if (!z.string().url().safeParse(v).success || !isSafeExternalUrl(v)) return false;
      try {
        return isAllowedImageHost(new URL(v).hostname);
      } catch {
        return false;
      }
    },
    { message: 'src must be a /public asset path or an http(s) URL on an allowlisted image host (see images.remotePatterns in next.config.js)' },
  ),
  alt: z.string().max(200).optional().default(''),
});
// Between 1 and 6: at least one portrait so the page never renders blank,
// capped at 6 since the desktop collage is a fixed 2x2 grid (only the first
// 4 currently render, but a small buffer is kept for future layouts).
const loginPortraitsUpdateSchema = z.array(loginPortraitSchema).min(1).max(6);

// World hub (locations + factions) banner images — see
// 20260827_world_location_faction_images.sql for why this column exists
// now and didn't before. Same src validation shape as loginPortraitSchema
// (local /public path, or an http(s) URL on an allowlisted image host —
// these render through next/image on the public World hub, which
// hard-throws for any un-allowlisted host, same failure mode documented
// on loginPortraitSchema above), minus the `alt` field since the World
// hub already sources alt text from location.name / faction.name.
const worldImageUpdateSchema = z.object({
  type: z.enum(["location", "faction"]),
  id:   z.string().regex(UUID_RE, "id must be a UUID"),
  // Empty string clears the image (reverts to WORLD_IMAGE_FALLBACK) —
  // distinct from "missing", which the .optional() below also allows so a
  // client can omit the field entirely for the same effect.
  image_url: z.string().max(500).optional().default("").refine(
    (v) => {
      if (v === "") return true;
      if (isSafeLocalImagePath(v)) return true;
      if (!z.string().url().safeParse(v).success || !isSafeExternalUrl(v)) return false;
      try {
        return isAllowedImageHost(new URL(v).hostname);
      } catch {
        return false;
      }
    },
    { message: "image_url must be empty, a /public asset path, or an http(s) URL on an allowlisted image host (see images.remotePatterns in next.config.js)" },
  ),
});

// Same shape as worldImageUpdateSchema minus the type discriminator — there's
// only one target table (roleplay_scenarios), so no need for the
// location/faction switch.
const scenarioImageUpdateSchema = z.object({
  id: z.string().regex(UUID_RE, "id must be a UUID"),
  image_url: z.string().max(500).optional().default("").refine(
    (v) => {
      if (v === "") return true;
      if (isSafeLocalImagePath(v)) return true;
      if (!z.string().url().safeParse(v).success || !isSafeExternalUrl(v)) return false;
      try {
        return isAllowedImageHost(new URL(v).hostname);
      } catch {
        return false;
      }
    },
    { message: "image_url must be empty, a /public asset path, or an http(s) URL on an allowlisted image host (see images.remotePatterns in next.config.js)" },
  ),
});

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const resource = new URL(req.url).searchParams.get('resource') ?? 'stats';

    switch (resource) {
      case 'stats': {
        const [
          { count: users },
          { count: characters },
          { count: conversations },
          { count: ads },
        ] = await Promise.all([
          supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
          supabaseAdmin.from('characters').select('*', { count: 'exact', head: true }),
          supabaseAdmin.from('conversations').select('*', { count: 'exact', head: true }),
          supabaseAdmin.from('ads').select('*', { count: 'exact', head: true }),
        ]);
        return NextResponse.json({ users, characters, conversations, ads });
      }
      case 'users': {
        const { data } = await supabaseAdmin
          .from('profiles')
          .select('id,username,tier,country,created_at,role')
          .order('created_at', { ascending: false })
          .limit(50);
        return NextResponse.json({ users: data });
      }
      case 'ads': {
        const { data } = await supabaseAdmin
          .from('ads')
          .select('id,title,image_url,link,position,audience,active,impressions,clicks,created_at')
          .order('created_at', { ascending: false })
          .limit(50);
        return NextResponse.json({ ads: data });
      }
      case 'login_portraits': {
        const { data } = await supabaseAdmin
          .from('app_config')
          .select('value,updated_at')
          .eq('key', 'login_portraits')
          .maybeSingle();
        let portraits: unknown = [];
        try {
          portraits = data?.value ? JSON.parse(data.value) : [];
        } catch {
          portraits = [];
        }
        return NextResponse.json({ portraits, updated_at: data?.updated_at ?? null });
      }
      case 'world_images': {
        // Powers /admin/world — every location + faction banner in one
        // list so an admin can paste in the art generated from the World
        // location prompt sheet without touching Supabase directly.
        const [{ data: locations }, { data: factions }] = await Promise.all([
          supabaseAdmin
            .from('world_locations')
            .select('id,name,slug,archetype,is_capital,image_url')
            .order('is_capital', { ascending: false })
            .order('name', { ascending: true }),
          supabaseAdmin
            .from('factions')
            .select('id,name,slug,is_ruling,image_url')
            .order('is_ruling', { ascending: false })
            .order('name', { ascending: true }),
        ]);
        return NextResponse.json({ locations: locations ?? [], factions: factions ?? [] });
      }
      case 'scenario_images': {
        // Powers /admin/scenarios — mirrors /admin/world's world_images
        // resource. location_slug/faction_slug are included so the row
        // can show which place a scenario is scoped to (universal
        // scenarios have both NULL).
        const { data: scenarios } = await supabaseAdmin
          .from('roleplay_scenarios')
          .select('id,slug,title,genre,min_tier,location_slug,faction_slug,cover_image_url,sort_order')
          .order('sort_order', { ascending: true });
        return NextResponse.json({ scenarios: scenarios ?? [] });
      }
      default:
        return NextResponse.json({ error: 'Unknown resource', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
  } catch (err) {
    logger.error('Admin GET error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const body = await req.json();
    const { action } = body as { action: string };

    switch (action) {
      case 'create_ad': {
        const parsed = adCreateSchema.safeParse(body.data);
        if (!parsed.success) {
          return NextResponse.json({ error: 'Invalid ad data', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin.from('ads').insert({
          ...parsed.data,
          created_by:  user.id,
          impressions: 0,
          clicks:      0,
        }).select('id,title,position,active').single();
        if (error) throw error;
        return NextResponse.json({ ad: data });
      }
      case 'toggle_ad': {
        const { id, active } = body as { id: string; active: boolean };
        if (typeof id !== 'string' || !UUID_RE.test(id) || typeof active !== 'boolean') {
          return NextResponse.json({ error: 'Invalid toggle payload', code: 'VALIDATION_ERROR' }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from('ads').update({ active }).eq('id', id)
          .select('id,title,active').single();
        if (error) throw error;
        return NextResponse.json({ ad: data });
      }
      case 'delete_ad': {
        const { id } = body as { id: string };
        if (typeof id !== 'string' || !UUID_RE.test(id)) {
          return NextResponse.json({ error: 'Invalid ad id', code: 'VALIDATION_ERROR' }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from('ads').delete().eq('id', id)
          .select('id,title').maybeSingle();
        if (error) throw error;
        if (!data) {
          return NextResponse.json({ error: 'Ad not found', code: 'NOT_FOUND' }, { status: 404 });
        }
        logger.info('Admin: ad deleted', { adId: id, title: data.title, by: user.id });
        return NextResponse.json({ success: true, deleted: data });
      }
      case 'set_role': {
        // Promote/demote a user's role
        const { userId, role } = body as { userId: string; role: string };
        if (!['user', 'admin', 'moderator'].includes(role)) {
          return NextResponse.json({ error: 'Invalid role', code: 'VALIDATION_ERROR' }, { status: 400 });
        }
        // MED-5: Validate userId is a proper UUID before any DB write.
        // An invalid format causes a cryptic Postgres error; this surfaces it clearly.
        if (!userId || !UUID_RE.test(userId)) {
          return NextResponse.json({ error: 'Invalid userId format', code: 'VALIDATION_ERROR' }, { status: 400 });
        }
        // SEC-3 (FIXED): Prevent admins from demoting themselves and losing access
        if (userId === user.id && role !== 'admin') {
          return NextResponse.json(
            { error: 'Cannot demote yourself — assign another admin first', code: 'SELF_DEMOTION_FORBIDDEN' },
            { status: 400 },
          );
        }
        // SEC-9 FIX: requireAdmin()/isAdminProfile() grant access on
        // `role === 'admin' OR is_admin === true` — the two fields are
        // meant to move together. This endpoint previously only ever wrote
        // `role`. `is_admin` is set exactly once anywhere in this codebase
        // (bootstrap/route.ts, always `true`, never `false`) — so demoting
        // a bootstrap-granted (or otherwise is_admin=true) account via this
        // panel returned "success: true" while silently leaving full admin
        // access intact forever, since nothing ever cleared the flag.
        // Keeping both fields in lockstep here closes that gap: promoting
        // to 'admin' sets is_admin true; demoting away from 'admin' clears it.
        const { error } = await supabaseAdmin.from('profiles')
          .update({ role, is_admin: role === 'admin' })
          .eq('id', userId);
        if (error) throw error;
        logger.info('Admin: role changed', { target: userId, role, by: user.id });
        return NextResponse.json({ success: true });
      }
      case 'update_login_portraits': {
        const parsed = loginPortraitsUpdateSchema.safeParse(body.data);
        if (!parsed.success) {
          return NextResponse.json({ error: 'Invalid portraits data', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 });
        }
        const { error } = await supabaseAdmin.from('app_config').upsert({
          key: 'login_portraits',
          value: JSON.stringify(parsed.data),
          description: "JSON array of {src, alt} portraits shown on the /auth/login page background collage. First entry is also used as the mobile blurred backdrop. Edit via /admin/login-portraits.",
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
        if (error) throw error;
        logger.info('Admin: login portraits updated', { count: parsed.data.length, by: user.id });
        return NextResponse.json({ success: true, portraits: parsed.data });
      }
      case 'update_world_image': {
        const parsed = worldImageUpdateSchema.safeParse(body.data);
        if (!parsed.success) {
          return NextResponse.json({ error: 'Invalid image data', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 });
        }
        const { type, id, image_url } = parsed.data;
        const table = type === 'location' ? 'world_locations' : 'factions';
        const { data, error } = await supabaseAdmin
          .from(table)
          .update({ image_url: image_url || null })
          .eq('id', id)
          .select('id,name,image_url')
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          return NextResponse.json({ error: `${type === 'location' ? 'Location' : 'Faction'} not found`, code: 'NOT_FOUND' }, { status: 404 });
        }
        logger.info('Admin: world image updated', { type, id, by: user.id });
        return NextResponse.json({ success: true, [type]: data });
      }
      case 'update_scenario_image': {
        const parsed = scenarioImageUpdateSchema.safeParse(body.data);
        if (!parsed.success) {
          return NextResponse.json({ error: 'Invalid image data', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 });
        }
        const { id, image_url } = parsed.data;
        const { data, error } = await supabaseAdmin
          .from('roleplay_scenarios')
          .update({ cover_image_url: image_url || null })
          .eq('id', id)
          .select('id,title,cover_image_url')
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          return NextResponse.json({ error: 'Scenario not found', code: 'NOT_FOUND' }, { status: 404 });
        }
        logger.info('Admin: scenario image updated', { id, by: user.id });
        return NextResponse.json({ success: true, scenario: data });
      }
      default:
        return NextResponse.json({ error: 'Unknown action', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
  } catch (err) {
    logger.error('Admin POST error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
