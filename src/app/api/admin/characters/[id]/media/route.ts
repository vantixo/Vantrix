/**
 * POST /api/admin/characters/[id]/media — upload image/video for a
 * seeded/existing character, storing the result on R2 and writing the
 * resulting URL onto the character row.
 *
 * Why this exists: seeded characters previously only ever got imagery two
 * ways — a static placeholder at seed time, or a Fal.ai-generated portrait
 * via the LoRA pipeline / regenerate-portraits route. There was no path to
 * hand-upload real image/video assets for a character at all. This mirrors
 * the security layers of the existing user-facing /api/upload route (magic
 * bytes, size caps, sanitized filenames) but is admin-gated and extended to
 * video, and writes directly onto the `characters` row instead of returning
 * a bare URL for the caller to store themselves.
 *
 * `field` selects which character column the resulting URL is written to:
 *   - avatar / image / featured  -> single-URL columns (avatar_url,
 *     image_url, featured_image_url) — a new upload replaces the old value
 *   - gallery_image / gallery_video -> appended to the corresponding
 *     TEXT[] gallery column (see 20260717_character_media_gallery.sql)
 *   - intro_video -> intro_video_url (single-URL, replaces old value)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z }               from 'zod';
import { getAuthedUser }   from '@/lib/auth/get-authed-user';
import { requireAdmin }    from '@/lib/auth/admin';
import { supabaseAdmin }   from '@/lib/supabase/admin';
import { uploadLimiter }   from '@/lib/rate-limit';
import { uploadBufferToR2 } from '@/lib/storage/r2';
import { toErrorBody, errorLogFields }     from '@/lib/errors';
import { logger }          from '@/lib/logger';
import type { TablesUpdate } from '@/types/supabase';

export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 8  * 1024 * 1024;  // 8 MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i;

/**
 * Magic-byte validators. file.type is client-supplied and spoofable — these
 * check the actual payload bytes, same approach as /api/upload/route.ts.
 * Video containers are harder to fully fingerprint than images (MP4/MOV
 * share the same ISO-BMFF box structure and vary by brand atom; WebM is an
 * EBML/Matroska container), so these check the strongest reliable signal
 * for each rather than a single fixed byte offset:
 *   MP4/MOV — 'ftyp' box signature at offset 4 (ISO base media file format)
 *   WebM    — EBML magic number 1A 45 DF A3
 */
const IMAGE_MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/png':  b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47
                  && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A,
  'image/webp': b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
                  && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  'image/gif':  b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38
                  && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
};
const VIDEO_MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  'video/mp4':       b => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70, // 'ftyp'
  'video/quicktime': b => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70, // also ftyp-based
  'video/webm':      b => b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3,
};

const FIELD_TO_COLUMN: Record<string, { column: string; kind: 'single' | 'array'; media: 'image' | 'video'; private?: boolean }> = {
  avatar:                { column: 'avatar_url',                  kind: 'single', media: 'image' },
  image:                 { column: 'image_url',                   kind: 'single', media: 'image' },
  featured:               { column: 'featured_image_url',          kind: 'single', media: 'image' },
  intro_video:            { column: 'intro_video_url',             kind: 'single', media: 'video' },
  gallery_image:          { column: 'gallery_image_urls',          kind: 'array',  media: 'image' },
  gallery_video:          { column: 'gallery_video_urls',          kind: 'array',  media: 'video' },
  // Admin-only stash — never surfaced through public/creator-facing reads.
  // See 20260720c_private_character_gallery.sql.
  private_gallery_image:  { column: 'private_gallery_image_urls',  kind: 'array',  media: 'image', private: true },
  private_gallery_video:  { column: 'private_gallery_video_urls',  kind: 'array',  media: 'video', private: true },
};

