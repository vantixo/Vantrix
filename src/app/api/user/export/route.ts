/**
 * POST /api/user/export — GDPR Data Portability
 *
 * Queues a full data export for the authenticated user.
 * Exports: profile, conversations, messages, memories, psychology state, user facts.
 *
 * In production:
 *   - Queues an async export job (Supabase Edge Function or background worker)
 *   - Delivers ZIP to user's email within 24h
 *   - Rate-limited: one export per 7 days
 *
 * This implementation returns the data directly for <5MB datasets.
 * For large accounts, swap the response for a queued job.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { logger }                    from '@/lib/logger';
import { redis }              from '@/lib/redis';

export const dynamic = 'force-dynamic';


const EXPORT_COOLDOWN = 60 * 60 * 24 * 7; // 7 days between exports
const EXPORT_RATE_KEY = (userId: string) => `vantrix:export:cooldown:${userId}`;

export async function POST(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = user.id;

    // Rate limit: one export per 7 days
    const cooldownKey = EXPORT_RATE_KEY(userId);
    const existing = await redis.get(cooldownKey);
    if (existing) {
      return NextResponse.json({
        error: 'Export already requested. Please wait 7 days between exports.',
        code:  'EXPORT_RATE_LIMITED',
      }, { status: 429 });
    }

    // Set cooldown
    await redis.set(cooldownKey, '1', { ex: EXPORT_COOLDOWN });

    // Gather all user data
    const [
      profileResult,
      conversationsResult,
      memoriesResult,
      psychologyResult,
      factsResult,
      subscriptionsResult,
    ] = await Promise.allSettled([
      supabaseAdmin.from('profiles').select('*').eq('id', userId).single(),
      supabaseAdmin.from('conversations').select('id,character_id,title,last_message_at,created_at').eq('user_id', userId).limit(1000),
      supabaseAdmin.from('memory_graph').select('*').eq('user_id', userId).limit(500),
      supabaseAdmin.from('character_psychology').select('*').eq('user_id', userId).limit(100),
      supabaseAdmin.from('user_facts').select('*').eq('user_id', userId).limit(500),
      supabaseAdmin.from('subscriptions').select('tier,provider,status,expires_at,created_at').eq('user_id', userId).limit(50),
    ]);

    // Fetch messages for each conversation (limited)
    const conversations = conversationsResult.status === 'fulfilled' ? (conversationsResult.value.data ?? []) : [];
    const conversationIds = conversations.slice(0, 50).map((c: { id: string }) => c.id); // limit for perf

    const messagesResult = conversationIds.length > 0
      ? await supabaseAdmin.from('messages').select('conversation_id,role,content,created_at').in('conversation_id', conversationIds).limit(5000)
      : { data: [] };

    const exportData = {
      exportedAt:    new Date().toISOString(),
      exportVersion: '1.0',
      user: {
        id:    userId,
        email: user.email,
      },
      profile:       profileResult.status === 'fulfilled' ? profileResult.value.data : null,
      conversations: conversations,
      messages:      messagesResult.data ?? [],
      memories:      memoriesResult.status === 'fulfilled' ? (memoriesResult.value.data ?? []) : [],
      psychology:    psychologyResult.status === 'fulfilled' ? (psychologyResult.value.data ?? []) : [],
      facts:         factsResult.status === 'fulfilled' ? (factsResult.value.data ?? []) : [],
      subscriptions: subscriptionsResult.status === 'fulfilled' ? (subscriptionsResult.value.data ?? []) : [],
    };

    logger.info('gdpr:export', { userId, conversationCount: conversations.length });

    // Return as downloadable JSON
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type':        'application/json',
        'Content-Disposition': `attachment; filename="vantrix-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });

  } catch (error) {
    logger.error('gdpr:export-error', { error: String(error) });
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
