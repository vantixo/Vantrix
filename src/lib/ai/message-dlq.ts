/**
 * Message Dead Letter Queue — Vantrix Production
 *
 * Phase 1 (message durability) fix. The assistant-reply insert in
 * chat/stream/route.ts already retries transient failures and falls back to
 * supabaseAdmin (bypassing RLS) before giving up. If BOTH of those fail —
 * a real outage, not a blip — the reply must not just be logged and
 * forgotten: the user paid tokens for a reply that would otherwise vanish
 * from their conversation with no trace.
 *
 * This is deliberately a separate queue from billing-dlq.ts (vantrix:billing:dlq).
 * Billing entries are numeric token deltas; these are full message rows with
 * PII-bearing content. Mixing them into one queue would mean the billing
 * recovery cron either mishandles message payloads or the message payloads
 * silently ride along unbilled — both wrong. Same retry-with-idempotency
 * shape as billing-dlq.ts, applied to a distinct key.
 */

import { redis }  from '@/lib/redis';
import { logger } from '@/lib/logger';

const DLQ_KEY      = 'vantrix:messages:dlq';
const DLQ_TTL       = 60 * 60 * 24 * 7; // 7-day TTL, matches billing-dlq
const MAX_ATTEMPTS  = 10;

export interface QueuedMessage {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  traceId: string;
  attempts: number;
  queuedAt: string;
}

export async function enqueueMessageRecovery(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  traceId: string,
): Promise<void> {
  const item: QueuedMessage = {
    conversationId, role, content, traceId, attempts: 0, queuedAt: new Date().toISOString(),
  };
  await redis.lpush(DLQ_KEY, JSON.stringify(item));
  await redis.expire(DLQ_KEY, DLQ_TTL);
  logger.error('message-dlq:enqueued', { conversationId, role, traceId });
}

/**
 * Pops and retries every item currently in the queue. Mirrors
 * runBillingRecovery's structure: items that still fail go back on the
 * queue (up to MAX_ATTEMPTS) rather than being dropped, and items that
 * exceed MAX_ATTEMPTS are logged for human review instead of retried
 * forever.
 */
export async function runMessageRecovery(): Promise<{ recovered: number; abandoned: number; stillPending: number }> {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');

  let recovered = 0;
  let abandoned = 0;

  // Drain the whole list as it existed at call time; anything enqueued
  // mid-run is picked up on the next cron tick rather than looped forever.
  const length = await redis.llen(DLQ_KEY);
  for (let i = 0; i < length; i++) {
    const raw = await redis.rpop<string>(DLQ_KEY);
    if (!raw) break;

    const item: QueuedMessage = typeof raw === 'string' ? JSON.parse(raw) : raw;
    try {
      const { error } = await supabaseAdmin.from('messages').insert({
        conversation_id: item.conversationId, role: item.role, content: item.content,
      });
      if (error) throw new Error(error.message);
      recovered++;
    } catch (err) {
      item.attempts++;
      if (item.attempts >= MAX_ATTEMPTS) {
        abandoned++;
        logger.error('message-dlq:abandoned', {
          conversationId: item.conversationId, role: item.role, traceId: item.traceId,
          attempts: item.attempts, error: err instanceof Error ? err.message : String(err),
        });
      } else {
        await redis.lpush(DLQ_KEY, JSON.stringify(item));
      }
    }
  }

  const stillPending = await redis.llen(DLQ_KEY);
  return { recovered, abandoned, stillPending };
}
