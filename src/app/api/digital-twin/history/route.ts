/**
 * GET    /api/digital-twin/history — list the caller's twin reply history
 * DELETE /api/digital-twin/history        — clear all history
 * DELETE /api/digital-twin/history?id=... — delete a single entry
 *
 * Elite-tier gated. Every generated reply has always been logged to
 * digital_twin_messages (see generateTwinReply in lib/digital-twin/engine.ts)
 * but until now there was no route to read it back — this fills that gap.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requirePlan } from '@/lib/auth/plan';
import { getTwinHistory, deleteTwinHistoryEntry, clearTwinHistory } from '@/lib/digital-twin/engine';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    await requirePlan(user.id, 'premium', 'Digital Twin');

    const history = await getTwinHistory(user.id);
    return NextResponse.json({ history });
  } catch (err) {
    logger.error('digital-twin history GET error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

const idSchema = z.string().uuid();

export async function DELETE(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    await requirePlan(user.id, 'premium', 'Digital Twin');

    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');

    if (idParam) {
      const parsed = idSchema.safeParse(idParam);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      await deleteTwinHistoryEntry(user.id, parsed.data);
      return NextResponse.json({ success: true, deleted: parsed.data });
    }

    await clearTwinHistory(user.id);
    return NextResponse.json({ success: true, cleared: true });
  } catch (err) {
    logger.error('digital-twin history DELETE error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
