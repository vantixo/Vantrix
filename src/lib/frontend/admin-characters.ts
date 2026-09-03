import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface PendingCharacter {
  id: string;
  name: string;
  image_url: string | null;
  description: string;
  gender: string;
  age: number;
  is_nsfw: boolean;
  visibility_requested: string | null;
  creator_username: string | null;
  created_at: string | null;
}

/**
 * The pending-review queue for /admin/characters. There's no dedicated
 * GET /api/admin/characters list route (only /[id] for staff review of a
 * single character — see that route's own doc comment), so this queries
 * `characters` directly with the admin client, same pattern as
 * getAdminOverview(). Actions (approve/reject) go through the real PATCH
 * /api/admin/characters/[id] route from the client, since that's where
 * the actual approval logic (is_public defaulting, moderation_status
 * inference) lives.
 */
export async function getPendingCharacters(): Promise<PendingCharacter[]> {
  const { data } = await supabaseAdmin
    .from("characters")
    .select(
      "id,name,image_url,description,gender,age,is_nsfw,visibility_requested,created_at,profiles:creator_id(username)"
    )
    .eq("moderation_status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);

  return (data ?? []).map((c) => {
    const creator = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
    return {
      id: c.id,
      name: c.name,
      image_url: c.image_url,
      description: c.description,
      gender: c.gender,
      age: c.age,
      is_nsfw: Boolean(c.is_nsfw),
      visibility_requested: c.visibility_requested,
      creator_username: (creator as { username?: string } | null)?.username ?? null,
      created_at: c.created_at,
    };
  });
}
