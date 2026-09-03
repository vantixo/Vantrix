// src/lib/logger.edge.ts
// ─────────────────────────────────────────────────────────────────────────────
// Same shape as `logger` (debug/info/warn/error) but with no `async_hooks`
// dependency — Edge runtime doesn't reliably support it. Use this from
// middleware.ts and any route with `export const runtime = 'edge'`, instead
// of the Node logger in logger.ts. No request-context propagation (no
// AsyncLocalStorage), otherwise identical structured-JSON output.
// ─────────────────────────────────────────────────────────────────────────────

import { buildLogEntry, type Meta } from './logger-core';

export const edgeLogger = {
  debug(message: string, meta?: Meta) { console.debug(buildLogEntry('debug', message, meta)); },
  info(message: string, meta?: Meta) { console.log(buildLogEntry('info', message, meta)); },
  warn(message: string, meta?: Meta) { console.warn(buildLogEntry('warn', message, meta)); },
  error(message: string, meta?: Meta) { console.error(buildLogEntry('error', message, meta)); },
};
