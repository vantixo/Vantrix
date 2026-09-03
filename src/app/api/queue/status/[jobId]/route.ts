/**
 * GET /api/queue/status/[jobId]
 *
 * Polling endpoint for async chat jobs. Returns the job status and result
 * when processing is complete.
 *
 * Statuses: pending → processing → done | failed | dead
 * Results are retained for 10 minutes (RESULT_TTL_SECONDS in queue/index.ts).
 *
 * Auth: the jobId acts as a capability token — only the client that
 * received the jobId from /api/queue/enqueue can poll it.
 * Rate: limited by the global ratelimit middleware.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getJobResult, getJobStatus } from '@/lib/queue';

export const dynamic = 'force-dynamic';

export const runtime = 'edge';

export async function GET(_req: NextRequest, props: { params: Promise<{ jobId: string }> }) {
  const params = await props.params;
  const { jobId } = params;

  // LOW-1 fix: strict UUID v4 validation
  const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_V4_RE.test(jobId)) {
    return NextResponse.json({ error: 'Invalid jobId format', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  // MED-6: Authenticate before returning any job result.
  // Without this, any user who learns a jobId (from logs, shared device, etc.)
  // can read another user's AI reply.
  const { user } = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  // Try result first (set when done/failed/dead)
  const result = await getJobResult(jobId);
  if (result) {
    // MED-6: Verify the job belongs to this user
    if (result.userId && result.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=1' },
    });
  }

  // Job still in flight — return status only
  const status = await getJobStatus(jobId);
  if (!status) {
    return NextResponse.json(
      { error: 'Job not found or expired', code: 'NOT_FOUND', jobId },
      { status: 404 },
    );
  }

  return NextResponse.json({ jobId, status }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
