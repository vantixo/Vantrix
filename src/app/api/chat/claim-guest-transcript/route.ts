import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { sanitize } from '@/lib/sanitize';
import { logger } from '@/lib/logger';
import { ratelimit } from '@/lib/rate-limit';

/**
 * POST /api/chat/claim-guest-transcript
 *
 * Backfills a freshly-authenticated user's conversation with the transcript
 * from their pre-signup guest session, so "create a free account to
 * continue this conversation" is actually true.
 *
 * /api/chat/guest never writes to the database (see that route's comment
 * header) — a guest's reply history exists only in the browser, persisted
 * via src/lib/guest-transcript.ts. This endpoint is the other half: called
 * once by ChatWindow right after the post-signup redirect lands, with
 * whatever that localStorage entry held.
 *
 * Not trusted as-is — this is a client-supplied payload from someone who
 * was, until a moment ago, unauthenticated:
 *   - Requires a real session (this IS the auth boundary, not the cookie
 *     localStorage was protecting nothing).
 *   - Caps message count/length the same way the guest route does.
 *   - Sanitizes content identically to every other message-insert path.
 *   - Idempotent by construction: only ever backfills a conversation that
 *     is still completely empty. Call it twice, or with a tampered/replayed
 *     payload after the first real message exists, and it's a no-op — it
 *     can never overwrite or duplicate anything.
 */

export const dynamic = 'force-dynamic';

// Generous upper bound: GUEST_MESSAGE_LIMIT caps user turns (default 7), each
// with one assistant reply plus the character's opening line — padded well
// above the realistic maximum rather than coupling tightly to the env value.
const MAX_MESSAGES = 30;

const claimSchema = z.object({
  characterId: z.string().uuid(),
  messages: z.array(z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string().min(1).max(2000),
  })).min(1).max(MAX_MESSAGES),
});

export async function POST(req: NextRequest) {
  const { supabase, user } = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  // General-purpose limiter (30 req/min) — the idempotency guard below means
  // a flood of calls can never duplicate data, but nothing previously bounded
  // how many wasted auth + multi-query round trips a buggy or malicious
  // client could trigger by hammering this endpoint with arbitrary characterIds.
  const { success: rlOk } = await ratelimit.limit(user.id);
  if (!rlOk) {
    return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  const raw    = await req.json().catch(() => null);
  const parsed = claimSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const { characterId, messages } = parsed.data;

  const { data: character } = await supabase
    .from('characters')
    .select('id, name')
    .eq('id', characterId)
    .eq('active', true)
    .maybeSingle();
  if (!character) {
    return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });
  }

  // Find or create the conversation. RACE-FIX (audit, 2026-07-22): this
  // previously did a select-then-insert, the same non-atomic pattern fixed
  // in /api/conversations/ensure — see that route's RACE-FIX comment. The
  // post-signup redirect that triggers this endpoint can land at nearly
  // the same moment as chat/[id]/page.tsx's own server-side find-or-create
  // for the same character, so two near-simultaneous calls could both miss
  // the select and insert duplicate conversation rows. Upserting against
  // the DB-level unique constraint on (user_id, character_id) closes the
  // window the same way.
  const { error: upsertErr } = await supabase
    .from('conversations')
    .upsert(
      { user_id: user.id, character_id: characterId, title: `Chat with ${character.name}` },
      { onConflict: 'user_id,character_id', ignoreDuplicates: true },
    );
  if (upsertErr) {
    logger.error('claim-guest-transcript: failed to create conversation', { error: upsertErr, userId: user.id });
    return NextResponse.json({ error: 'Could not create conversation', code: 'INTERNAL_ERROR' }, { status: 500 });
  }

  const { data: newConv } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', user.id)
    .eq('character_id', characterId)
    .maybeSingle();
  if (!newConv) {
    logger.error('claim-guest-transcript: conversation missing after upsert', { userId: user.id, characterId });
    return NextResponse.json({ error: 'Could not create conversation', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
  const conversationId: string = newConv.id;

  // Idempotency guard — see header comment. Only backfill a still-empty
  // conversation; never touch one that already has any messages.
  const { count: existingMessageCount } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);

  if ((existingMessageCount ?? 0) > 0) {
    return NextResponse.json({ claimed: false, conversationId, reason: 'conversation_not_empty' });
  }

  const rows = messages.map(m => ({
    conversation_id: conversationId,
    role:             m.role,
    content:          sanitize(m.content),
  }));

  const { error: insertErr } = await supabase.from('messages').insert(rows);
  if (insertErr) {
    logger.error('claim-guest-transcript: insert failed', { error: insertErr, userId: user.id, conversationId });
    return NextResponse.json({ error: 'Could not save conversation', code: 'INTERNAL_ERROR' }, { status: 500 });
  }

  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  return NextResponse.json({ claimed: true, conversationId, messagesImported: rows.length });
}
