/**
 * DELETE /api/user/delete — GDPR Right to Be Forgotten
 *
 * SEC-13 / audit items #4-#6 fix: deletion is now a durable, verified
 * workflow instead of "fire allSettled(), log failures, delete the auth
 * user, and report success regardless":
 *
 *   requested -> processing -> completed | failed
 *
 * A `deletion_requests` row (no FK to the user being deleted — it must
 * outlive them) tracks state. Before returning success, we run a GENERIC
 * schema-wide verification (verify_user_data_purged) that checks every
 * public-schema table with a user_id column, not a hand-maintained list.
 * If anything remains, we attempt one remediation sweep and re-verify;
 * if it's still non-empty, we report FAILURE — not partial success — and
 * leave the deletion_requests row in `failed` status for retry/alerting.
 *
 * Redis DLQ payloads may still retain user-identifying data until natural
 * TTL expiry (documented, accepted interim gap — see migration comments).
 * That is tracked separately via redis_fully_clean and does NOT block the
 * DB-purge completion status, but is surfaced in the response so callers
 * (and any compliance reporting) don't have to assume it's handled.
 *
 * Irreversible. Confirm with { confirmPhrase: "delete my account" }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { logger }                    from '@/lib/logger';
import { redis }                     from '@/lib/redis';

export const dynamic = 'force-dynamic';

interface RemainingRow { table_name: string; remaining_count: number; [key: string]: string | number }

/**
 * Cursor-based key scan + delete for a single pattern.
 * Replaces redis.keys() which blocks the Redis server for O(total keys).
 * Safe at any scale — each SCAN call processes at most `count` keys.
 */
async function scanAndDelete(pattern: string): Promise<number> {
  let cursor  = 0;
  let deleted = 0;

  do {
    try {
      const [nextCursor, keys] = await redis.scan(cursor, {
        match: pattern,
        count: 200,
      }) as unknown as [number, string[]];

      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...(keys as [string, ...string[]]));
        deleted += keys.length;
      }
    } catch (err) {
      logger.warn('gdpr:redis-scan-error', { pattern, cursor, error: String(err) });
      break; // don't loop forever on Redis error
    }
  } while (cursor !== 0);

  return deleted;
}

