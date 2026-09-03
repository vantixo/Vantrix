import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ScenarioPicker } from "@/components/roleplay/scenario-picker";

export const dynamic = "force-dynamic";

/**
 * `characterId` here, not a conversationId (contrast /chat/[id]) — Story
 * Mode is entered from the character's own page before any conversation
 * necessarily exists yet; POST /api/roleplay/start creates or reuses the
 * (user, character) conversation itself once a scenario is picked.
 *
 * Optional `?scenario=<slug>` (set when arriving from /roleplay/new — the
 * scenario-first entry reached from Home's Popular Scenarios tiles) skips
 * the "pick a story" step: ScenarioPicker auto-starts that scenario as soon
 * as the catalog loads instead of waiting for another tap.
 */
export default async function NewRoleplayPage({
  params,
  searchParams,
}: {
  params: Promise<{ characterId: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { characterId } = await params;
  const { scenario: preselectSlug } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: character } = await supabase
    .from("characters")
    .select("id, name")
    .eq("id", characterId)
    .eq("active", true)
    .maybeSingle();
  if (!character) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-6">
      <h1 className="mb-1 font-serif text-xl font-semibold text-text-primary">Story Mode</h1>
      <ScenarioPicker characterId={character.id} characterName={character.name} preselectSlug={preselectSlug} />
    </div>
  );
}
