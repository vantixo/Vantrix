/**
 * POST /api/digital-twin/chat
 *
 * Generates a reply "as the user" from their trained digital twin —
 * e.g. "what would I say back to this?" Elite-tier gated, requires the
 * twin to already be trained (POST /api/digital-twin/train first).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requirePlan } from '@/lib/auth/plan';
import { generateTwinReply } from '@/lib/digital-twin/engine';
import { ratelimit } from '@/lib/rate-limit';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({
  prompt: z.string().min(1).max(2000),
  adjustment: z.enum(['as_is', 'warmer', 'concise', 'playful', 'direct']).optional(),
  variantCount: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    await requirePlan(user.id, 'premium', 'Digital Twin');

    const { success: rlOk } = await ratelimit.limit(`digital-twin-chat:${user.id}`);
    if (!rlOk) {
      return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR' }, { status: 400 });

    const result = await generateTwinReply(user.id, parsed.data.prompt, {
      adjustment: parsed.data.adjustment,
      variantCount: parsed.data.variantCount,
    });

    if (result.status === 'not_trained') {
      return NextResponse.json({
        error: 'Your digital twin hasn\'t been trained yet — train it first.',
        code: 'NOT_TRAINED',
      }, { status: 400 });
    }
    if (result.status === 'disabled') {
      return NextResponse.json({
        error: 'Your digital twin is currently turned off.',
        code: 'TWIN_DISABLED',
      }, { status: 400 });
    }

    return NextResponse.json({ replies: result.replies });
  } catch (err) {
    logger.error('digital-twin chat error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
