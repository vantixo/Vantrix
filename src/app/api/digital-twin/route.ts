/**
 * GET  /api/digital-twin — fetch the caller's digital twin profile
 * PATCH /api/digital-twin — manual refinement (notes, sample phrases, enable/disable)
 *
 * Elite-tier gated (see canUseDigitalTwin() in lib/tiers/config.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requirePlan } from '@/lib/auth/plan';
import { getDigitalTwinProfile, updateManualProfile } from '@/lib/digital-twin/engine';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  manualNotes: z.string().max(2000).optional(),
  manualSamplePhrases: z.array(z.string().max(100)).max(10).optional(),
  enabled: z.boolean().optional(),
});

export async function GET() {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    await requirePlan(user.id, 'premium', 'Digital Twin');

    const profile = await getDigitalTwinProfile(user.id);
    return NextResponse.json({ profile });
  } catch (err) {
    logger.error('digital-twin GET error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    await requirePlan(user.id, 'premium', 'Digital Twin');

    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR' }, { status: 400 });

    const profile = await updateManualProfile(user.id, parsed.data);
    return NextResponse.json({ profile });
  } catch (err) {
    logger.error('digital-twin PATCH error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
