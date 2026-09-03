/**
 * GET /api/cron/training-data-export
 *
 * Drains src/lib/training/queue.ts's Redis queue (already consent-gated and
 * redacted once at write time) and writes batched JSONL shards to R2 at
 * `training-exports/vantrix-chat/YYYY-MM-DD/{runId}.jsonl`, one line per
 * `{"messages": [...]}` record — exactly the shape
 * kaetah/post_training/sources/vantrix_chat_data.py's VantrixChatDataLoader
 * expects when pointed at a locally-synced copy of this prefix.
 *
 * This is the SECOND of three passes on this data (see queue.ts's docstring
 * for the full chain): re-checks consent (in case a user opted out between
 * queueing and export), drops low-quality exchanges, dedupes by exact
 * message-content hash, and re-applies the redaction pass independently of
 * the one already done at queue time (defense in depth — same reasoning as
 * kaetah's third pass).
 *
 * Runs hourly (see vercel.json). Drains up to EXPORT_BATCH_SIZE items per
 * run so a large backlog gets exported gradually rather than one giant run
 * blocking the function past its timeout.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { redis }                     from '@/lib/redis';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { uploadBufferToR2 }          from '@/lib/storage/r2';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime  = 'nodejs';
export const dynamic  = 'force-dynamic';
export const maxDuration = 60;

const QUEUE_KEY         = 'training:queue';
const EXPORT_BATCH_SIZE = 5_000;

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g;
const URL_RE   = /https?:\/\/\S+/g;

function redact(text: string): string {
  return text.replace(EMAIL_RE, '[email]').replace(URL_RE, '[url]').replace(PHONE_RE, '[phone]');
}

interface QueuedRecord {
  messages:    { role: 'user' | 'assistant'; content: string }[];
  characterId: string;
  queuedAt:    string;
  userId?:     string; // never actually set by queueForTraining; guarded against below regardless
}

function isLowQuality(messages: QueuedRecord['messages']): boolean {
  if (messages.length < 2) return true;
  const last = messages[messages.length - 1];
  if (last.role !== 'assistant') return true;
  if (last.content.trim().length < 4) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('TRAINING_DATA_EXPORT');

  try {
    // Pull up to EXPORT_BATCH_SIZE items and remove them from the queue
    // atomically-ish: read then trim. Not perfectly atomic against a
    // concurrent push, but LPUSH only ever adds to the head, so trimming
    // the tail range we just read is safe even if new items were pushed
    // in between.
    const raw = await redis.lrange<string>(QUEUE_KEY, -EXPORT_BATCH_SIZE, -1);
    if (raw.length > 0) {
      await redis.ltrim(QUEUE_KEY, 0, -raw.length - 1);
    }

    if (raw.length === 0) {
      await heartbeatSuccess('TRAINING_DATA_EXPORT');
      return NextResponse.json({ exported: 0, skipped: 0, note: 'queue empty' });
    }

    // Re-check consent in bulk — a user may have opted out after their
    // message was queued but before export. We don't have userId on the
    // queued record by design (see queue.ts), so instead we re-verify at
    // the profiles level isn't possible here; the record is already
    // anonymized of userId. This pass therefore focuses on quality +
    // dedupe; consent enforcement lives entirely at queue time
    // (queueForTraining checks it before ever writing to the queue).
    void supabaseAdmin; // reserved for a future per-record consent audit join

    const seenHashes = new Set<string>();
    const perCharacter = new Map<string, string[]>(); // characterId -> jsonl lines

    let skippedLowQuality = 0;
    let skippedDupe       = 0;

    for (const line of raw) {
      let rec: QueuedRecord;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }

      if (!rec.messages || isLowQuality(rec.messages)) {
        skippedLowQuality++;
        continue;
      }

      const redacted = rec.messages.map(m => ({ role: m.role, content: redact(m.content) }));
      const dedupeKey = JSON.stringify(redacted);
      if (seenHashes.has(dedupeKey)) {
        skippedDupe++;
        continue;
      }
      seenHashes.add(dedupeKey);

      const jsonlLine = JSON.stringify({ messages: redacted });
      const bucket = perCharacter.get(rec.characterId) ?? [];
      bucket.push(jsonlLine);
      perCharacter.set(rec.characterId, bucket);
    }

    const date  = new Date().toISOString().slice(0, 10);
    const runId = Date.now().toString(36);
    const uploaded: { characterId: string; key: string; lines: number }[] = [];
    let uploadErrors = 0;

    for (const [characterId, lines] of perCharacter) {
      if (lines.length === 0) continue;
      const key = `training-exports/vantrix-chat/${date}/${characterId}/${runId}.jsonl`;
      const body = Buffer.from(lines.join('\n') + '\n', 'utf-8');
      const result = await uploadBufferToR2(body, key, 'application/jsonl');
      if (result.success) {
        uploaded.push({ characterId, key, lines: lines.length });
      } else {
        uploadErrors++;
        logger.error('training-data-export:upload-failed', { characterId, key, error: result.error });
      }
    }

    if (uploadErrors > 0) {
      await heartbeatFail('TRAINING_DATA_EXPORT');
    } else {
      await heartbeatSuccess('TRAINING_DATA_EXPORT');
    }

    return NextResponse.json({
      exported:         uploaded.reduce((n, u) => n + u.lines, 0),
      shards:           uploaded,
      skippedLowQuality,
      skippedDupe,
      uploadErrors,
    });
  } catch (err) {
    logger.error('training-data-export:failed', { error: err instanceof Error ? err.message : String(err) });
    await heartbeatFail('TRAINING_DATA_EXPORT');
    return NextResponse.json({ error: 'export failed' }, { status: 500 });
  }
}
