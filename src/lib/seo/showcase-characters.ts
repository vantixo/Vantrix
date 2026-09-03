import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Character } from "@/types";

/** Top matching characters for a landing page's showcase grid. */
export async function getShowcaseCharacters(
  gender?: "female" | "male" | "anime",
  category?: string,
): Promise<Pick<Character, "id" | "name" | "description" | "image_url" | "tags" | "archetype">[]> {
  let q = supabaseAdmin
    .from("characters")
    .select("id,name,description,image_url,tags,archetype")
    .eq("active",  true)
    .eq("is_live", true)
    .limit(6);

  if (gender)   q = q.eq("gender",   gender);
  if (category) q = q.eq("category", category);

  const { data } = await q.order("is_featured", { ascending: false });
  return (data ?? []) as Pick<Character, "id" | "name" | "description" | "image_url" | "tags" | "archetype">[];
}
