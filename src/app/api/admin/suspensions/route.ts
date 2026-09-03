/**
 * GET   /api/admin/suspensions?userId=... — check whether a user is suspended
 * PATCH /api/admin/suspensions            — lift a user's suspension
 *
 * Companion route to src/lib/ai/anomaly-detector.ts. That module can flag a
 * user SUSPEND on runaway/loop token abuse (writes a 24h Redis flag,
 * enforced at /api/chat/stream and /api/queue/enqueue) but previously had
 * no read/lift surface at all — the flag either sat there for 24h with no
 * way to check it, or an admin had to reach into Redis by hand to clear it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requirePermission }        from '@/lib/auth/permissions';
import { requireAdmin }              from '@/lib/auth/admin';
import { isUserSuspended, liftSuspension } from '@/lib/ai/anomaly-detector';
import { toErrorBody, AppError }     from '@/lib/errors';
import { recordAdminAction }         from '@/lib/admin/audit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const userId = req.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'userId query param required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const suspended = await isUserSuspended(userId);
    return NextResponse.json({ userId, suspended });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}

const patchSchema = z.object({
  userId: z.string().uuid(),
});

export async function PATCH(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);
    await requirePermission(user.id, 'users.disable');

    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    await liftSuspension(parsed.data.userId);

    await recordAdminAction({
      adminId: user.id,
      action: 'suspension.lifted',
      targetType: 'user',
      targetId: parsed.data.userId,
    });

    return NextResponse.json({ ok: true, userId: parsed.data.userId, suspended: false });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}
