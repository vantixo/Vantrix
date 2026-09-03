/**
 * Distributed Tracing & Forensic Event Tracking
 *
 * Changes in this revision:
 *
 *   TTL extended to 96h: post-incident review typically begins 24–72 hours
 *   after an event. The previous 24h TTL meant traces expired before most
 *   investigations started. 96h (4 days) covers the realistic investigation
 *   window while keeping Redis memory bounded.
 *
 *   Lightweight standalone event helpers: emitRateLimitEvent() and
 *   emitAuthFailureEvent() write directly to Redis without requiring a full
 *   Tracer context. Rate-limit 429s and auth 401s occur before
 *   orchestrator.prepare() initialises the tracer — these helpers make
 *   those events visible to the observability layer without changing the
 *   request hot path.
 *
 *   Circuit breaker lineage: spans now accept circuitState attributes so
 *   the full infrastructure failure context is preserved in the trace record.
 */

import { logger } from '@/lib/logger';
import { redis }              from '@/lib/redis';

const TRACE_TTL = 345_600; // 96 hours (was 24h — extended for incident review window)
const EVENT_TTL =  86_400; // 24h for lightweight events (rate-limit, auth)

export interface TraceSpan {
  spanId:    string;
  traceId:   string;
  name:      string;
  startedAt: number;
  endedAt?:  number;
  durationMs?: number;
  attributes: Record<string, unknown>;
  status?:   'ok' | 'error';
  error?:    string;
}

export interface TraceEvent {
  traceId:  string;
  name:     string;
  ts:       number;
  data:     Record<string, unknown>;
}

export interface Tracer {
  traceId:    string;
  startSpan:  (name: string, attrs?: Record<string, unknown>) => ActiveSpan;
  event:      (name: string, data?: Record<string, unknown>) => void;
  flush:      () => Promise<void>;
}

export interface ActiveSpan {
  end:   (attrs?: Record<string, unknown>) => TraceSpan;
  error: (err: unknown, extra?: Record<string, unknown>) => TraceSpan;
}

