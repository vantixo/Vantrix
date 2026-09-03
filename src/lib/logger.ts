/**
 * Structured logger — upgraded to v20's request-context-aware design.
 *
 * Improvements over v1:
 *   - AsyncLocalStorage for automatic request ID + user ID propagation
 *   - Deep recursive redaction (catches nested sensitive keys)
 *   - Performance tracking with slow-operation warnings
 *   - External API call logging with duration + success flag
 *   - All log entries carry `ts`, `level`, optional `requestId` / `userId`
 */
import { AsyncLocalStorage } from 'async_hooks';
import { buildLogEntry, redact, type Meta } from './logger-core';

export interface RequestContext {
  requestId: string;
  userId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

function buildEntry(level: string, message: string, meta?: Meta): string {
  const ctx = requestContext.getStore();
  return buildLogEntry(level, message, meta, {
    ...(ctx?.requestId && { requestId: ctx.requestId }),
    ...(ctx?.userId && { userId: ctx.userId }),
  });
}

/**
 * GAP-FIX (Phase A, 2026-08-06): logger.error() previously only reached
 * console output. Every webhook/cron/worker failure that was caught and
 * logged (as opposed to thrown) was therefore invisible to Sentry — the
 * only exceptions were the ~3 places in the codebase that called Sentry
 * directly. Decision: forward console-only errors too, but sampled (not
 * every error() call is actionable — many are expected/handled failure
 * paths already recovering gracefully) to avoid alert fatigue. Rate is
 * configurable via SENTRY_ERROR_LOG_SAMPLE_RATE (default 10%). Follows
 * the same fire-and-forget, self-contained-catch shape already
 * established in redis/hardened-client.ts: a failing Sentry call must
 * never be what breaks the caller, and must not recurse back through
 * logger.error (hence the plain console.error in the inner catch).
 */
const SENTRY_ERROR_LOG_SAMPLE_RATE = Number(process.env.SENTRY_ERROR_LOG_SAMPLE_RATE ?? '0.1');

function reportErrorToSentry(message: string, meta?: Meta): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (!(Math.random() < SENTRY_ERROR_LOG_SAMPLE_RATE)) return;
  const ctx = requestContext.getStore();
  import('@sentry/nextjs')
    .then(Sentry =>
      Sentry.withScope(scope => {
        if (ctx?.requestId) scope.setTag('requestId', ctx.requestId);
        if (ctx?.userId) scope.setUser({ id: ctx.userId });
        if (meta) scope.setExtras(redact(meta) as Record<string, unknown>);
        scope.setLevel('error');
        Sentry.captureMessage(message);
      })
    )
    .catch(err =>
      console.error(
        buildLogEntry('error', 'logger: Sentry forward failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      )
    );
}

export const logger = {
  debug(message: string, meta?: Meta)  { if (process.env.LOG_LEVEL === 'debug') console.debug(buildEntry('debug', message, meta)); },
  info (message: string, meta?: Meta)  { console.log  (buildEntry('info',  message, meta)); },
  warn (message: string, meta?: Meta)  { console.warn (buildEntry('warn',  message, meta)); },
  error(message: string, meta?: Meta)  { console.error(buildEntry('error', message, meta)); reportErrorToSentry(message, meta); },

  /** Track an operation — logs duration and warns if > 3s */
  track(operation: string): { finish(meta?: Meta): void } {
    const start = Date.now();
    return {
      finish(meta?: Meta) {
        const ms = Date.now() - start;
        const fn = ms > 3_000 ? 'warn' : 'info';
        logger[fn](`perf:${operation}`, { duration_ms: ms, ...meta });
      },
    };
  },

  /** Log an external API call */
  external(service: string, operation: string, ms: number, ok: boolean, err?: unknown) {
    const fn = ok ? 'info' : 'error';
    logger[fn](`external:${service}.${operation}`, {
      service, operation, duration_ms: ms, success: ok,
      ...(err ? { error: err instanceof Error ? err.message : String(err) } : {}),
    });
  },
};

/**
 * GAP-FIX (codebase-wide audit, 2026-07-10): for a fire-and-forget background
 * write (memory updates, XP, streaks, analytics events, best-effort refunds,
 * etc.) that must never block or fail the user-facing response, the correct
 * shape is `somethingAsync(...).catch(bg('label'))` — NOT `.catch(() => {})`.
 * The bare empty-arrow version was used ~100 times across the codebase and
 * meant every one of those operations could silently fail forever with zero
 * trace: no log line, no Sentry event, nothing. That's not "fire and forget
 * by design," it's an unmonitored failure mode wearing the same syntax.
 * `bg()` keeps the exact same non-blocking, non-throwing behavior — it only
 * adds a log line on failure so a systemically-broken background write
 * (e.g. a schema drift silently breaking updateMemory() for every message)
 * shows up in logs instead of manifesting only as "the AI has no memory"
 * three weeks later with no error trail to explain why.
 */
export const bg = (label: string) => (err: unknown) => {
  logger.error(`bg.${label}.failed`, { error: err instanceof Error ? err.message : String(err) });
};
