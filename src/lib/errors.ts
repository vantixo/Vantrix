/**
 * Typed error hierarchy — ported from v20 backend.
 * Gives every error a statusCode, machine-readable code, and optional detail payload.
 * Use these instead of plain Error or string throws throughout the codebase.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly code       = 'INTERNAL_ERROR',
    public readonly details: unknown = null,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError    extends AppError { constructor(m: string, d?: unknown) { super(m, 400, 'VALIDATION_ERROR', d); } }
export class UnauthorizedError  extends AppError { constructor(m = 'Unauthorized')      { super(m, 401, 'UNAUTHORIZED'); } }
export class ForbiddenError     extends AppError { constructor(m = 'Forbidden', c = 'FORBIDDEN') { super(m, 403, c); } }
export class PlanGateError      extends ForbiddenError { constructor(feature: string, plan: string) { super(`${feature} requires ${plan} plan or higher`, 'PLAN_GATED'); } }
export class NotFoundError      extends AppError { constructor(r = 'Resource') { super(`${r} not found`, 404, 'NOT_FOUND'); } }
export class RateLimitError     extends AppError { constructor(m = 'Too many requests', public readonly retryAfter = 60) { super(m, 429, 'RATE_LIMIT_EXCEEDED'); } }
export class ContentBlockedError extends AppError { constructor(m = 'Content blocked by policy') { super(m, 422, 'CONTENT_BLOCKED'); } }
export class InsufficientTokensError extends AppError {
  constructor(required: number, current: number) {
    super(`Insufficient Vantrix Coin: need ${required}, have ${current}`, 402, 'INSUFFICIENT_TOKENS', { required, current });
  }
}
export class AiLimitError extends AppError {
  constructor(used: number, limit: number, resetAt: string) {
    super('Daily AI usage limit reached. Upgrade or wait until tomorrow.', 429, 'AI_LIMIT_EXCEEDED', { used, limit, resetAt });
  }
}
export class CircuitOpenError extends AppError {
  constructor(service: string, retryInSec: number) {
    super(`${service} is temporarily unavailable. Retry in ${retryInSec}s.`, 503, 'CIRCUIT_OPEN', { service, retryInSec });
  }
}
export class ExternalServiceError extends AppError {
  constructor(service: string, m?: string) { super(m ?? `${service} unavailable`, 502, 'EXTERNAL_SERVICE_ERROR'); }
}

/** Serialize any error to a { error, code, details? } response body */
export function toErrorBody(err: unknown): { error: string; code: string; details?: unknown } {
  if (err instanceof AppError) {
    return { error: err.message, code: err.code, ...(err.details != null && { details: err.details }) };
  }
  return { error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' };
}

/**
 * Fields for server-side `logger.error()` calls — NOT for the HTTP response.
 *
 * FIX: dozens of route handlers followed the pattern
 * `logger.error(label, toErrorBody(err))`, reusing the *client-facing*
 * sanitized body for the server log too. toErrorBody() deliberately
 * collapses any non-AppError into the generic "An unexpected error
 * occurred" / INTERNAL_ERROR pair (so the client never sees a raw
 * message/stack) — but that means the real cause never reached the
 * server log either, for every route on this pattern (Stripe/Paddle
 * checkout, character generation, uploads, digital-twin, and more).
 * Every one of those failures was undebuggable from server output alone.
 *
 * Use this for the log line, and keep toErrorBody(err) for the
 * NextResponse.json(...) the client receives — the two now genuinely
 * diverge: raw detail server-side, sanitized message client-side.
 */
export function errorLogFields(err: unknown): Record<string, unknown> {
  if (err instanceof AppError) {
    return { error: err.message, code: err.code, ...(err.details != null && { details: err.details }) };
  }
  if (err instanceof Error) {
    return { error: err.message, name: err.name, stack: err.stack };
  }
  return { error: String(err) };
}
