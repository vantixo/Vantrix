// src/lib/logger.client.ts
// ─────────────────────────────────────────────────────────────────────────────
// Same shape as `logger` (debug/info/warn/error) for use in "use client"
// components and browser-only modules (e.g. lib/pwa/clear-caches.ts). Never
// import the Node logger (logger.ts) from client code — it pulls in
// `async_hooks`, which doesn't exist in the browser bundle and will break
// the build. This is the client-side counterpart, sharing the same
// redaction rules and JSON shape so client and server logs stay consistent
// wherever they end up (browser devtools console, or a future beacon
// endpoint that ships client logs to the server).
// ─────────────────────────────────────────────────────────────────────────────

import { buildLogEntry, type Meta } from './logger-core';

export const clientLogger = {
  debug(message: string, meta?: Meta) { console.debug(buildLogEntry('debug', message, meta)); },
  info(message: string, meta?: Meta) { console.log(buildLogEntry('info', message, meta)); },
  warn(message: string, meta?: Meta) { console.warn(buildLogEntry('warn', message, meta)); },
  error(message: string, meta?: Meta) { console.error(buildLogEntry('error', message, meta)); },
};
