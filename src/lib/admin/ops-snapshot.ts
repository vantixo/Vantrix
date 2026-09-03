// src/lib/admin/ops-snapshot.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared by /api/admin/ops (external monitoring / CI, token-authed) and
// /admin/ops (the staff-facing page, session-authed) so the two never drift
// and a Server Component render doesn't need a self-referential HTTP round
// trip to its own app just to read data it could call directly.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin }             from '@/lib/supabase/admin';
import { getCircuitBreaker }         from '@/lib/circuit-breaker';
import { getQueueDepths }            from '@/lib/queue';
import { getPlatformHourlyUsage }    from '@/lib/ai/adaptive-quota';
import { getBillingDLQDepth }        from '@/lib/ai/billing-dlq';
import { env }                       from '@/env';
import { redis }                     from '@/lib/redis';

// Kept in sync with lib/circuit-breaker.ts's `breakers` export — this list
// previously omitted 'image-gen' and 'supabase-auth', so those two breakers
// silently never appeared on any ops dashboard even after opening.
const CIRCUIT_NAMES = [
  'openrouter', 'groq', 'anthropic', 'together', 'grok',
  'stripe', 'paystack', 'nowpayments', 'paddle',
  'image-gen', 'supabase-auth',
] as const;

export interface OpsSnapshot {
  status: 'healthy' | 'degraded' | 'throttled' | 'billing_lag';
  timestamp: string;
  ai: {
    tokensThisHour: number;
    budgetPct: number;
    estimatedCostHour: string;
    cacheHitRatePct: number | null;
    billingDLQDepth: number;
  };
  providers: {
    circuits: Record<string, { state: string; failures: number; successes: number; openedAt: number | null }>;
    openCircuits: { name: string; state: string; failures: number }[];
    allHealthy: boolean;
  };
  queue: { depths: Record<string, number>; total: number };
  platform: { activeUsersToday: number | null; tierBreakdown: Record<string, number> | null };
  alerts: { severity: 'error' | 'warn'; message: string }[];
}

export async function getOpsSnapshot(): Promise<OpsSnapshot> {
  const [queueDepths, platformTokensHour, billingDLQDepth] = await Promise.all([
    getQueueDepths(),
    getPlatformHourlyUsage(),
    getBillingDLQDepth(),
  ]);

  const circuits: OpsSnapshot['providers']['circuits'] = {};
  for (const name of CIRCUIT_NAMES) {
    try {
      circuits[name] = getCircuitBreaker(name).getStats();
    } catch {
      circuits[name] = { state: 'UNKNOWN', failures: 0, successes: 0, openedAt: null };
    }
  }
  const openCircuits = Object.entries(circuits)
    .filter(([, s]) => s.state !== 'CLOSED')
    .map(([name, s]) => ({ name, state: s.state, failures: s.failures }));

  let cacheHitRate: number | null = null;
  try {
    const [hits, misses] = await Promise.all([
      redis.get<string>('vantrix:metrics:cache_hits:today'),
      redis.get<string>('vantrix:metrics:cache_misses:today'),
    ]);
    const h = parseInt(hits ?? '0', 10);
    const m = parseInt(misses ?? '0', 10);
    if (h + m > 0) cacheHitRate = Math.round((h / (h + m)) * 100);
  } catch { /* non-critical */ }

  const budgetPct = Math.round((platformTokensHour / env.PLATFORM_HOURLY_TOKEN_BUDGET) * 100);

  let activeUsersToday: number | null = null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { count } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .gte('updated_at', `${today}T00:00:00Z`);
    activeUsersToday = count ?? 0;
  } catch { /* non-critical */ }

  let tierBreakdown: Record<string, number> | null = null;
  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('tier')
      .not('tier', 'eq', 'free');
    if (data) {
      tierBreakdown = data.reduce<Record<string, number>>((acc, row) => {
        const tier = row.tier as string;
        acc[tier] = (acc[tier] ?? 0) + 1;
        return acc;
      }, {});
    }
  } catch { /* non-critical */ }

  const estimatedCostHour = (platformTokensHour / 1_000_000) * 0.28;

  const status: OpsSnapshot['status'] =
    openCircuits.length > 0 ? 'degraded'
    : budgetPct > 90        ? 'throttled'
    : billingDLQDepth > 0   ? 'billing_lag'
    : 'healthy';

  return {
    status,
    timestamp: new Date().toISOString(),
    ai: {
      tokensThisHour: platformTokensHour,
      budgetPct,
      estimatedCostHour: `$${estimatedCostHour.toFixed(3)}`,
      cacheHitRatePct: cacheHitRate,
      billingDLQDepth,
    },
    providers: { circuits, openCircuits, allHealthy: openCircuits.length === 0 },
    queue: { depths: queueDepths, total: Object.values(queueDepths).reduce((a, b) => a + b, 0) },
    platform: { activeUsersToday, tierBreakdown },
    alerts: [
      ...openCircuits.map(c => ({ severity: 'error' as const, message: `Circuit OPEN: ${c.name} (${c.failures} failures)` })),
      ...(budgetPct > 90 ? [{ severity: 'warn' as const, message: `Platform at ${budgetPct}% of hourly token budget` }] : []),
      ...(billingDLQDepth > 10 ? [{ severity: 'warn' as const, message: `Billing DLQ has ${billingDLQDepth} pending retries` }] : []),
    ],
  };
}
