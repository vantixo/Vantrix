import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requireAdmin } from '@/lib/auth/admin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/ads/images
 *
 * Lists creatives the admin has uploaded to the public `ad-images` storage
 * bucket, newest first, so the admin Ads UI can offer a "reuse a previous
 * upload" picker alongside uploading something new.
 *
 * PREVIOUSLY: this walked public/images on disk, which only ever reflected
 * whatever shipped with the build — an admin could pick from a handful of
 * bundled images but could never actually add a new one, and on a
 * serverless deploy (see vercel.json) that directory isn't writable at
 * request time anyway. Real uploads now go through
 * POST /api/admin/ads/upload into the bucket this route reads from, so
 * "add an ad at will" is now actually true end to end.
 */
export async function GET() {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const { data, error } = await supabaseAdmin.storage
      .from('ad-images')
      .list('', { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw error;

    const images = (data ?? [])
      // .list() on a flat bucket can return a placeholder entry for the
      // "directory" itself on some storage backends — filter to real files.
      .filter(entry => entry.name && entry.id)
      .map(entry => {
        const { data: { publicUrl } } = supabaseAdmin.storage.from('ad-images').getPublicUrl(entry.name);
        return { name: entry.name, url: publicUrl };
      });

    return NextResponse.json({ images });
  } catch (err) {
    logger.error('Admin ads images GET error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
