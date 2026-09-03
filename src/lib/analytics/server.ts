/**
 * Server-side product analytics — PostHog Node client.
 *
 * Used from anywhere business logic happens server-side, most importantly
 * the payment webhook handlers (src/app/api/payments/stripe/webhook,
 * src/app/api/payments/paystack/verify) — capturing `subscription_activated`
 * at that single choke point means revenue events are never missed by an
 * ad-blocker, a closed tab, or a client that never finishes loading, the
 * way a client-only "purchase complete" event would be.
 *
 * Fail-open by design, same posture as src/lib/flags: analytics must never
 * be able to break a request. A missing API key, a PostHog outage, or a
 * network error all silently no-op instead of throwing — this must never
 * be what turns a successful subscription activation into a 500.
 *
 * Vercel functions freeze/exit as soon as the response is sent, before
 * PostHog's default batched flush (every 10s or 20 events) would fire —
 * without an explicit flush, most server-side events in serverless
 * deployments are silently dropped. captureEvent() awaits a flush on every
 * call rather than relying on the batching interval.
 */
import 'server-only';
import { PostHog } from 'posthog-node';
import { env } from '@/env';
import { bg } from '@/lib/logger';
import type { AnalyticsEventMap, AnalyticsEventName } from './events';

let client: PostHog | null | undefined; // undefined = not yet resolved, null = unavailable

function getClient(): PostHog | null {
  if (client !== undefined) return client;
  client = env.NEXT_PUBLIC_POSTHOG_KEY
    ? new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, { host: env.NEXT_PUBLIC_POSTHOG_HOST })
    : null;
  return client;
}

/**
 * Capture a server-side analytics event. Never throws — call this
 * fire-and-forget-safe from webhook handlers and other business logic
 * without wrapping it in its own try/catch.
 *
 * `distinctId` should be the Supabase user id (same identity used for
 * `posthog.identify()` client-side — see ./client.tsx) so client and
 * server events merge onto one person in PostHog instead of splitting into
 * two disconnected timelines.
 */
export async function captureEvent<E extends AnalyticsEventName>(
  distinctId: string,
  event: E,
  properties: AnalyticsEventMap[E]
): Promise<void> {
  const posthog = getClient();
  if (!posthog) return;

  try {
    posthog.capture({ distinctId, event, properties });
    await posthog.flush();
  } catch (err) {
    bg(`analytics.${event}.capture`)(err);
  }
}

/** Test/ops helper — resets the lazily-created singleton. */
export function __resetAnalyticsClient(): void {
  client = undefined;
}
