import "server-only";
import { createClient } from '@/lib/supabase/server';
import type { RoleplayScenario, RoleplaySession, RoleplayBeat } from '@/types/roleplay';

/**
 * Read-side helpers for Story Mode pages. RLS-scoped (via the request's own
 * supabase client, same as lib/frontend/chat.ts) — every read here is
 * already implicitly owner-checked by the roleplay_sessions/roleplay_beats
 * policies, so these return null on any not-found-or-not-yours case rather
 * than distinguishing the two (same posture as getConversation in chat.ts).
 *
 * Mutations (starting a story, advancing a turn, ending one) are NOT here —
 * those go through the API routes under /api/roleplay/*, called from
 * client-side hooks (use-start-roleplay.ts, use-roleplay-turn.ts), because
 * they need the request-scoped auth + rate-limit + billing context those
 * routes assemble. This file is reads-for-render only.
 */

export async function getSession(sessionId: string): Promise<RoleplaySession | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('roleplay_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  return (data as RoleplaySession | null) ?? null;
}

export async function getScenarioById(scenarioId: string): Promise<RoleplayScenario | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('roleplay_scenarios')
    .select('id, slug, title, tagline, genre, tags, premise, setting, tone, opening_narration, character_id, chapter_count, cover_image_url, min_tier, is_active, sort_order')
    .eq('id', scenarioId)
    .maybeSingle();
  return (data as RoleplayScenario | null) ?? null;
}

/**
 * Messages belonging to this story only — scoped to `sinceIso` (the
 * session's started_at) rather than reusing chat.ts's getInitialMessages()
 * unfiltered, because the underlying conversation is shared with freeform
 * chat (Story Mode is a mode flag on the same thread, not a separate
 * table). Without this filter, any chat history from before the story
 * started — or from a previous story run on the same conversation — would
 * leak into this story's feed.
 */
export async function getSessionMessages(
  conversationId: string,
  sinceIso: string,
): Promise<{ id: string; role: string; content: string; created_at: string | null }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  return data ?? [];
}

export async function getBeats(sessionId: string): Promise<RoleplayBeat[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('roleplay_beats')
    .select('*')
    .eq('session_id', sessionId)
    .order('beat_number', { ascending: true });
  return (data as RoleplayBeat[] | null) ?? [];
}

/** Uses `image_url`, same column getChatConversation() reads in chat.ts, so
 *  the picture shown in Story Mode always matches the one shown in chat. */
export async function getCharacterNameAndAvatar(characterId: string): Promise<{ name: string; avatarUrl: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('characters')
    .select('name, image_url')
    .eq('id', characterId)
    .maybeSingle();
  if (!data) return null;
  return { name: data.name, avatarUrl: data.image_url ?? null };
}
