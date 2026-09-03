/**
 * GET /api/digital-twin/export
 *
 * Returns the caller's trained digital twin as a standalone, versioned
 * JSON document (see PortableTwinExport in lib/digital-twin/engine.ts) —
 * not tied to Vantrix's internal schema, so it can be downloaded and fed
 * into another companion app. Served with a Content-Disposition header so
 * a direct link/fetch from the client downloads a file rather than
 * navigating to raw JSON.
 *
 * Elite-tier gated, same as the rest of the digital twin feature.
 */

import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requirePlan } from '@/lib/auth/plan';
import { exportTwinProfile } from '@/lib/digital-twin/engine';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    await requirePlan(user.id, 'premium', 'Digital Twin');

    const exportData = await exportTwinProfile(user.id);
    if (!exportData) {
      return NextResponse.json(
        { error: 'Train your digital twin before exporting it.', code: 'NOT_TRAINED' },
        { status: 400 }
      );
    }

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="vantrix-digital-twin-${user.id.slice(0, 8)}.json"`,
      },
    });
  } catch (err) {
    logger.error('digital-twin export error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
