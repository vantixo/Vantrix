/**
 * GET /api/characters/:id/export
 *
 * Owner-only. Returns the character serialized as a portable JSON package
 * (see @/lib/characters/export) with a Content-Disposition header so it
 * downloads as a file from the browser.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canExport } from '@/lib/characters/ownership';
import { buildCharacterExportPackage, packageFilename } from '@/lib/characters/export';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const { data: character, error } = await supabaseAdmin
      .from('characters')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !character) {
      return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (!canExport(character, user.id)) {
      return NextResponse.json({ error: 'Only the creator can export this character', code: 'FORBIDDEN' }, { status: 403 });
    }

    const pkg = buildCharacterExportPackage(character);
    const filename = packageFilename(character);

    return new NextResponse(JSON.stringify(pkg, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    logger.error('Character export GET error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
