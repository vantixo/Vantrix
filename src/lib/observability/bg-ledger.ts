/**
 * Background task ledger — batched visibility for fire-and-forget calls.
 *
 * The existing `bg(label)` helper (src/lib/logger.ts) turns a bare
 * `.catch(() => {})` into `.catch(bg('label'))`, so a failing background
 * write at least produces a log line instead of vanishing silently. That's
 * necessary but not sufficient: log lines aren't queryable, so there's no
 * way to answer "which background tasks are failing, and how often" without
 * grepping raw output across every instance.
 *
 * BgLedgerGroup closes that gap for a batch of fire-and-forget calls that
 * all originate from one logical unit of work (e.g. one queued chat job's
 * W3 post-job enrichment). Usage:
 *
 *   const group = new BgLedgerGroup();
 *   group.track('applyPsychologyEvent.baseline', applyPsychologyEvent(...));
 *   group.track('updateMemory', updateMemory(...));
 *   // ... more track() calls ...
 *   await group.flush({ userId });
 *
 * Each tracked promise still behaves exactly like `.catch(bg(label))` —
 * failures are logged immediately and never rejected back to the caller.
 * flush() additionally waits for every tracked task to settle and persists
 * all of their outcomes in a SINGLE upsert RPC call (record_bg_task_outcomes,
 * see the 20261022 migration), rather than one round trip per task. Do not
 * call flush() until every track() call for the group has been made.
 *
 * Scope note: only the queue worker's W3 block is wired to this today. The
 * sync chat route (chat/stream/route.ts) has a structurally identical but
 * much larger (30+) set of fire-and-forget calls; wiring those through this
 * same primitive is a follow-up, not bundled here, to keep this change to a
 * single reviewable surface.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export interface BgTaskOutcome {
  label: string;
  success: boolean;
  error?: string;
}

export class BgLedgerGroup {
  private pending: Promise<BgTaskOutcome>[] = [];

  /**
   * Fire off `promise` immediately (fire-and-forget, same as the caller
   * doing it directly) and record its eventual outcome for the next
   * flush(). Never throws and never rejects — a failure inside `promise`
   * is caught here, logged the same way `bg(label)` would, and turned
   * into a `{ success: false }` outcome instead of propagating.
   */
  track(label: string, promise: Promise<unknown>): void {
    const outcome = promise.then(
      (): BgTaskOutcome => ({ label, success: true }),
      (err: unknown): BgTaskOutcome => {
        const error = err instanceof Error ? err.message : String(err);
        logger.error(`bg.${label}.failed`, { error });
        return { label, success: false, error };
      },
    );
    this.pending.push(outcome);
  }

  /**
   * Await every tracked task and persist all outcomes in one RPC call.
   * Safe to call with zero tracked tasks (no-op). The RPC write itself is
   * best-effort: a ledger-write failure is logged but never thrown — an
   * observability outage must not be able to break the caller.
   */
  async flush(meta: { userId?: string } = {}): Promise<void> {
    if (this.pending.length === 0) return;

    const outcomes = await Promise.all(this.pending); // never rejects — track() catches internally

    try {
      const { error } = await supabaseAdmin.rpc('record_bg_task_outcomes', {
        p_outcomes: outcomes.map(o => ({ label: o.label, success: o.success, error: o.error ?? null })),
        p_user_id: meta.userId,
      });
      if (error) {
        logger.error('bg-ledger: flush RPC failed', { error, count: outcomes.length });
      }
    } catch (err) {
      logger.error('bg-ledger: flush threw', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}
