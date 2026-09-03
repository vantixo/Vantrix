/**
 * Product analytics event catalog.
 *
 * Every event the app captures — client or server side — is registered here
 * with its exact property shape. Nothing calls PostHog with a raw string +
 * untyped object anywhere else in the app; both `capture()` (client, see
 * ./client.tsx) and `captureEvent()` (server, see ./server.ts) are typed
 * against this map, so a typo'd event name or a missing property is a
 * compile error instead of a silently-empty chart in PostHog six months
 * from now. Mirrors the pattern used for src/lib/flags/index.ts's
 * FLAG_REGISTRY, for the same reason: a stringly-typed integration point
 * used across a large app rots invisibly without a shared contract.
 *
 * Naming convention: `noun_past_tense_verb` (e.g. `subscription_activated`,
 * not `activate_subscription` or `subscriptionActivated`) — matches
 * PostHog's own convention and keeps events sortable/groupable by noun in
 * the PostHog UI.
 *
 * Adding a new event: add one entry below, then call capture()/captureEvent()
 * with that key. Keep property values PostHog-safe (string | number |
 * boolean | null — no full user objects, no PII beyond what's already an
 * identified user property, no free-text user input).
 */

export interface AnalyticsEventMap {
  // ── Monetization — the highest-value events, captured server-side at the
  // single choke point each payment provider's webhook funnels through, so
  // these are never missed by a client-side ad-blocker or a closed tab. ──
  subscription_activated: {
    tier: string;
    provider: 'stripe' | 'paystack' | 'paddle';
    billing_interval: 'monthly' | 'quarterly' | 'annual';
    amount: number;
    currency: string;
    is_trial: boolean;
    is_renewal: boolean;
  };
  checkout_started: {
    tier: string;
    provider: 'stripe' | 'paystack' | 'nowpayments' | 'paddle';
    billing_interval: 'monthly' | 'quarterly' | 'annual';
    surface: string; // where the checkout button lives, e.g. 'pricing_page', 'in_chat_paywall'
  };

  // ── Funnel entry points ──
  paywall_viewed: {
    surface: string; // 'pricing_page', 'premium_page', 'in_chat_paywall', 'video_gate', etc.
    current_tier: string;
    billing_interval?: 'monthly' | 'quarterly' | 'annual';
  };
  signup_completed: {
    method: 'email' | 'google' | 'guest_claim';
  };

  // ── Core engagement ──
  character_chat_started: {
    character_id: string;
    is_first_message: boolean;
  };

  // ── Account security ──
  mfa_enrolled: {
    factor_type: 'totp';
    /** How many verified factors the account has right after this one, including this one. */
    total_factors: number;
  };
  mfa_disabled: {
    factor_type: 'totp';
    /** How many verified factors remain on the account after this removal. */
    remaining_factors: number;
  };
}

export type AnalyticsEventName = keyof AnalyticsEventMap;