const querySchema = z.object({
  field: z.enum([
    'avatar', 'image', 'featured', 'intro_video', 'gallery_image', 'gallery_video',
    'private_gallery_image', 'private_gallery_video',
  ]),
});

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const idCheck = z.string().uuid().safeParse(params.id);
    if (!idCheck.success) {
      return NextResponse.json({ error: 'Invalid character id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const fieldParsed = querySchema.safeParse({ field: searchParams.get('field') });
    if (!fieldParsed.success) {
      return NextResponse.json({
        error: `Invalid or missing ?field= — must be one of: ${Object.keys(FIELD_TO_COLUMN).join(', ')}`,
        code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }
    const target = FIELD_TO_COLUMN[fieldParsed.data.field];

    // Reuses the same per-admin upload rate limit as the general upload
    // route — admin accounts are not exempt from abuse protection just
    // because they're trusted; it also catches a misbehaving script.
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

    const isVideo         = target.media === 'video';
    const allowedTypes    = isVideo ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES;
    const extRe           = isVideo ? VIDEO_EXT_RE : IMAGE_EXT_RE;
    const maxBytes        = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    const magicValidators  = isVideo ? VIDEO_MAGIC : IMAGE_MAGIC;

    if (!allowedTypes.has(file.type)) {
      return NextResponse.json({
        error: `Invalid file type for ${target.media}. Allowed: ${[...allowedTypes].join(', ')}`,
        code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }
    if (!extRe.test(file.name)) {
      return NextResponse.json({ error: 'Invalid file extension', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (file.size > maxBytes) {
      return NextResponse.json({
        error: `File too large. Maximum size is ${maxBytes / 1024 / 1024}MB`,
        code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    // Magic-byte check — read enough of the header for the video/EBML
    // signatures (16 bytes covers the 'ftyp' box offset and the WebM
    // EBML header) rather than the 12 bytes the image-only route used.
    const headerBuffer = await file.slice(0, 16).arrayBuffer();
    const headerBytes  = new Uint8Array(headerBuffer);
    const magicCheck   = magicValidators[file.type];
    if (!magicCheck || !magicCheck(headerBytes)) {
      logger.warn('Admin character media upload blocked: magic bytes mismatch', {
        adminId: user.id, characterId: params.id, declaredType: file.type,
        firstBytes: Array.from(headerBytes.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' '),
      });
      return NextResponse.json({
        error: 'File content does not match declared type.',
        code:  'VALIDATION_ERROR',
      }, { status: 400 });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const r2Key    = `characters/${params.id}/${target.column}/${Date.now()}-${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadBufferToR2(buffer, r2Key, file.type);
    if (!result.success || !result.r2Url) {
      logger.error('Admin character media upload: R2 write failed', { characterId: params.id, error: result.error });
      return NextResponse.json({ error: 'Storage upload failed', code: 'STORAGE_ERROR' }, { status: 502 });
    }

    if (target.kind === 'single') {
      // Dynamic column name via target.column — cast the update payload
      // since Supabase's generated types expect literal keys from the
      // characters Update type, which a runtime-computed key can't satisfy
      // statically even though the value is valid at runtime (target.column
      // is drawn from FIELD_TO_COLUMN, a fixed whitelist, not user input).
      const { data, error } = await supabaseAdmin
        .from('characters')
        .update({ [target.column]: result.r2Url } as unknown as TablesUpdate<'characters'>)
        .eq('id', params.id)
        .select('id,name')
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });
    } else {
      // Atomic array append via SQL (array_append under a single UPDATE)
      // rather than fetch-then-write — two admins uploading to the same
      // character's gallery back-to-back could otherwise clobber each
      // other. See append_character_private_media / the equivalent public
      // gallery use in 20260720c_private_character_gallery.sql.
      const { data: exists } = await supabaseAdmin
        .from('characters')
        .select('id')
        .eq('id', params.id)
        .maybeSingle();
      if (!exists) return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });

      const rpcName = target.private ? 'append_character_private_media' : 'append_character_private_media';
      const { error: appendErr } = await supabaseAdmin.rpc(rpcName, {
        p_character_id: params.id,
        p_column:       target.column,
        p_url:          result.r2Url,
      });
      if (appendErr) throw appendErr;
    }

    logger.info('Admin: character media uploaded', {
      characterId: params.id, field: fieldParsed.data.field, by: user.id, url: result.r2Url,
    });

    return NextResponse.json({ url: result.r2Url, field: fieldParsed.data.field });
  } catch (err) {
    logger.error('Admin character media upload error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

/**
 * GET /api/admin/characters/[id]/media — list current media for a
 * character, including the admin-only private gallery. This is the only
 * read path allowed to return private_gallery_image_urls /
 * private_gallery_video_urls; every public/creator-facing route must
 * exclude those columns (see src/app/api/characters/[id]/route.ts).
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const idCheck = z.string().uuid().safeParse(params.id);
    if (!idCheck.success) {
      return NextResponse.json({ error: 'Invalid character id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('characters')
      .select('id, name, avatar_url, image_url, featured_image_url, intro_video_url, gallery_image_urls, gallery_video_urls, private_gallery_image_urls, private_gallery_video_urls')
      .eq('id', params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });

    return NextResponse.json(data);
  } catch (err) {
    logger.error('Admin character media list error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

const deleteSchema = z.object({
  field: z.enum(Object.keys(FIELD_TO_COLUMN) as [string, ...string[]]),
  url:   z.string().min(1),
});

/**
 * DELETE /api/admin/characters/[id]/media — remove a single URL from an
 * array field (gallery / private_gallery). Body: { field, url }. Manual
 * curation counterpart to the POST upload — lets an admin drop a bad or
 * unwanted image without touching the rest of the gallery.
 */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const idCheck = z.string().uuid().safeParse(params.id);
    if (!idCheck.success) {
      return NextResponse.json({ error: 'Invalid character id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Body must be { field, url }', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const target = FIELD_TO_COLUMN[parsed.data.field];
    if (target.kind !== 'array') {
      return NextResponse.json({ error: 'field must be an array field (gallery_image, gallery_video, private_gallery_image, private_gallery_video)', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.rpc('remove_character_private_media', {
      p_character_id: params.id,
      p_column:       target.column,
      p_url:          parsed.data.url,
    });
    if (error) throw error;

    logger.info('Admin: character media removed', { characterId: params.id, field: parsed.data.field, by: user.id });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Admin character media delete error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