export function createTracer(traceId: string, context?: Record<string, unknown>): Tracer {
  const spans:  TraceSpan[]  = [];
  const events: TraceEvent[] = [];

  if (context) {
    events.push({ traceId, name: 'trace.start', ts: Date.now(), data: context });
  }

  function startSpan(name: string, attrs: Record<string, unknown> = {}): ActiveSpan {
    const spanId    = crypto.randomUUID().slice(0, 8);
    const startedAt = Date.now();
    const span: TraceSpan = { spanId, traceId, name, startedAt, attributes: attrs };

    const end = (endAttrs: Record<string, unknown> = {}): TraceSpan => {
      span.endedAt    = Date.now();
      span.durationMs = span.endedAt - startedAt;
      span.status     = 'ok';
      Object.assign(span.attributes, endAttrs);
      spans.push(span);
      return span;
    };

    /**
     * Record an error on this span.
     * @param err    The thrown error
     * @param extra  Optional extra attributes (e.g. circuit breaker state,
     *               failure count, service name) for infrastructure lineage.
     */
    const error = (err: unknown, extra?: Record<string, unknown>): TraceSpan => {
      span.endedAt    = Date.now();
      span.durationMs = span.endedAt - startedAt;
      span.status     = 'error';
      span.error      = err instanceof Error ? err.message : String(err);
      if (extra) Object.assign(span.attributes, extra);
      spans.push(span);
      return span;
    };

    return { end, error };
  }

  function event(name: string, data: Record<string, unknown> = {}): void {
    events.push({ traceId, name, ts: Date.now(), data });
  }

  async function flush(): Promise<void> {
    if (spans.length === 0 && events.length === 0) return;
    try {
      const key  = `vantrix:trace:${traceId}`;
      const pipe = redis.pipeline();
      for (const span of spans) {
        pipe.zadd(key, { score: span.startedAt, member: JSON.stringify({ type: 'span', ...span }) });
      }
      for (const ev of events) {
        pipe.zadd(key, { score: ev.ts, member: JSON.stringify({ type: 'event', ...ev }) });
      }
      pipe.expire(key, TRACE_TTL);
      await pipe.exec();
    } catch (err) {
      logger.error('Tracing flush error', { traceId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { traceId, startSpan, event, flush };
}

export async function getTrace(traceId: string): Promise<Array<{ type: string; [k: string]: unknown }>> {
  try {
    const key     = `vantrix:trace:${traceId}`;
    const members = await redis.zrange(key, 0, -1);
    return members.map(m => JSON.parse(m as string));
  } catch { return []; }
}

/**
 * Emit a lightweight rate-limit rejection event without a full tracer context.
 *
 * Rate-limited 429s are returned before orchestrator.prepare() initialises
 * the tracer, making them invisible to the trace store. This helper writes
 * directly to a separate Redis sorted set so abuse patterns (DDoS, misconfigured
 * clients, free-tier hammering) are detectable.
 */
export async function emitRateLimitEvent(params: {
  traceId:  string;
  userId:   string;
  tier:     string;
  route:    string;
  ip?:      string | undefined;
}): Promise<void> {
  try {
    const key  = `vantrix:events:rate-limit:${new Date().toISOString().slice(0, 10)}`;
    const pipe = redis.pipeline();
    pipe.zadd(key, { score: Date.now(), member: JSON.stringify({ ...params, ts: Date.now() }) });
    pipe.expire(key, EVENT_TTL);
    await pipe.exec();
  } catch { /* non-critical */ }
}

/**
 * Emit a lightweight auth failure event without a full tracer context.
 * Auth failures (401) occur before orchestrator.prepare(), so they are
 * structurally outside the normal trace envelope.
 */
export async function emitAuthFailureEvent(params: {
  traceId: string;
  reason:  string;
  route:   string;
  ip?:     string | undefined;
}): Promise<void> {
  try {
    const key  = `vantrix:events:auth-failure:${new Date().toISOString().slice(0, 10)}`;
    const pipe = redis.pipeline();
    pipe.zadd(key, { score: Date.now(), member: JSON.stringify({ ...params, ts: Date.now() }) });
    pipe.expire(key, EVENT_TTL);
    await pipe.exec();
  } catch { /* non-critical */ }
}

export async function recordAiCostEvent(params: {
  traceId:     string;
  userId:      string;
  tier:        string;
  model:       string;
  promptTokens:     number;
  completionTokens: number;
  totalTokens:      number;
  latencyMs:        number;
  characterId?:     string;
}): Promise<void> {
  const key = `vantrix:ai:cost:${params.userId}:${new Date().toISOString().slice(0, 10)}`;
  try {
    const pipe = redis.pipeline();
    pipe.zadd(key, { score: Date.now(), member: JSON.stringify({ ...params, ts: Date.now() }) });
    pipe.expire(key, 7 * 86_400);
    await pipe.exec();
  } catch { /* non-critical */ }
}

export async function getUserDailyCostEvents(userId: string, date?: string): Promise<unknown[]> {
  const day = date ?? new Date().toISOString().slice(0, 10);
  const key = `vantrix:ai:cost:${userId}:${day}`;
  try {
    const members = await redis.zrange(key, 0, -1);
    return members.map(m => JSON.parse(m as string));
  } catch { return []; }
}

// ── OBS-1: Lightweight dating event tracing ──────────────────────────────
// Emits a structured event to Redis for dating API operations (swipe, gifts,
// mood, milestones) so user complaints can be correlated to specific API calls.

export interface DatingEventParams {
  userId:    string;
  matchId?:  string;
  operation: 'swipe' | 'gift_sent' | 'mood_updated' | 'milestone_triggered' | 'match_created';
  outcome:   'success' | 'failed' | 'partial';
  meta?:     Record<string, unknown>;
}

export async function emitDatingEvent(params: DatingEventParams): Promise<void> {
  const key = `vantrix:dating:events:${params.userId}`;
  try {
    const pipe = redis.pipeline();
    pipe.zadd(key, {
      score:  Date.now(),
      member: JSON.stringify({ ...params, ts: Date.now() }),
    });
    pipe.expire(key, 7 * 86_400); // 7-day retention
    await pipe.exec();
  } catch { /* non-critical — events must never break the hot path */ }
}
