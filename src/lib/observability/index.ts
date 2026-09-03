/**
 * Observability Stack — Metrics, Health, and Platform Telemetry
 *
 * Provides a Prometheus-compatible metrics exposition layer backed by Redis
 * counters. Designed for zero-overhead on the request hot path: all metric
 * writes are batched and fire-and-forget.
 *
 * Metrics collected:
 *
 *   Counters (cumulative):
 *     vantrix_ai_requests_total{tier, model_tier, provider, result}
 *     vantrix_ai_cache_hits_total{tier, mode}            — exact / canonical / semantic
 *     vantrix_ai_tokens_total{tier, provider, direction} — prompt / completion
 *     vantrix_queue_jobs_total{priority, status}
 *     vantrix_errors_total{type, route}
 *
 *   Histograms (bucketed counts + sum in Redis):
 *     vantrix_ai_latency_ms{tier, provider}              — p50/p95/p99 approximation
 *     vantrix_ai_tokens_per_request{tier}
 *
 *   Gauges (current state, point-in-time):
 *     vantrix_queue_depth{priority}
 *     vantrix_circuit_breaker_state{name}                — 0=CLOSED 1=HALF_OPEN 2=OPEN
 *     vantrix_platform_hourly_tokens                     — current rolling total
 *     vantrix_cache_hit_rate_1h                          — rolling 1h hit rate
 *
 * Usage:
 *   import { metrics } from '@/lib/observability';
 *
 *   // In hot path (fire-and-forget):
 *   metrics.recordRequest({ tier, modelTier, provider, result, latencyMs, tokens });
 *
 *   // In /api/metrics route:
 *   const text = await metrics.prometheusExposition();
 *
 * All Redis writes use pipelining and are non-blocking (catch-all).
 */

import { logger, bg } from '@/lib/logger';
import { redis }              from '@/lib/redis';


// ── Key helpers ───────────────────────────────────────────────────────────────

const HOUR_KEY  = () => new Date().toISOString().slice(0, 13);   // YYYY-MM-DDTHH
const METRIC_TTL = 7 * 86_400;  // 7 days

// Bucket boundaries for latency histograms (ms)
const LATENCY_BUCKETS = [100, 250, 500, 1000, 2000, 4000, 8000];
// Bucket boundaries for token count histograms
const TOKEN_BUCKETS   = [100, 250, 500, 1000, 2000, 4000, 8000, 16000];
// Bucket boundaries for message-length histograms (chars) — mirrors the
// thresholds classifyComplexity() itself branches on (80, 500, 900), so
// routing telemetry lines up directly with the classifier's own cutoffs.
export const MSG_LEN_BUCKETS = [80, 500, 900, 2000];

function bucket(value: number, boundaries: number[]): string {
  for (const b of boundaries) {
    if (value <= b) return String(b);
  }
  return '+Inf';
}

// ── Metric event types ────────────────────────────────────────────────────────

export interface RequestMetric {
  tier:        string;
  modelTier:   string;
  provider:    string;
  result:      'success' | 'cache_hit' | 'error' | 'blocked' | 'queued';
  latencyMs:   number;
  promptTokens:     number;
  completionTokens: number;
  cacheMode?:  'exact' | 'canonical' | 'semantic';
}

export interface QueueMetric {
  priority: string;
  status:   'enqueued' | 'done' | 'failed' | 'dead' | 'stale';
  waitMs?:  number;
}

export interface ErrorMetric {
  type:  string;
  route: string;
}

// Routing-accuracy telemetry — recorded once per routeModel() call so
// over/under-routing can be measured empirically instead of by eyeballing
// classifyComplexity()'s regexes. Deliberately separate from RequestMetric:
// a routing decision happens before the provider call and can occur without
// one (e.g. forced override), so it shouldn't be coupled to request result.
export interface RoutingMetric {
  tier:         string;    // billing plan tier (free/premium — see lib/tiers/limits.ts)
  complexity:   string;    // raw classifyComplexity() output, before any capping
  finalTier:    string;    // ModelTier actually routed to, after cap/budget/escalation
  downgraded:   boolean;
  escalated:    boolean;
  datingMode:   boolean;
  msgLenBucket: string;    // bucketed, not raw length — keeps cardinality bounded
}

// ── Core metric writers ───────────────────────────────────────────────────────

