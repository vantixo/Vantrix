/**
 * GET /api/metrics — Prometheus-compatible metrics exposition
 *
 * Hardening changes:
 *   - METRICS_SECRET is required in production (NODE_ENV === 'production').
 *     In development, the check is skipped for convenience.
 *   - Uses timingSafeEqual for Bearer comparison (prevents timing attacks).
 *   - HEAD method returns 200 for health-check probes without auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { metrics }                    from '@/lib/observability';
import { validateBearer }             from '@/lib/security';
import { env }                        from '@/env';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = env.METRICS_SECRET;

  // Production: secret required. Dev: skip check for convenience.
  if (process.env.NODE_ENV === 'production') {
    if (!secret) {
      return new Response('METRICS_SECRET is not set — endpoint disabled in production', { status: 503 });
    }
    if (!validateBearer(req, secret)) {
      return new Response('Unauthorized', { status: 401 });
    }
  } else if (secret && !validateBearer(req, secret)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const format = new URL(req.url).searchParams.get('format');
    if (format === 'json') {
      const summary = await metrics.dashboardSummary();
      return NextResponse.json(summary);
    }
    const exposition = await metrics.prometheusExposition();
    return new Response(exposition, {
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Health check — no auth required (just connectivity)
export async function HEAD() {
  return new Response(null, { status: 200 });
}
