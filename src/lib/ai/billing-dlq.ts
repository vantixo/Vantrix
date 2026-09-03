/**
 * Billing Dead Letter Queue — Vantrix Production
 *
 * If recordTokensUsed exhausts all retries, tokens must NOT be lost silently.
 * This creates a durability guarantee: every token spent is eventually billed.
 *
 * Architecture:
 *   - Failed billing writes pushed to Redis list vantrix:billing:dlq
 *   - DLQ has 7-day TTL
 *   - /api/cron/billing-recovery runs every 5 minutes and pops/retries
 *   - After MAX_ATTEMPTS, item is abandoned and logged for human review
 *
 * Idempotency guard (added):
 *   recordTokensUsed does Redis INCRBY. If the original call succeeded but the
 *   caller threw before it could mark success (e.g., pipeline.exec() threw on
 *   the EXPIRE step after the INCRBY landed), the DLQ would retry and INCRBY
 *   again — double-billing the user's daily token counter.
 *
 *   Fix: before retrying, we check a traceId-keyed Redis set. If the traceId
 *   is already present (meaning a previous attempt's INCRBY landed), we skip
 *   the retry. The "billed" set key expires at midnight UTC alongside the
 *   token counter key, so there is no stale data.
 *
 *   Note: this makes the billing idempotent within a calendar day. Across-day
 *   retries (DLQ items older than 24h) are safe because the token counter key
 *   expires at midnight and a new day's counter starts at 0 anyway.
 */

import { redis }             from '@/lib/redis';
import { recordTokensUsed }  from '@/lib/ai/spending-cap';
import { logger }            from '@/lib/logger';

const DLQ_KEY    = 'vantrix:billing:dlq';
const DLQ_TTL    = 60 * 60 * 24 * 7; // 7-day TTL
const MAX_ATTEMPTS = 10;

/** Redis key that marks a traceId as already billed.
 *
 * H-05 FIX: previously keyed to YYYY-MM-DD, so a DLQ item queued on Day 1
 * but retried on Day 2 (after a 24h+ Redis outage or heavy backlog) would
 * compute a different key, the guard would return false, and INCRBY would
 * fire against the wrong day's token counter — clawing back quota up to 7
 * days later. Key is now scoped to traceId alone; expiry makes it self-clean.
 */
