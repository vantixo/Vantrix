import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser }             from '@/lib/auth/get-authed-user';
import { z }                         from 'zod';

/**
 * GET /api/conversations/[id]/messages?before=<ISO timestamp>&limit=<n>
 *
 * Cursor-paginated message history for infinite scroll. chat/[id]/page.tsx
 * preloads the most recent 50 messages server-side on first render; this
 * route is what the client calls to fetch older pages as the user scrolls
 * up past that initial window, rather than loading a whole conversation's
 * history up front.
 *
 * `before` is the created_at of the oldest message currently rendered —
 * strictly older rows only, so re-fetching never re-returns a message
 * already on screen even if two messages share a millisecond timestamp
 * (tie-broken by id, see query below). Omit `before` to get the most
 * recent page (mirrors the page.tsx initial load, useful for any client
 * that wants to fetch history itself instead of relying on the server
 * component prop).
 *
 * Auth: conversation must belong to the requesting user — same ownership
 * check as every other conversation-scoped route (RLS would also catch
 * this since the route uses the user-scoped client, but the explicit
 * .eq('user_id', ...) below keeps the 404 semantics consistent even if
 * that ever changes).
 *
 * Efficiency: served entirely off idx_messages_conv_time
 * (conversation_id, created_at DESC) — see 20240101_production.sql —
 * so the ownership check plus the paginated fetch are both index-only
 * lookups regardless of how long the conversation gets.
 */
const querySchema = z.object({
  before:   z.string().datetime().optional(),
  // CORRECTNESS FIX (Phase B audit, 2026-08-06): the docstring above
  // claimed ties were "tie-broken by id", but the query only ever
  // filtered on created_at — two messages sharing an exact timestamp
  // (same-transaction inserts, backfills) could have one make it into a
  // page and the other silently and permanently skipped by every
  // subsequent .lt('created_at', before) call, since it's neither
  // "before" nor re-included. beforeId (optional, for backward
  // compatibility with any caller not yet updated) makes the cursor a
  // proper compound (created_at, id) boundary.
  beforeId: z.string().uuid().optional(),
  limit:    z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { supabase, user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: conversationId } = await props.params;

  const parsed = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  }
  const { before, beforeId, limit } = parsed.data;

  // Ownership check — conversation must be this user's.
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

  let query = supabase
    .from('messages')
    .select('id,role,content,image_url,video_url,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (before && beforeId) {
    // Proper compound cursor: strictly older, OR exactly tied on
    // created_at but with a lower id (matches the id-descending
    // secondary sort above) — no tied-timestamp row can be skipped.
    query = query.or(`created_at.lt.${before},and(created_at.eq.${before},id.lt.${beforeId})`);
  } else if (before) {
    // Back-compat path for any caller not yet sending beforeId — same
    // best-effort behavior as before this fix, just no longer the only path.
    query = query.lt('created_at', before);
  }

  const { data: msgs, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }

  const rows = msgs ?? [];
  // Fetched newest-first for the cursor comparison above; flip back to
  // chronological order for the client, same convention as the initial
  // server-render in chat/[id]/page.tsx.
  const messages = rows.slice().reverse();

  return NextResponse.json({
    messages,
    // If we got a full page, assume there may be more — the client's next
    // request (cursor = this page's oldest message) will come back empty
    // or short when history is actually exhausted, at which point it stops
    // asking. Cheap and correct without a second COUNT query.
    hasMore: rows.length === limit,
  });
}
