/**
 * GET /api/cron/embedding-backfill — pgvector embedding backfill
 *
 * Wires up two functions that existed but were never called from anywhere:
 * memory-embeddings.ts's backfillMissingEmbeddings() (written alongside the
 * original memory_graph pgvector migration, but left as "intended to be
 * run from a cron/one-off script" — no cron or script ever actually called
 * it) and character-embeddings.ts's backfillMissingCharacterEmbeddings().
 * Without this route, any row written before its respective migration, or
 * written while the brain service happened to be down at insert/update
 * time, would have embedding = NULL forever — silently excluded from
 * similarity search with no path back in.
 *
 * Runs daily (low-frequency tier, same as memory-archive) — this is
 * catch-up work for the steady trickle of rows that fail-open past the
 * write-time embed, not a bulk one-time migration tool. A brief brain-
 * service outage might leave a few dozen rows unembedded; this cron
 * catches them within a day, same tolerance the fail-open design already
 * accepts everywhere else in this system.
 *
 * Batches within a time budget, not a fixed batch count: each call to
 * backfillMissingEmbeddings()/backfillMissingCharacterEmbeddings() embeds
 * up to 50 rows in one /embed call to the brain service, so how many
 * batches fit in the maxDuration budget depends on that service's actual
 * latency, not a number guessed here. Stops a comfortable margin under
 * maxDuration (see SOFT_BUDGET_MS) so a slow batch never gets killed
 * mid-write by the platform, and stops immediately once a backfill
 * function reports processed: 0 (caught up, nothing left to embed).
 *
 * NOTE: both backfill functions currently reuse memory-embeddings.ts's /
 * character-embeddings.ts's single-item REQUEST_TIMEOUT_MS (1500ms) even
 * for a 50-item batch /embed call — consistent between the two, and fine
 * at today's brain-service throughput on this model, but worth widening if
 * batches start timing out under real backlog volume rather than staying
 * a one-off catch-up.
 *
 * Security: requires CRON_SECRET header, same as every other cron route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';
import { backfillMissingEmbeddings } from '@/lib/ai/memory-embeddings';
import { backfillMissingCharacterEmbeddings } from '@/lib/ai/character-embeddings';

export const runtime  = 'nodejs';
export const dynamic  = 'force-dynamic';
export const maxDuration = 60;

const BATCH_SIZE = 50;
// Comfortable margin under maxDuration=60s — leaves room for the slowest
// in-flight batch (bounded by the brain service's own request timeout) to
// finish before Vercel would kill the invocation outright.
const SOFT_BUDGET_MS = 45_000;
// Belt-and-suspenders cap alongside the time budget: if the brain service
// were somehow instant, this stops the loop from running unbounded against
// a very large backlog in a single invocation rather than spreading across
// runs — 30 batches x 50 rows = up to 1,500 rows/run, well above the
// steady-trickle volume this cron exists for.
const MAX_ITERATIONS = 30;

async function runBackfillLoop(
  label: string,
  fn: (batchSize: number) => Promise<{ processed: number; embedded: number }>,
  startedAt: number,
): Promise<{ processed: number; embedded: number; iterations: number }> {
  let totalProcessed = 0;
  let totalEmbedded = 0;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    if (Date.now() - startedAt > SOFT_BUDGET_MS) {
      logger.info(`cron:embedding-backfill:${label}:time-budget-reached`, { totalProcessed, totalEmbedded, iterations });
      break;
    }

    const { processed, embedded } = await fn(BATCH_SIZE);
    // Incremented immediately after the call completes, before either exit
    // check below — this must equal the actual number of fn() calls made,
    // not "completed loop bodies that didn't break", or it silently
    // undercounts by 1 on every early exit (which is most runs, since
    // processed: 0 is the normal "caught up" stop condition, not the rare
    // case). A `for (; cond; iterations++)` shape gets this wrong because
    // `break` skips the increment clause.
    iterations++;
    totalProcessed += processed;
    totalEmbedded += embedded;

    if (processed === 0) break; // caught up — nothing left with embedding IS NULL
  }

  return { processed: totalProcessed, embedded: totalEmbedded, iterations };
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('EMBEDDING_BACKFILL');
  const startedAt = Date.now();

  try {
    // Memories first: strictly larger, slower-growing backlog risk (every
    // chat turn can create one), so give it first claim on the shared time
    // budget if the two ever compete within a single run.
    const memories = await runBackfillLoop('memory_graph', backfillMissingEmbeddings, startedAt);
    const characters = await runBackfillLoop('characters', backfillMissingCharacterEmbeddings, startedAt);

    logger.info('cron:embedding-backfill:complete', { memories, characters });
    await heartbeatSuccess('EMBEDDING_BACKFILL');
    return NextResponse.json({
      ok: true,
      memories,
      characters,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('cron:embedding-backfill:failed', { error: String(err) });
    await heartbeatFail('EMBEDDING_BACKFILL');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
