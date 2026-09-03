// src/lib/payments/webhook-claim.ts
//
// Atomic idempotency claim for payment-provider webhooks, shared by
// Stripe/Paystack/NOWPayments.
//
// The pattern this replaces — SELECT processed_webhooks for an existing
// row, and only INSERT once business logic has finished — only protects
// against *sequential* duplicate deliveries. Two concurrent deliveries of
// the same event (a real thing: providers retry on slow responses, and
// Paystack's GET verify-redirect and POST webhook can race each other for
// the same reference) can both pass the SELECT before either has
// inserted, both run the business logic (e.g. both credit tokens), and
// only then collide on the INSERT's unique constraint — by which point
// the double-credit has already happened.
//
// INSERT ... ON CONFLICT DO NOTHING is atomic at the database level: of
// any concurrent deliveries, exactly one insert succeeds and claims the
// event before any business logic runs; everyone else sees no row
// returned and exits immediately as a duplicate.
//
// If processing then throws, call release() to delete the claim so a
// legitimate provider retry can re-claim and reprocess the event, instead
// of being silently swallowed forever as a "duplicate" of a delivery that
// never actually completed.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

export type WebhookProvider = 'stripe' | 'paystack' | 'nowpayments' | 'fal_lora' | 'paddle';

export interface WebhookClaimResult {
  /** True iff this call won the race and should proceed with processing. */
  claimed: boolean;
  /** Non-null only on an unexpected DB error (not a normal duplicate). */
  error?: string;
}

/**
 * Attempt to atomically claim a webhook event id. Returns claimed: true
 * only for the single request that should actually process this event.
 */
export async function claimWebhookEvent(
  id: string,
  provider: WebhookProvider,
): Promise<WebhookClaimResult> {
  const { data, error } = await supabaseAdmin
    .from('processed_webhooks')
    .insert({ id, provider })
    .select('id')
    .maybeSingle();

  if (error) {
    // Postgres unique_violation — someone else already claimed this event
    // between our check and insert (or just plain already claimed it).
    // That's a normal duplicate, not a failure.
    if (error.code === '23505') {
      return { claimed: false };
    }
    logger.error('webhook-claim.insert_failed', { id, provider, error: error.message });
    return { claimed: false, error: error.message };
  }

  return { claimed: !!data };
}

/**
 * Release a previously-successful claim after processing failed, so a
 * legitimate retry from the provider can re-claim and reprocess the event.
 * Never throws — a failure here just means the row lingers until the
 * 90-day processed_webhooks cleanup job removes it, which only risks a
 * missed retry, not a double-processed event.
 */
export async function releaseWebhookEvent(id: string): Promise<void> {
  try {
    await supabaseAdmin.from('processed_webhooks').delete().eq('id', id);
  } catch (err: unknown) {
    logger.error('webhook-claim.release_failed', {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
