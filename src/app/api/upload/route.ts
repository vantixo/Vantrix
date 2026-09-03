import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { uploadLimiter } from '@/lib/rate-limit';
import { toErrorBody, errorLogFields }   from '@/lib/errors';
import { logger }        from '@/lib/logger';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES      = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIZE_BYTES      = 5 * 1024 * 1024; // 5 MB
const ALLOWED_EXTENSIONS  = /\.(jpe?g|png|webp|gif)$/i;

/**
 * Magic-byte validators for each accepted MIME type.
 *
 * file.type is client-supplied and can be spoofed to bypass MIME checks.
 * Reading the first 12 bytes of the actual payload and comparing against
 * known magic signatures catches polyglot files (e.g. a PHP script named
 * avatar.png with Content-Type: image/png).
 *
 * Byte offsets:
 *   JPEG  — FF D8 FF (any next byte)
 *   PNG   — 89 50 4E 47 0D 0A 1A 0A
 *   WebP  — 52 49 46 46 ?? ?? ?? ?? 57 45 42 50  ("RIFF????WEBP")
 *   GIF   — 47 49 46 38 (3? or 9?) 61             ("GIF8?a")
 */
const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/png':  b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47
                  && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A,
  'image/webp': b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
                  && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  'image/gif':  b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38
                  && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
};

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    // Rate limit: 20 uploads / hour per user
    const { success: rlOk } = await uploadLimiter.limit(user.id);
    if (!rlOk) {
      return NextResponse.json(
        { error: 'Upload limit reached. Maximum 20 uploads per hour.', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: { 'Retry-After': '3600' } },
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Layer 1: Declared MIME type ────────────────────────────────────────
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({
        error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF',
        code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    // ── Layer 2: File extension ────────────────────────────────────────────
    if (!ALLOWED_EXTENSIONS.test(file.name)) {
      return NextResponse.json({ error: 'Invalid file extension', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Layer 3: Size check ────────────────────────────────────────────────
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({
        error: `File too large. Maximum size is ${MAX_SIZE_BYTES / 1024 / 1024}MB`,
        code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    // ── Layer 4: Magic bytes — verify actual file content matches MIME type
    // Read only the first 12 bytes (enough for all supported formats).
    // Avoids loading the whole file into memory for signature detection.
    const headerBuffer = await file.slice(0, 12).arrayBuffer();
    const headerBytes  = new Uint8Array(headerBuffer);
    const magicCheck   = MAGIC[file.type];
    if (!magicCheck || !magicCheck(headerBytes)) {
      logger.warn('Upload blocked: magic bytes mismatch', {
        userId:        user.id,
        declaredType:  file.type,
        firstBytes:    Array.from(headerBytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' '),
      });
      return NextResponse.json({
        error: 'File content does not match declared type.',
        code:  'VALIDATION_ERROR',
      }, { status: 400 });
    }

    // ── Sanitize filename — strip path traversal, keep alphanumeric + safe chars
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const fileName = `${user.id}/${Date.now()}-${safeName}`;

    const { error } = await supabase.storage.from('uploads').upload(fileName, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(fileName);
    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    logger.error('Upload error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