async function inc(key: string, amount = 1): Promise<void> {
  try {
    const pipe = redis.pipeline();
    pipe.incrby(key, amount);
    pipe.expire(key, METRIC_TTL);
    await pipe.exec();
  } catch { /* non-critical */ }
}

async function histRecord(prefix: string, value: number, bounds: number[]): Promise<void> {
  const b = bucket(value, bounds);
  const h = HOUR_KEY();
  try {
    const pipe = redis.pipeline();
    pipe.incrby(`${prefix}:sum:${h}`, Math.round(value));
    pipe.incrby(`${prefix}:count:${h}`, 1);
    pipe.incrby(`${prefix}:bucket:${b}:${h}`, 1);
    pipe.expire(`${prefix}:sum:${h}`, METRIC_TTL);
    pipe.expire(`${prefix}:count:${h}`, METRIC_TTL);
    pipe.expire(`${prefix}:bucket:${b}:${h}`, METRIC_TTL);
    await pipe.exec();
  } catch { /* non-critical */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const metrics = {

  /** Called after every AI request (success or failure). Fire-and-forget. */
  recordRequest(m: RequestMetric): void {
    const h = HOUR_KEY();
    Promise.all([
      // Request counter
      inc(`obs:req:${m.tier}:${m.modelTier}:${m.provider}:${m.result}:${h}`),
      inc(`obs:req:total:${h}`),

      // Cache hit counter
      m.result === 'cache_hit' && m.cacheMode
        ? inc(`obs:cache:${m.tier}:${m.cacheMode}:${h}`)
        : Promise.resolve(),

      // Token counters
      m.result === 'success'
        ? Promise.all([
            inc(`obs:tokens:prompt:${m.tier}:${m.provider}:${h}`, m.promptTokens),
            inc(`obs:tokens:completion:${m.tier}:${m.provider}:${h}`, m.completionTokens),
            inc(`obs:tokens:total:${h}`, m.promptTokens + m.completionTokens),
          ])
        : Promise.resolve(),

      // Latency histogram
      histRecord(`obs:lat:${m.tier}:${m.provider}`, m.latencyMs, LATENCY_BUCKETS),

      // Token histogram
      m.result === 'success'
        ? histRecord(`obs:tok:${m.tier}`, m.promptTokens + m.completionTokens, TOKEN_BUCKETS)
        : Promise.resolve(),

    ]).catch(err => logger.warn('metrics.recordRequest error', { error: String(err) }));
  },

  /** Called on queue events. Fire-and-forget. */
  recordQueue(m: QueueMetric): void {
    const h = HOUR_KEY();
    Promise.all([
      inc(`obs:queue:${m.priority}:${m.status}:${h}`),
      m.waitMs != null
        ? histRecord(`obs:queue:wait:${m.priority}`, m.waitMs, LATENCY_BUCKETS)
        : Promise.resolve(),
    ]).catch(bg('metrics.recordQueue'));
  },

  /** Called on errors. Fire-and-forget. */
  recordError(m: ErrorMetric): void {
    const h = HOUR_KEY();
    inc(`obs:err:${m.type}:${m.route}:${h}`).catch(bg('metrics.recordError.byType'));
    inc(`obs:err:total:${h}`).catch(bg('metrics.recordError.total'));
  },

  /**
   * Called once per routeModel() call. Fire-and-forget.
   *
   * Emits three counters per call:
   *   obs:route:{tier}:{complexity}:{finalTier}:{h}   — the full decision, for
   *     spotting systematic misclassification (e.g. a complexity bucket that
   *     never actually serves at its own tier)
   *   obs:route:downgraded:{tier}:{complexity}:{h}     — how often plan cap /
   *     PEAK budget overrides the raw classification
   *   obs:route:escalated:{tier}:{complexity}:{h}      — how often the
   *     emotional-escalation budget bumps a capped tier back up
   *
   * Query these the same way as getHourlyTotals() below when building a
   * routing-accuracy dashboard: pull obs:route:* keys for the hours you
   * care about and diff complexity vs finalTier.
   */
  recordRouting(m: RoutingMetric): void {
    const h = HOUR_KEY();
    Promise.all([
      inc(`obs:route:${m.tier}:${m.complexity}:${m.finalTier}:${h}`),
      inc(`obs:route:total:${h}`),
      m.downgraded ? inc(`obs:route:downgraded:${m.tier}:${m.complexity}:${h}`) : Promise.resolve(),
      m.escalated  ? inc(`obs:route:escalated:${m.tier}:${m.complexity}:${h}`)  : Promise.resolve(),
      inc(`obs:route:msglen:${m.msgLenBucket}:${m.complexity}:${h}`),
      m.datingMode ? inc(`obs:route:dating:${m.complexity}:${m.finalTier}:${h}`) : Promise.resolve(),
    ]).catch(err => logger.warn('metrics.recordRouting error', { error: String(err) }));
  },

  /** Record circuit breaker state transition */
  recordCircuitState(name: string, state: 'CLOSED' | 'HALF_OPEN' | 'OPEN'): void {
    const val = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 }[state];
    redis.setex(`obs:cb:${name}`, 3600, val).catch(bg('metrics.recordCircuitState'));
  },

  // ── Query methods (used by /api/metrics route) ──────────────────────────

  async getHourlyTotals(hours = 24): Promise<Record<string, number>> {
    const now   = Date.now();
    const keys  = Array.from({ length: hours }, (_, i) => {
      const d = new Date(now - i * 3_600_000);
      return d.toISOString().slice(0, 13);
    });

    const result: Record<string, number> = {};
    try {
      const pipe = redis.pipeline();
      for (const h of keys) {
        pipe.get(`obs:req:total:${h}`);
        pipe.get(`obs:tokens:total:${h}`);
        pipe.get(`obs:err:total:${h}`);
      }
      const vals = await pipe.exec() as (string | null)[];
      for (let i = 0; i < keys.length; i++) {
        const h = keys[i];
        result[`req:${h}`]    = parseInt(vals[i * 3]     ?? '0', 10);
        result[`tokens:${h}`] = parseInt(vals[i * 3 + 1] ?? '0', 10);
        result[`err:${h}`]    = parseInt(vals[i * 3 + 2] ?? '0', 10);
      }
    } catch { /* non-critical */ }
    return result;
  },

  async getCacheHitRate(_hours = 1): Promise<{ total: number; hits: number; rate: number }> {
    const h = HOUR_KEY();
    try {
      const pipe = redis.pipeline();
      pipe.get(`obs:req:total:${h}`);
      // Sum all cache modes
      for (const mode of ['exact', 'canonical', 'semantic']) {
        for (const tier of ['free', 'premium']) {
          pipe.get(`obs:cache:${tier}:${mode}:${h}`);
        }
      }
      const vals = await pipe.exec() as (string | null)[];
      const total = parseInt(vals[0] ?? '0', 10);
      const hits  = vals.slice(1).reduce((s, v) => s + parseInt(v ?? '0', 10), 0);
      return { total, hits, rate: total > 0 ? hits / total : 0 };
    } catch {
      return { total: 0, hits: 0, rate: 0 };
    }
  },

  async getModelDistribution(): Promise<Record<string, number>> {
    const h = HOUR_KEY();
    const tiers  = ['free', 'premium'];
    const models = ['NANO', 'FAST', 'SMART', 'POWER', 'PEAK'];
    const dist: Record<string, number> = {};
    try {
      const pipe = redis.pipeline();
      for (const tier of tiers) {
        for (const mt of models) {
          for (const prov of ['openrouter', 'groq', 'anthropic', 'together', 'grok']) {
            pipe.get(`obs:req:${tier}:${mt}:${prov}:success:${h}`);
          }
        }
      }
      const vals = await pipe.exec() as (string | null)[];
      let idx = 0;
      for (const _tier of tiers) {
        for (const mt of models) {
          for (const prov of ['openrouter', 'groq', 'anthropic', 'together', 'grok']) {
            const v = parseInt(vals[idx++] ?? '0', 10);
            if (v > 0) dist[`${mt}:${prov}`] = (dist[`${mt}:${prov}`] ?? 0) + v;
          }
        }
      }
    } catch { /* non-critical */ }
    return dist;
  },

  async getLatencyPercentiles(tier = 'all', provider = 'all'): Promise<{
    p50: number; p95: number; p99: number;
  }> {
    // Approximate percentiles from reservoir samples in Redis
    const h = HOUR_KEY();
    const key = `obs:lat:${tier}:${provider}`;
    try {
      const count = await redis.get<string>(`${key}:count:${h}`);
      const n = parseInt(count ?? '0', 10);
      if (!n) return { p50: 0, p95: 0, p99: 0 };

      // Fetch bucket counts and compute approx percentiles
      const pipe = redis.pipeline();
      for (const b of [...LATENCY_BUCKETS, '+Inf']) {
        pipe.get(`${key}:bucket:${b}:${h}`);
      }
      const bVals = await pipe.exec() as (string | null)[];
      const bucketCounts = bVals.map(v => parseInt(v ?? '0', 10));

      const findPercentile = (pct: number): number => {
        const target = Math.ceil(n * pct);
        let cum = 0;
        for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
          cum += bucketCounts[i];
          if (cum >= target) return LATENCY_BUCKETS[i];
        }
        return LATENCY_BUCKETS[LATENCY_BUCKETS.length - 1];
      }

      return { p50: findPercentile(0.5), p95: findPercentile(0.95), p99: findPercentile(0.99) };
    } catch {
      return { p50: 0, p95: 0, p99: 0 };
    }
  },

  /** Prometheus text exposition format */
  async prometheusExposition(): Promise<string> {
    const h      = HOUR_KEY();
    const lines: string[] = [];

    const push = (name: string, labels: string, value: number, help?: string) => {
      if (help) lines.push(`# HELP ${name} ${help}`);
      lines.push(`${name}{${labels}} ${value}`);
    };

    try {
      // ── Requests ──────────────────────────────────────────────────────────
      lines.push('# TYPE vantrix_ai_requests_total counter');
      for (const tier of ['free', 'premium']) {
        for (const result of ['success', 'cache_hit', 'error', 'blocked', 'queued']) {
          const val = parseInt(await redis.get<string>(`obs:req:${tier}:all:all:${result}:${h}`) ?? '0', 10);
          if (val > 0) push('vantrix_ai_requests_total', `tier="${tier}",result="${result}"`, val);
        }
      }

      // ── Tokens ────────────────────────────────────────────────────────────
      lines.push('# TYPE vantrix_ai_tokens_total counter');
      const totalTokens = parseInt(await redis.get<string>(`obs:tokens:total:${h}`) ?? '0', 10);
      push('vantrix_ai_tokens_total', `direction="total"`, totalTokens, 'Total tokens processed this hour');

      // ── Cache hit rate ────────────────────────────────────────────────────
      lines.push('# TYPE vantrix_cache_hit_rate gauge');
      const cr = await this.getCacheHitRate();
      push('vantrix_cache_hit_rate', 'window="1h"', cr.rate, 'Cache hit rate over last hour');
      push('vantrix_cache_hits_total', '', cr.hits);

      // ── Latency ───────────────────────────────────────────────────────────
      lines.push('# TYPE vantrix_ai_latency_ms summary');
      const lat = await this.getLatencyPercentiles();
      push('vantrix_ai_latency_ms', 'quantile="0.5"',  lat.p50, 'AI inference latency percentiles');
      push('vantrix_ai_latency_ms', 'quantile="0.95"', lat.p95);
      push('vantrix_ai_latency_ms', 'quantile="0.99"', lat.p99);

      // ── Circuit breakers ──────────────────────────────────────────────────
      lines.push('# TYPE vantrix_circuit_breaker_state gauge');
      for (const cb of ['openrouter', 'groq', 'anthropic', 'together', 'grok', 'stripe']) {
        const state = parseInt(await redis.get<string>(`obs:cb:${cb}`) ?? '0', 10);
        push('vantrix_circuit_breaker_state', `name="${cb}"`, state, '0=CLOSED 1=HALF_OPEN 2=OPEN');
      }

    } catch (err) {
      lines.push(`# scrape error: ${err}`);
    }

    return lines.join('\n') + '\n';
  },

  /** Compact JSON summary for the admin dashboard */
  async dashboardSummary(): Promise<Record<string, unknown>> {
    const [totals, cache, dist, lat] = await Promise.all([
      this.getHourlyTotals(1),
      this.getCacheHitRate(),
      this.getModelDistribution(),
      this.getLatencyPercentiles(),
    ]);
    const h = HOUR_KEY();
    return {
      hour: h,
      requests:  totals[`req:${h}`]    ?? 0,
      tokens:    totals[`tokens:${h}`] ?? 0,
      errors:    totals[`err:${h}`]    ?? 0,
      cache,
      modelDistribution: dist,
      latency: lat,
    };
  },
};
