/**
 * Next.js Instrumentation Hook
 *
 * This is the correct place to initialise Sentry for server-side and edge
 * runtimes in Next.js 14+. The old sentry.server.config.ts / sentry.edge.config.ts
 * approach is deprecated — this file replaces both.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { init } = await import('@sentry/nextjs');
    init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,
      enabled: process.env.NODE_ENV === 'production',
      release: process.env.NEXT_PUBLIC_APP_VERSION,
      enableLogs: true,
      beforeSend(event, hint) {
        const err = hint.originalException as { statusCode?: number } | null;
        if (err?.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
          if (err.statusCode !== 401 && err.statusCode !== 403) {
            event.level = 'warning';
          }
        }
        return event;
      },
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    const { init } = await import('@sentry/nextjs');
    init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.05,
      enabled: process.env.NODE_ENV === 'production',
      enableLogs: true,
    });
  }
}

// Captures errors from nested React Server Components (layouts, pages, route
// handlers) that Next.js's instrumentation surfaces via this hook rather than
// throwing normally. Without this export, Sentry only sees top-level errors
// and silently misses RSC-boundary failures.
export const onRequestError = Sentry.captureRequestError;
