/**
 * GET /api/queue/workers — Worker registry, DLQ, provider health
 *
 * Hardening:
 *   - Requires ADMIN_SECRET_TOKEN (or METRICS_SECRET as fallback) in all environments.
 *   - Uses timingSafeEqual (via validateBearer) to prevent timing attacks.
 *   - DLQ entries are returned without job.message content to avoid leaking
 *     user PII to admins who don't need it.
 */

import { NextRequest, NextResponse }                       from 'next/server';
import { getLiveWorkers, getDLQEntries, isScaleOutSignalled } from '@/lib/queue/scaler';
import { getQueueDepths }                                  from '@/lib/queue';
import { getProviderHealth }                               from '@/lib/ai/provider-router';
import { metrics }                                         from '@/lib/observability';
import { validateBearer }                                  from '@/lib/security';
import { env }                                              from '@/env';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Standardized on ADMIN_SECRET_TOKEN (the same env var every other admin
  // route uses — see /api/admin/ops, /api/admin/generate-character-portraits). This
  // route previously read a nonexistent `ADMIN_SECRET` var (not the Zod-
  // validated `ADMIN_SECRET_TOKEN`), so a correctly-configured admin token
  // would never authenticate here — only an accidental METRICS_SECRET match
  // would. Falls back to METRICS_SECRET for monitoring dashboards that only
  // have metrics-level access.
  const secret = env.ADMIN_SECRET_TOKEN || env.METRICS_SECRET;
  if (!secret || !validateBearer(req, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [workers, dlqRaw, scaleOut, queueDepths, providerHealth, summary] = await Promise.all([
      getLiveWorkers(),
      getDLQEntries(20),
      isScaleOutSignalled(),
      getQueueDepths(),
      getProviderHealth(),
      metrics.dashboardSummary(),
    ]);

    // Strip PII (message content) from DLQ entries before returning
    const dlq = dlqRaw.map(e => ({
      jobId:       e.job.id,
      userId:      e.job.userId,
      characterId: e.job.characterId,
      tier:        e.job.tier,
      attempts:    e.job.attempts,
      status:      e.result.status,
      error:       e.result.error,
      enqueuedAt:  e.enqueuedAt,
      worker:      e.worker,
    }));

    return NextResponse.json({
      workers,
      dlq: { count: dlq.length, entries: dlq },
      scaleOut,
      queueDepths,
      providerHealth,
      observability: summary,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
