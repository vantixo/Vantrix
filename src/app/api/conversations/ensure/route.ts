import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser }             from '@/lib/auth/get-authed-user';
import { ratelimit, resolveEffectiveTier } from '@/lib/rate-limit';
import { checkCharacterSlotAvailable } from '@/lib/access/character-gate';
import { captureEvent }              from '@/lib/analytics/server';
import { z }                         from 'zod';

/**
 * POST /api/conversations/ensure
 *
 * DATING-CHAT-404-FIX: the dating match page was passing `match.id` (a
 * dating_matches row id) to ChatWindow as `conversationId` — but
 * dating_matches has no conversation_id column at all, and never did. The
 * chat/stream route validates conversationId against the `conversations`
 * table, so every message sent from the dating tab failed with
 * "Conversation not found" (404).
 *
 * chat/[id]/page.tsx already has correct find-or-create-by-character logic,
 * but it's a server component — the dating match page is a client
 * component and needs the same thing over the wire. This is that endpoint,
 * with identical semantics: one conversation per (user, character), reused
 * across regular chat AND dating so history is shared rather than split
 * into two disconnected threads for the same character.
 */
const bodySchema = z.object({ characterId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const { supabase, user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { success: rlOk } = await ratelimit.limit(user.id);
  if (!rlOk) {
    return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { characterId } = parsed.data;

  const { data: character } = await supabase
    .from('characters').select('id,name').eq('id', characterId).single();
  if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

  // SLOT-GATE: only block on the character-slot limit when this would be a
  // *new* slot — a user reopening a conversation they already have with
  // this character must never be turned away by their own plan's limit.
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', user.id)
    .eq('character_id', characterId)
    .maybeSingle();

  if (!existing) {
    const { data: profile } = await supabase
      .from('profiles').select('tier,role,is_admin').eq('id', user.id).maybeSingle();
    const tier = resolveEffectiveTier(profile ?? {});
    const slotGate = await checkCharacterSlotAvailable(user.id, tier);
    if (!slotGate.allowed) {
      return NextResponse.json(
        { error: slotGate.reason, code: 'CHARACTER_SLOT_LIMIT_REACHED', used: slotGate.used, limit: slotGate.limit },
        { status: 403 },
      );
    }
  }

  // RACE-FIX (2026-08-12): previously checked for an existing conversation
  // first and only upserted on a miss. Two near-simultaneous calls (this
  // route racing chat/[id]/page.tsx's server-side find-or-create, e.g. the
  // dating page and chat page both loading for the same character close
  // together) could both pass that check before either write committed,
  // producing duplicate conversation rows — see
  // 20260812_conversation_dedupe_and_message_retention.sql for the full
  // explanation and the matching fix in chat/[id]/page.tsx. Upserting
  // unconditionally against the DB-level unique constraint on
  // (user_id, character_id) removes the window entirely: Postgres
  // resolves concurrent upserts against the same conflict target
  // serially, so at most one row can ever exist for this pair.
  const { error: upsertErr } = await supabase
    .from('conversations')
    .upsert(
      {
        user_id:      user.id,
        character_id: characterId,
        title:        `Chat with ${character.name}`,
      },
      { onConflict: 'user_id,character_id', ignoreDuplicates: true },
    );

  if (upsertErr) {
    return NextResponse.json({ error: 'Could not create conversation' }, { status: 500 });
  }

  const { data: created } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', user.id)
    .eq('character_id', characterId)
    .single();

  if (!created) {
    return NextResponse.json({ error: 'Could not create conversation' }, { status: 500 });
  }

  // This route is the single choke point for conversation creation (see
  // this file's own header + lib/frontend/chat.ts's comment confirming
  // chat/[id]/page.tsx deliberately never duplicates this find-or-create
  // logic) — so it's also the one correct place to fire
  // `character_chat_started` (lib/analytics/events.ts). `existing`,
  // computed above before the upsert, is exactly is_first_message's
  // inverse: no prior conversation row means this call just started one.
  captureEvent(user.id, 'character_chat_started', {
    character_id: characterId,
    is_first_message: !existing,
  });

  return NextResponse.json({ conversationId: created.id });
}