function billedKey(traceId: string): string {
  return `vantrix:billing:billed:${traceId}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BillingDLQItem {
  userId:       string;
  tokens:       number;
  traceId:      string;
  failedAt:     number;
  attemptCount: number;
}

// ── Enqueue ───────────────────────────────────────────────────────────────────

export async function enqueueBillingRetry(
  userId:  string,
  tokens:  number,
  traceId: string,
): Promise<void> {
  try {
    const item: BillingDLQItem = {
      userId, tokens, traceId,
      failedAt:     Date.now(),
      attemptCount: 0,
    };

    const pipeline = redis.pipeline();
    pipeline.lpush(DLQ_KEY, JSON.stringify(item));
    pipeline.expire(DLQ_KEY, DLQ_TTL);
    await pipeline.exec();

    logger.warn('billing-dlq:enqueued', { userId, tokens, traceId });
  } catch (err) {
    logger.error('billing-dlq: CRITICAL enqueue failed', {
      userId, tokens, traceId, error: String(err),
    });
  }
}

/**
 * Mark a billing write as successfully landed.
 * Call this after a successful recordTokensUsed() so the DLQ can skip
 * retrying the same traceId if the caller throws after the write.
 *
 * Usage: call immediately after await recordTokensUsed(...) before any
 * other logic that might throw.
 */
export async function markBillingLanded(traceId: string): Promise<void> {
  try {
    // H-05 FIX: was `secondsUntilMidnightUTC()` — a midnight-aligned expiry
    // that effectively self-expired at midnight, which was the root cause of
    // the cross-day idempotency failure. Now a flat 48h window: comfortably
    // covers same-day and next-day retry windows without keeping records
    // around indefinitely. The key is trace-scoped (not date-scoped) so
    // it's correct regardless of when the retry happens.
    await redis.set(billedKey(traceId), '1', { ex: 60 * 60 * 48 }); // 48 h
  } catch {
    // Non-critical: if this fails, the DLQ will retry conservatively
    // (the worst case is a duplicated INCRBY, not a lost billing record)
  }
}

/**
 * Check whether a traceId has already been successfully billed.
 * Used by DLQ recovery to skip re-processing.
 */
async function isAlreadyBilled(traceId: string): Promise<boolean> {
  try {
    const v = await redis.get(billedKey(traceId));
    return v !== null;
  } catch {
    // Redis down — assume not billed (conservative: retry rather than skip)
    return false;
  }
}

// ── Recovery ──────────────────────────────────────────────────────────────────

export async function runBillingRecovery(): Promise<{
  recovered: number;
  skipped:   number;
  failed:    number;
  abandoned: number;
}> {
  let recovered = 0;
  let skipped   = 0;
  let failed    = 0;
  let abandoned = 0;

  const MAX_ITEMS = 50;

  for (let i = 0; i < MAX_ITEMS; i++) {
    const raw = await redis.rpop<string>(DLQ_KEY);
    if (!raw) break;

    let item: BillingDLQItem;
    try {
      item = JSON.parse(raw) as BillingDLQItem;
    } catch (parseErr) {
      logger.warn('billing-dlq:malformed-item', { error: String(parseErr), raw });
      abandoned++;
      continue;
    }

    if (item.attemptCount >= MAX_ATTEMPTS) {
      logger.error('billing-dlq:abandoned', {
        userId: item.userId, tokens: item.tokens,
        traceId: item.traceId, attemptCount: item.attemptCount,
      });
      abandoned++;
      continue;
    }

    // ── Idempotency guard ──────────────────────────────────────────────────────
    // If the original recordTokensUsed() succeeded before its caller threw,
    // the traceId is already in the billed set. Skip re-processing to prevent
    // a duplicate INCRBY on the user's daily token counter.
    const alreadyBilled = await isAlreadyBilled(item.traceId);
    if (alreadyBilled) {
      logger.info('billing-dlq:skipped-already-billed', {
        userId:  item.userId,
        tokens:  item.tokens,
        traceId: item.traceId,
      });
      skipped++;
      continue;
    }

    try {
      await recordTokensUsed(item.userId, item.tokens);
      // Mark as landed so any further DLQ retries of this traceId are skipped
      await markBillingLanded(item.traceId);

      logger.info('billing-dlq:recovered', {
        userId: item.userId, tokens: item.tokens,
        traceId: item.traceId, attemptCount: item.attemptCount,
      });
      recovered++;
    } catch (err) {
      item.attemptCount++;
      const pipeline = redis.pipeline();
      pipeline.lpush(DLQ_KEY, JSON.stringify(item));
      pipeline.expire(DLQ_KEY, DLQ_TTL);
      const requeued = await pipeline.exec().then(() => true).catch(requeueErr => {
        // GAP-FIX: previously bare. If THIS write fails, the item isn't
        // "queued for another retry attempt" — it's gone. It was already
        // popped off the queue by the caller before this function ran, so a
        // failed re-push here is the actual point of permanent loss, not
        // the original recordTokensUsed failure below.
        logger.error('billing-dlq:requeue-failed — item permanently lost, not just delayed', {
          userId: item.userId, tokens: item.tokens, traceId: item.traceId,
          attemptCount: item.attemptCount, error: String(requeueErr),
        });
        return false;
      });

      logger.warn('billing-dlq:retry-failed', {
        userId: item.userId, attemptCount: item.attemptCount, error: String(err), requeued,
      });
      failed++;
    }
  }

  logger.info('billing-dlq:run-complete', { recovered, skipped, failed, abandoned });
  return { recovered, skipped, failed, abandoned };
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function getBillingDLQDepth(): Promise<number> {
  try {
    return await redis.llen(DLQ_KEY);
  } catch (err) {
    logger.warn('billing-dlq:llen-failed', { error: String(err) });
    return -1;
  }
}
