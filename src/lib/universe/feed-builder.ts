/**
 * Feed Builder — User Feed Population
 *
 * "Users should come back to a world that has been living without them."
 *
 * Reads fresh entries from companion_offline_log for characters each user
 * actively engages with (recent conversations) and writes them to user_feeds
 * so the discovery / home feed shows what characters have been up to.
 *
 * This runs on the 'feed_build' job type, triggered every ~2 hours.
 * Entries older than 48h are expired from the feed table.
 *
 * Design: the offline log is the source of truth (written by all engines).
 * This module is purely a read → fan-out step. Separation ensures that
 * life events are recorded regardless of whether any user is subscribed.
 */

import { supabaseAdmin }  from '@/lib/supabase/admin';
import { logger }         from '@/lib/logger';

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Fan out recent offline log entries to user feeds.
 * Each entry goes to every user who has chatted with that character
 * in the last 30 days.
 */
export async function tickUserFeeds(): Promise<{ entries_fanned: number; expired: number }> {
  // 1. Expire old feed entries (> 48h)
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { count: expiredCount } = await supabaseAdmin
    .from('user_feeds')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff48h);

  const expired = expiredCount ?? 0;

  // 2. Get offline log entries from the last 2 hours (since last feed_build)
  const cutoff2h = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: logEntries, error: logError } = await supabaseAdmin
    .from('companion_offline_log')
    .select('id, character_id, content, entry_type, occurred_at')
    .gt('occurred_at', cutoff2h)
    .order('occurred_at', { ascending: false })
    .limit(200);

  if (logError || !logEntries || logEntries.length === 0) {
    logger.info('feed-builder:tick:no-new-entries', { expired });
    return { entries_fanned: 0, expired };
  }

  // 3. Group entries by character
  const byChar = new Map<string, typeof logEntries>();
  for (const entry of logEntries) {
    const existing = byChar.get(entry.character_id) ?? [];
    existing.push(entry);
    byChar.set(entry.character_id, existing);
  }

  let entriesFanned = 0;

  // 4. For each character, find subscribed users and fan out
  await Promise.allSettled(
    Array.from(byChar.entries()).map(async ([characterId, entries]) => {
      const userIds = await getActiveUserIdsForCharacter(characterId);
      if (userIds.length === 0) return;

      const inserts = userIds.flatMap((userId) =>
        entries.map((e) => ({
          user_id:      userId,
          character_id: characterId,
          content:      e.content,
          entry_type:   e.entry_type,
          is_read:      false,
          created_at:   e.occurred_at,
        })),
      );

      if (inserts.length === 0) return;

      // Use upsert with ignore to skip duplicates
      const { error } = await supabaseAdmin
        .from('user_feeds')
        .upsert(inserts, { onConflict: 'user_id,character_id,created_at', ignoreDuplicates: true });

      if (!error) {
        entriesFanned += inserts.length;
      } else {
        logger.warn('feed-builder:fan-out:failed', { characterId, error });
      }
    }),
  );

  logger.info('feed-builder:tick:complete', { entries_fanned: entriesFanned, expired });
  return { entries_fanned: entriesFanned, expired };
}

// ── Public: Read Feed ──────────────────────────────────────────────────────────

/**
 * Get a user's personalized feed, most recent first.
 */
export async function getUserFeed(
  userId:     string,
  limit:      number = 20,
  unreadOnly: boolean = false,
) {
  let query = supabaseAdmin
    .from('user_feeds')
    .select(`
      *,
      character:characters(id, name, image_url)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.eq('is_read', false);
  }

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

/**
 * Mark feed entries as read for a user.
 */
export async function markFeedRead(userId: string, characterId?: string): Promise<void> {
  let query = supabaseAdmin
    .from('user_feeds')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (characterId) {
    query = query.eq('character_id', characterId);
  }

  await query;
}

// ── Internal ───────────────────────────────────────────────────────────────────

/**
 * Get user IDs who have an active conversation with this character.
 * "Active" = at least one message in the last 30 days.
 */
async function getActiveUserIdsForCharacter(characterId: string): Promise<string[]> {
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('user_id')
    .eq('character_id', characterId)
    .gt('updated_at', cutoff30d);

  if (error || !data) return [];

  // Deduplicate user IDs
  return [...new Set(data.map((c: { user_id: string }) => c.user_id))];
}