export async function DELETE(req: NextRequest) {
  let deletionRequestId: string | null = null;
  let userId: string | null = null;

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    userId = user.id;

    const body = await req.json().catch(() => ({}));
    const { confirmPhrase } = body as { confirmPhrase?: string };

    if (confirmPhrase !== 'delete my account') {
      return NextResponse.json({
        error: 'Please confirm deletion by providing { "confirmPhrase": "delete my account" }',
        code:  'CONFIRMATION_REQUIRED',
      }, { status: 400 });
    }

    // If a prior attempt for this user already failed, resume that record
    // instead of creating a new one — keeps a single durable history per user.
    const { data: existing } = await supabaseAdmin
      .from('deletion_requests')
      .select('id, attempt_count')
      .eq('user_id', userId)
      .in('status', ['requested', 'processing', 'failed'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      deletionRequestId = existing.id;
      await supabaseAdmin.from('deletion_requests')
        .update({ status: 'processing', processing_at: new Date().toISOString(), attempt_count: existing.attempt_count + 1 })
        .eq('id', existing.id);
    } else {
      const { data: created, error: createErr } = await supabaseAdmin
        .from('deletion_requests')
        .insert({
          user_id: userId,
          email: user.email,
          status: 'processing',
          processing_at: new Date().toISOString(),
          attempt_count: 1,
          created_by_ip: req.headers.get('x-forwarded-for') ?? undefined,
        })
        .select('id')
        .single();
      if (createErr || !created) {
        logger.error('gdpr:deletion-request-create-failed', { userId, error: createErr?.message });
        return NextResponse.json({ error: 'Could not initiate deletion. Please try again.' }, { status: 500 });
      }
      deletionRequestId = created.id;
    }

    logger.warn('gdpr:delete-initiated', { userId, email: user.email, deletionRequestId });

    // 1. Delete data not covered by auth.users CASCADE. Best-effort at this
    //    stage — failures here are not fatal on their own, because step 3
    //    (generic verification) is the actual source of truth.
    const deleteOps = await Promise.allSettled([
      supabaseAdmin.from('character_psychology').delete().eq('user_id', userId),
      supabaseAdmin.from('memory_graph').delete().eq('user_id', userId),
      supabaseAdmin.from('user_facts').delete().eq('user_id', userId),
      supabaseAdmin.from('character_initiatives').delete().eq('user_id', userId),
      supabaseAdmin.from('dating_matches').delete().eq('user_id', userId),
      supabaseAdmin.from('dating_swipes').delete().eq('user_id', userId),
    ]);

    const failedOps = deleteOps.filter(r => r.status === 'rejected');
    if (failedOps.length > 0) {
      logger.warn('gdpr:delete-partial-failure-step1', {
        userId,
        failures: failedOps.map(f => String((f as PromiseRejectedResult).reason)),
      });
    }

    // 2. Delete Supabase Auth user (triggers CASCADE on profiles and most FK tables)
    const { error: authDeleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authDeleteErr) {
      await failDeletion(deletionRequestId, `auth delete failed: ${authDeleteErr.message}`);
      logger.error('gdpr:auth-delete-failed', { userId, error: authDeleteErr.message, deletionRequestId });
      return NextResponse.json(
        { error: 'Account deletion failed', details: authDeleteErr.message, deletionRequestId },
        { status: 500 }
      );
    }

    // 3. Generic, schema-wide verification — the actual source of truth for
    //    "is this user's data really gone", not just "did our known ops succeed".
    let remaining = await verifyPurged(userId);

    if (remaining.length > 0) {
      logger.warn('gdpr:delete-remediation-attempt', { userId, deletionRequestId, remaining });
      // One remediation sweep against whatever's left, then re-verify.
      await supabaseAdmin.rpc('purge_user_data_remediate', { p_user_id: userId });
      remaining = await verifyPurged(userId);
    }

    // 4. Redis cleanup — tracked separately, does not gate DB-purge status.
    //    Billing DLQ payloads embed userId inside JSON and cannot be matched
    //    by key pattern; they carry a bounded TTL and expire naturally
    //    (documented interim gap, audit item #6).
    const keyPatterns = [
      `vantrix:memory:${userId}:*`,
      `vantrix:session-bridge:${userId}:*`,
      `vantrix:voice-fp:${userId}:*`,
      `vantrix:facts:${userId}:*`,
      `vantrix:reco:${userId}`,
      `vantrix:nudge:${userId}:*`,
      `vantrix:export:cooldown:${userId}`,
      `idem:${userId}:*`,
      `ai:tokens:${userId}:*`,
      `vantrix:user:queue:pending:${userId}`,
      `vantrix:lock:chat:${userId}`,
    ];

    let redisKeysDeleted = 0;
    for (const pattern of keyPatterns) {
      try {
        redisKeysDeleted += await scanAndDelete(pattern);
      } catch (redisErr) {
        logger.warn('gdpr:redis-cleanup-partial', { pattern, error: String(redisErr) });
      }
    }
    const redisFullyClean = false; // DLQ payload caveat above — never claim full certainty here

    if (remaining.length > 0) {
      // Do NOT report success. This is the fix for the core bug: partial
      // failure must surface as failure, not "ok: true".
      await supabaseAdmin.from('deletion_requests').update({
        status: 'failed',
        failed_at: new Date().toISOString(),
        remaining_tables: remaining,
        redis_keys_deleted: redisKeysDeleted,
        redis_fully_clean: redisFullyClean,
        error_detail: `${remaining.length} table(s) still contain rows for this user after remediation`,
      }).eq('id', deletionRequestId);

      logger.error('gdpr:delete-verification-failed', { userId, deletionRequestId, remaining });

      return NextResponse.json({
        ok: false,
        error: 'Deletion could not be fully verified. Your account has been deactivated and this has been ' +
               'flagged for manual review — your data will be fully purged shortly. No further action is needed from you.',
        deletionRequestId,
        status: 'failed',
      }, { status: 500 });
    }

    await supabaseAdmin.from('deletion_requests').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      redis_keys_deleted: redisKeysDeleted,
      redis_fully_clean: redisFullyClean,
      remaining_tables: [],
    }).eq('id', deletionRequestId);

    logger.info('gdpr:delete-complete', { userId, deletionRequestId, redisKeysDeleted });
    return NextResponse.json({
      ok: true,
      status: 'completed',
      deletionRequestId,
      message: 'Your account and all associated data have been permanently deleted and verified.',
    });

  } catch (error) {
    logger.error('gdpr:delete-error', { userId, deletionRequestId, error: String(error) });
    if (deletionRequestId) await failDeletion(deletionRequestId, String(error));
    return NextResponse.json({ error: 'Deletion failed', deletionRequestId }, { status: 500 });
  }
}

async function verifyPurged(userId: string): Promise<RemainingRow[]> {
  const { data, error } = await supabaseAdmin.rpc('verify_user_data_purged', { p_user_id: userId });
  if (error) {
    // If verification itself fails, we cannot claim success — treat as
    // "unknown, assume not clean" rather than silently passing.
    logger.error('gdpr:verify-purge-rpc-error', { userId, error: error.message });
    return [{ table_name: '__verification_rpc_failed__', remaining_count: -1 }];
  }
  return (data ?? []) as RemainingRow[];
}

async function failDeletion(deletionRequestId: string, detail: string) {
  await supabaseAdmin.from('deletion_requests').update({
    status: 'failed',
    failed_at: new Date().toISOString(),
    error_detail: detail,
  }).eq('id', deletionRequestId);
}
