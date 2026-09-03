import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requireAdmin }  from '@/lib/auth/admin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toErrorBody, errorLogFields }   from '@/lib/errors';
import { logger }        from '@/lib/logger';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES     = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIZE_BYTES     = 5 * 1024 * 1024; // 5 MB — matches the bucket's file_size_limit
const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp|gif)$/i;

// Same magic-byte signature check as /api/upload — file.type is
// client-supplied and can be spoofed, so the actual bytes are verified too.
const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/png':  b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47
                  && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A,
  'image/webp': b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
                  && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  'image/gif':  b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38
                  && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
};

/**
 * POST /api/admin/ads/upload
 *
 * Admin-only. Uploads an ad creative to the public `ad-images` storage
 * bucket (see 20260938_ad_images_bucket.sql) and returns its public URL —
 * this is the real "add an ad image at will" path. Replaces the old
 * disk-listing library at GET /api/admin/ads/images, which could only ever
 * surface images already bundled into the build.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({
        error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF',
        code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }
    if (!ALLOWED_EXTENSIONS.test(file.name)) {
      return NextResponse.json({ error: 'Invalid file extension', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({
        error: `File too large. Maximum size is ${MAX_SIZE_BYTES / 1024 / 1024}MB`,
        code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    const headerBuffer = await file.slice(0, 12).arrayBuffer();
    const headerBytes  = new Uint8Array(headerBuffer);
    const magicCheck   = MAGIC[file.type];
    if (!magicCheck || !magicCheck(headerBytes)) {
      logger.warn('Ad image upload blocked: magic bytes mismatch', {
        adminId: user.id,
        declaredType: file.type,
      });
      return NextResponse.json({
        error: 'File content does not match declared type.',
        code:  'VALIDATION_ERROR',
      }, { status: 400 });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const fileName = `${Date.now()}-${safeName}`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from('ad-images')
      .upload(fileName, file, { contentType: file.type, upsert: false });
    if (uploadErr) throw uploadErr;

    const { data: { publicUrl } } = supabaseAdmin.storage.from('ad-images').getPublicUrl(fileName);

    logger.info('Admin: ad image uploaded', { adminId: user.id, fileName });
    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    logger.error('Admin ads upload error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

/**
 * DELETE /api/admin/ads/upload?file=<name>
 *
 * Admin-only. Removes a previously-uploaded creative from the ad-images
 * bucket. Only accepts a bare filename (no path separators) — this bucket
 * is flat, uploads are never namespaced into folders.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const file = req.nextUrl.searchParams.get('file');
    if (!file || file.includes('/') || file.includes('..')) {
      return NextResponse.json({ error: 'Invalid file', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.storage.from('ad-images').remove([file]);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Admin ads upload DELETE error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
