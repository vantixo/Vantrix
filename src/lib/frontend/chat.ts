import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * FRONTEND_DIRECTIVE §10 / §12 Phase 2.
 *
 * These are direct Supabase reads, not HTTP calls to our own /api routes —
 * each one is a thin, ownership-scoped select with no NSFW gating,
 * personalization, or other request-shaping logic living inline (unlike
 * /api/discover/featured), so the §10 "call the lib function directly"
 * path applies rather than the HTTP path used in discover.ts.
 *
 * Conversation *creation* deliberately stays out of this file. That logic
 * (find-or-create by (user_id, character_id), race-safe upsert against the
 * DB unique constraint — see /api/conversations/ensure's docstring) already
 * lives in one place; duplicating it here would risk reintroducing the
 * exact duplicate-row race that route's upsert was written to close. The
 * character detail page's "Start Chat" button calls that route via
 * useEnsureConversation() instead of a server-side equivalent.
 */

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  image_url: string | null;
  video_url: string | null;
  created_at: string | null;
}

export interface ChatConversationHeader {
  id: string;
  characterId: string;
  characterName: string;
  characterImage: string | null;
  isLive: boolean;
  introVideoUrl: string | null;
  galleryImageUrls: string[];
  galleryVideoUrls: string[];
}

/**
 * Ownership-checked load for /chat/[id]/page.tsx. Returns null on any
 * not-found/not-mine condition so the page can render notFound() uniformly
 * rather than distinguishing "doesn't exist" from "isn't yours" — same
 * 404-not-403 semantics the messages route uses, for the same reason
 * (don't confirm to a guesser that a conversation id exists at all).
 */
export async function getChatConversation(
  conversationId: string
): Promise<ChatConversationHeader | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("conversations")
    .select(
      `
      id,
      character_id,
      characters ( id, name, image_url, is_live, intro_video_url, gallery_image_urls, gallery_video_urls )
    `
    )
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  const character = data?.characters as
    | {
        id: string;
        name: string;
        image_url: string | null;
        is_live: boolean;
        intro_video_url: string | null;
        gallery_image_urls: string[] | null;
        gallery_video_urls: string[] | null;
      }
    | null
    | undefined;
  if (!data || !character) return null;

  return {
    id: data.id,
    characterId: data.character_id,
    characterName: character.name,
    characterImage: character.image_url,
    isLive: character.is_live,
    introVideoUrl: character.intro_video_url,
    // Same public gallery columns as getCharacterDetail() in characters.ts
    // (not private_gallery_*, which is admin-only) — DB defaults these to
    // '{}' but normalize defensively same as that function does.
    galleryImageUrls: character.gallery_image_urls ?? [],
    galleryVideoUrls: character.gallery_video_urls ?? [],
  };
}

/**
 * Most recent 50 messages, chronological. Same window/order convention the
 * paginated GET /api/conversations/[id]/messages route uses for its own
 * initial page, kept in sync deliberately — see that route's docstring.
 * Ownership is already guaranteed by getChatConversation() having
 * succeeded first; this is a second query rather than a join so the two
 * concerns (auth the view / load its content) stay independently testable.
 */
export async function getInitialMessages(
  conversationId: string
): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("id,role,content,image_url,video_url,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);

  return (data ?? []).slice().reverse();
}

export interface ConversationListItem {
  conversationId: string;
  lastMessageAt: string | null;
  lastMessage: string | null;
  character: {
    id: string;
    name: string;
    image_url: string | null;
    is_live: boolean;
  };
}

/**
 * Full conversation list for /chats — /api/user/home-context also reads
 * this table but caps at 4 for the home page's "continue chatting" strip;
 * there's no dedicated list route in §11's map, so this is a direct read
 * rather than forking that route's cap for a second, larger use.
 */
export async function listConversations(): Promise<ConversationListItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("conversations")
    .select(
      `
      id,
      last_message_at,
      last_message,
      characters ( id, name, image_url, is_live )
    `
    )
    .eq("user_id", user.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50);

  return (data ?? [])
    .map((c) => {
      const character = c.characters as
        | { id: string; name: string; image_url: string | null; is_live: boolean }
        | null;
      if (!character) return null;
      return {
        conversationId: c.id,
        lastMessageAt: c.last_message_at,
        lastMessage: c.last_message,
        character,
      };
    })
    .filter((c): c is ConversationListItem => c !== null);
}
