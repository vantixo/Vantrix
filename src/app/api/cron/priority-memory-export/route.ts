/**
 * GET /api/cron/priority-memory-export
 *
 * Exports priority_memories rows — the filtered, keyword-tagged
 * "what matters" layer (see src/lib/ai/priority-memory.ts) — to R2 as
 * structured reference data for Kaetah character-building/training. This
 * is distinct from src/app/api/cron/training-data-export, which exports
 * raw chat exchanges: this export is curated facts/moments per character,
 * shaped for building a character's persistent knowledge of a person
 * rather than raw dialogue examples.
 *
 * Consent: reuses profiles.training_data_consent (same flag as the chat
 * export — one opt-in covers both). Only rows belonging to consented users
 * are exported; this cron joins against profiles rather than relying on
 * anything cached at write time, so an opt-out takes effect on the very
 * next run.
 *
 * Output: `training-exports/priority-memories/{date}/{characterId}/{runId}.jsonl`,
 * one line per memory: `{"category","headline","content","keywords","importance"}`.
 * No user_id, no character name resolution beyond the id — matches the
 * chat-export pipeline's de-identification posture.
 *
 * Runs daily (see vercel.json) — this data changes far more slowly than
 * raw chat volume, hourly would just re-export mostly-unchanged rows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { uploadBufferToR2 }          from '@/lib/storage/r2';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime  = 'nodejs';
export const dynamic  = 'force-dynamic';
export const maxDuration = 60;

const EXPORT_PAGE_SIZE = 1_000;

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('PRIORITY_MEMORY_EXPORT');

  try {
    // Consented user ids first — priority_memories has no consent column of
    // its own (by design; consent lives once, on profiles), so we scope the
    // export by joining against the current consent state on every run.
    const { data: consentedProfiles, error: consentErr } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('training_data_consent', true);

    if (consentErr) throw consentErr;

    const consentedIds = (consentedProfiles ?? []).map(p => p.id as string);
    if (consentedIds.length === 0) {
      await heartbeatSuccess('PRIORITY_MEMORY_EXPORT');
      return NextResponse.json({ exported: 0, note: 'no consented users' });
    }

    const date  = new Date().toISOString().slice(0, 10);
    const runId = Date.now().toString(36);
    const perCharacter = new Map<string, string[]>();
    let uploadErrors = 0;
    let totalRows = 0;

    // Paginate through consented users' priority_memories rather than one
    // giant IN(...) query — consentedIds could be large, and Postgres IN
    // lists get unwieldy well before that.
    for (let i = 0; i < consentedIds.length; i += 200) {
      const batchIds = consentedIds.slice(i, i + 200);

      let from = 0;
      for (;;) {
        const { data: rows, error } = await supabaseAdmin
          .from('priority_memories')
          .select('character_id,category,headline,content,keywords,importance')
          .in('user_id', batchIds)
          .range(from, from + EXPORT_PAGE_SIZE - 1);

        if (error) throw error;
        if (!rows || rows.length === 0) break;

        for (const row of rows) {
          const line = JSON.stringify({
            category:   row.category,
            headline:   row.headline,
            content:    row.content,
            keywords:   row.keywords,
            importance: row.importance,
          });
          const bucket = perCharacter.get(row.character_id as string) ?? [];
          bucket.push(line);
          perCharacter.set(row.character_id as string, bucket);
          totalRows++;
        }

        if (rows.length < EXPORT_PAGE_SIZE) break;
        from += EXPORT_PAGE_SIZE;
      }
    }

    const uploaded: { characterId: string; key: string; lines: number }[] = [];
    for (const [characterId, lines] of perCharacter) {
      if (lines.length === 0) continue;
      const key  = `training-exports/priority-memories/${date}/${characterId}/${runId}.jsonl`;
      const body = Buffer.from(lines.join('\n') + '\n', 'utf-8');
      const result = await uploadBufferToR2(body, key, 'application/jsonl');
      if (result.success) {
        uploaded.push({ characterId, key, lines: lines.length });
      } else {
        uploadErrors++;
        logger.error('priority-memory-export:upload-failed', { characterId, key, error: result.error });
      }
    }

    if (uploadErrors > 0) {
      await heartbeatFail('PRIORITY_MEMORY_EXPORT');
    } else {
      await heartbeatSuccess('PRIORITY_MEMORY_EXPORT');
    }

    return NextResponse.json({ exported: totalRows, shards: uploaded, uploadErrors });
  } catch (err) {
    logger.error('priority-memory-export:failed', { error: err instanceof Error ? err.message : String(err) });
    await heartbeatFail('PRIORITY_MEMORY_EXPORT');
    return NextResponse.json({ error: 'export failed' }, { status: 500 });
  }
}
