// src/lib/logger-core.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared, environment-agnostic pieces of the logging pipeline — no
// `async_hooks`, no Node-only APIs. Safe to import from Node route handlers,
// the Edge runtime (middleware, edge routes), and the browser bundle alike.
// The three environment-specific loggers (logger.ts, logger.edge.ts,
// logger.client.ts) all build their entries from this.
// ─────────────────────────────────────────────────────────────────────────────

export type Meta = Record<string, unknown>;

const REDACT_KEYS = new Set([
  'password', 'passwordhash', 'token', 'accesstoken', 'refreshtoken',
  'secret', 'apikey', 'api_key', 'authorization', 'cardnumber',
  'cvv', 'pin', 'ssn', 'stripe_secret', 'webhook_secret',
  // Additional real-world variant spellings — deliberately still exact-match,
  // not substring match: a substring match on e.g. "token" would also catch
  // tokenCost/tokensUsed/tokenCredit, which are legitimate in-app currency
  // amounts logged extensively elsewhere in this codebase for debugging
  // billing/usage issues, not secrets. Widening the set instead of the
  // matching strategy closes the gap for likely real variants without that
  // collateral damage.
  'sessiontoken', 'bearertoken', 'idtoken', 'jwt', 'authtoken',
  'clientsecret', 'apisecret', 'privatekey', 'private_key',
  'sessionsecret', 'session_secret', 'cookiesecret', 'cookie_secret',
  'dob', 'dateofbirth', 'date_of_birth', 'creditcard', 'credit_card',
]);

export function redact(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v);
  }
  return result;
}

export function buildLogEntry(
  level: string,
  message: string,
  meta?: Meta,
  extra?: Record<string, unknown>,
): string {
  return JSON.stringify({
    level,
    message,
    ts: new Date().toISOString(),
    ...extra,
    ...(meta && (redact(meta) as object)),
  });
}
