/**
 * POST /api/report
 *
 * User-initiated content/conversation reporting.
 *
 * WHY:
 * Without a reporting system, the only moderation signal is automated detection.
 * One bad viral moment — a screenshot of harmful AI output — without a reporting
 * flow is a platform risk. Users need to be able to flag content; moderators
 * need a queue.
 *
 * SCHEMA:
 *   - conversationId | communityPostId | communityReplyId: exactly one
 *     target per report (characterId/matchId are extra context, not
 *     targets on their own)
 *   - category:       reason code (see REPORT_CATEGORIES)
 *   - detail:         optional free-text (max 500 chars)
 *
 * SIDE EFFECTS:
 *   - Inserts into user_reports table
 *   - If category is CSAM or severe_harm, triggers an immediate alert
 *     via ANOMALY_WEBHOOK_URL (same channel as security anomalies)
 *   - Deduplicates: same user + same target can only report once per 24h
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { z }                          from 'zod';
import { supabaseAdmin }              from '@/lib/supabase/admin';
import { logger }                     from '@/lib/logger';
import { env }                        from '@/env';

export const dynamic = 'force-dynamic';

import { REPORT_CATEGORIES, type ReportCategory } from '@/lib/reporting/categories';

// Categories that trigger an immediate alert to operations
const HIGH_PRIORITY_CATEGORIES: Set<ReportCategory> = new Set([
  'underage_content',
  'harmful_ai_output',
]);

const schema = z.object({
  conversationId:    z.string().uuid().optional(),
  characterId:       z.string().uuid().optional(),
  matchId:           z.string().uuid().optional(),
  communityPostId:   z.string().uuid().optional(),
  communityReplyId:  z.string().uuid().optional(),
  category:          z.enum(REPORT_CATEGORIES),
  detail:            z.string().max(500).optional(),
  /** The specific message content being reported (for context — never persisted in plaintext by default) */
  messageSnippet:    z.string().max(300).optional(),
});

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw    = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const {
    conversationId, characterId, matchId,
    communityPostId, communityReplyId,
    category, detail, messageSnippet,
  } = parsed.data;

  if (!conversationId && !characterId && !matchId && !communityPostId && !communityReplyId) {
    return NextResponse.json(
      { error: 'Must provide conversationId, characterId, matchId, communityPostId, or communityReplyId' },
      { status: 400 },
    );
  }

  // Dedup: one report per user per target per 24h. Conversations, posts,
  // and replies are mutually exclusive targets on a single report, so each
  // gets its own scoped lookup rather than one query with OR'd columns.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let dupQuery = null;
  if (conversationId) {
    dupQuery = supabaseAdmin.from('user_reports').select('*', { count: 'exact', head: true })
      .eq('reporter_id', user.id).eq('conversation_id', conversationId).gte('created_at', since);
  } else if (communityPostId) {
    dupQuery = supabaseAdmin.from('user_reports').select('*', { count: 'exact', head: true })
      .eq('reporter_id', user.id).eq('community_post_id', communityPostId).gte('created_at', since);
  } else if (communityReplyId) {
    dupQuery = supabaseAdmin.from('user_reports').select('*', { count: 'exact', head: true })
      .eq('reporter_id', user.id).eq('community_reply_id', communityReplyId).gte('created_at', since);
  }

  if (dupQuery) {
    const { count } = await dupQuery;
    if ((count ?? 0) > 0) {
      return NextResponse.json({
        success: true,
        message: 'You already reported this.',
        duplicate: true,
      });
    }
  }

  // Insert report
  const { data: report, error: insertErr } = await supabaseAdmin
    .from('user_reports')
    .insert({
      reporter_id:         user.id,
      conversation_id:     conversationId   ?? null,
      character_id:        characterId      ?? null,
      match_id:            matchId          ?? null,
      community_post_id:   communityPostId  ?? null,
      community_reply_id:  communityReplyId ?? null,
      category,
      detail:               detail          ?? null,
      message_snippet:      messageSnippet  ?? null,
      status:                'pending',
    })
    .select('id')
    .single();

  if (insertErr) {
    logger.error('[report] Insert failed', { error: insertErr.message, userId: user.id });
    return NextResponse.json({ error: 'Failed to submit report' }, { status: 500 });
  }

  logger.info('[report] Report submitted', {
    reportId: report.id, userId: user.id, category, conversationId,
  });

  // High-priority alert
  if (HIGH_PRIORITY_CATEGORIES.has(category) && env.ANOMALY_WEBHOOK_URL) {
    fetch(env.ANOMALY_WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:       'HIGH_PRIORITY_REPORT',
        reportId:   report.id,
        category,
        userId:     user.id,
        conversationId,
        characterId,
        detail,
        timestamp:  new Date().toISOString(),
      }),
    }).catch(err => logger.error('[report] Alert webhook failed', { error: String(err) }));
  }

  return NextResponse.json({
    success:  true,
    reportId: report.id,
    message:  'Your report has been submitted. Our team reviews all reports.',
  });
}

/**
 * GET /api/report?reportId=...
 * Allow a user to check the status of their own report.
 */
export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const reportId = req.nextUrl.searchParams.get('reportId');
  if (!reportId) return NextResponse.json({ error: 'reportId required' }, { status: 400 });

  const { data: report } = await supabaseAdmin
    .from('user_reports')
    .select('id,category,status,created_at')
    .eq('id', reportId)
    .eq('reporter_id', user.id)    // can only see own reports
    .single();

  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

  return NextResponse.json({ report });
}
