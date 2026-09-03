/**
 * GET /api/health
 *
 * Health check for uptime monitors, load balancers, and Kubernetes probes.
 *
 * Security (MED-4 FIX): Infrastructure details are gated behind WORKER_SECRET.
 * Unauthenticated callers receive only a binary ok/degraded status.
 * This prevents attackers from timing attacks (e.g. hitting when circuit is
 * HALF_OPEN) or mapping the platform's internal service topology.
 *
 * Extended internal view (x-worker-secret) also exposes:
 *   - Per-circuit breaker state (OpenRouter, Stripe, Paystack, NowPayments)
 *   - Queue depths (high / normal / low)
 *   - Platform token usage vs hourly budget
 *   - Cron liveness (dead man's switch pattern for daily-reset)
 *   - DB connectivity + latency
 *   - Redis degraded flag from hardened-client
 */

import { NextRequest, NextResponse }                    from 'next/server';
import { getCircuitBreaker }                            from '@/lib/circuit-breaker';
import { getQueueDepths }                               from '@/lib/queue';
import { getPlatformHourlyUsage }                       from '@/lib/ai/adaptive-quota';
import { env }                                          from '@/env';
import { timingSafeEqual }                              from '@/lib/security';
import { supabaseAdmin }                                from '@/lib/supabase/admin';
import { isPlatformDegraded }                           from '@/lib/redis/hardened-client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const workerSecret = req.headers.get('x-worker-secret');
    const isInternal   = workerSecret ? timingSafeEqual(workerSecret, env.WORKER_SECRET) : false;

    // Fast path — circuit breaker state is in-memory, no I/O needed
    const circuits = {
      openrouter:  getCircuitBreaker('openrouter').getStats(),
      stripe:      getCircuitBreaker('stripe').getStats(),
      paystack:    getCircuitBreaker('paystack').getStats(),
      nowpayments: getCircuitBreaker('nowpayments').getStats(),
      paddle:      getCircuitBreaker('paddle').getStats(),
    };
    const anyCircuitOpen = Object.values(circuits).some(c => c.state === 'OPEN');

    // Public-only response — binary status, no topology exposed
    if (!isInternal) {
      return NextResponse.json({
        status: anyCircuitOpen ? 'degraded' : 'ok',
        ts:     new Date().toISOString(),
        // M-03: surface the hardened-client circuit breaker state so that
        // alerting built on /api/health catches Redis-degraded incidents.
        // Previously, an operator could see "all breakers closed" while the
        // platform was in degraded mode — these two breaker systems had zero
        // knowledge of each other.
        redisHardenedClientDegraded: isPlatformDegraded(),
      }, { status: anyCircuitOpen ? 503 : 200 });
    }

    // Internal: gather full diagnostics in parallel
    const [queueDepths, platformTokens, dbCheck, cronCheck] = await Promise.allSettled([
      getQueueDepths(),
      getPlatformHourlyUsage(),

      // DB connectivity + latency
      (async () => {
        const t0 = Date.now();
        const { error } = await supabaseAdmin.from('app_config').select('key').limit(1);
        return { ok: !error, latencyMs: Date.now() - t0, error: error?.message };
      })(),

      // Cron liveness — dead man's switch for daily-reset
      (async () => {
        const today = new Date().toISOString().split('T')[0];
        const { data } = await supabaseAdmin
          .from('profiles')
          .select('daily_reset_at')
          .order('daily_reset_at', { ascending: false })
          .limit(1)
          .single();
        const lastRun  = data?.daily_reset_at ?? null;
        const isStale  = lastRun ? lastRun < today : true;
        return {
          lastRun,
          isStale,
          warning: isStale
            ? 'Daily reset cron may have missed — users may be locked out of daily limits'
            : null,
        };
      })(),
    ]);

    const db    = dbCheck.status    === 'fulfilled' ? dbCheck.value    : { ok: false, latencyMs: -1 };
    const cron  = cronCheck.status  === 'fulfilled' ? cronCheck.value  : { isStale: true, lastRun: null };
    const queue = queueDepths.status === 'fulfilled' ? queueDepths.value : { high: -1, normal: -1, low: -1 };
    const ptok  = platformTokens.status === 'fulfilled' ? platformTokens.value : 0;

    const totalQueueDepth = queue.high + queue.normal + queue.low;
    const status          = anyCircuitOpen || !db.ok ? 'degraded' : 'ok';

    return NextResponse.json({
      status,
      ts:      new Date().toISOString(),
      version: process.env.npm_package_version ?? 'unknown',
      circuits,
      // M-03: the hardened-client circuit breaker is separate from circuit-
      // breaker.ts and was invisible here before this patch. Now surfaced in
      // both the public and internal responses.
      redisHardenedClientDegraded: isPlatformDegraded(),
      queue: { depths: queue, total: totalQueueDepth },
      ai: {
        platformTokensThisHour: ptok,
        hourlyBudget:           env.PLATFORM_HOURLY_TOKEN_BUDGET,
        utilizationPct:         env.PLATFORM_HOURLY_TOKEN_BUDGET > 0
          ? Math.round((ptok / env.PLATFORM_HOURLY_TOKEN_BUDGET) * 100)
          : null,
      },
      database: db,
      crons: {
        daily_reset: cron,
      },
    }, { status: status === 'ok' ? 200 : 503 });

  } catch (err) {
    // P2 fix: never leak internal exception details (db/provider/config
    // strings) to a public, unauthenticated caller. Log the real error
    // server-side and return only an opaque code.
    console.error('[health] check failed:', err);
    return NextResponse.json({
      status: 'error',
      ts:     new Date().toISOString(),
      code:   'HEALTH_CHECK_FAILED',
    }, { status: 503 });
  }
}
