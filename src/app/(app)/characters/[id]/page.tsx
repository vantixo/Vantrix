import Link from "next/link";
import { notFound } from "next/navigation";
import { getCharacterDetail } from "@/lib/frontend/characters";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { resolveNsfwDiscoveryAccess } from "@/lib/access/character-gate";
import { Button } from "@/components/ui/button";
import { StartChatButton } from "@/components/characters/start-chat-button";
import { StartRoleplayButton } from "@/components/roleplay/start-roleplay-button";
import { CharacterEngagement } from "@/components/characters/character-engagement";
import { CharacterNicknameEditor } from "@/components/characters/character-nickname-editor";
import { CharacterWorldProfileSection } from "@/components/characters/character-world-profile";
import { CharacterStorySection } from "@/components/characters/character-story";
import { CharacterGallery } from "@/components/characters/character-gallery";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CharacterHero } from "@/components/immersive/character-hero";
import { CharacterReactionProvider } from "@/components/immersive/character-reaction-context";

export const dynamic = "force-dynamic";

/**
 * The detail page home's companion/experience cards already link to
 * (`/characters/${id}`) — was a 404 until now. Covers §3/§4's card-target
 * fields (image, name, tags, description, premium/new badges) plus the
 * Start Chat CTA, and — regression fix, Aug 2026 route-coverage audit —
 * like/follow/relationship-nickname/World Profile/Our Story, all of which
 * had working backend routes with zero frontend consumer.
 *
 * P0-AGE-GATE-FIX: previously rendered full character metadata/image for
 * ANY is_nsfw character to ANY signed-in user, with no age-verification
 * or nsfw_enabled check at all — a direct /characters/[id] URL bypassed
 * every gate that discovery, recommendations, and dating surfaces apply.
 * Now checks resolveNsfwDiscoveryAccess() (same shared gate those
 * surfaces use) before rendering; unauthorized viewers get a gated
 * placeholder instead of the character's content.
 */
export default async function CharacterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const character = await getCharacterDetail(id);
  if (!character) notFound();

  if (character.is_nsfw) {
    const { user } = await getAuthedUser();
    const allowed = await resolveNsfwDiscoveryAccess(user?.id ?? null);
    if (!allowed) {
      return (
        <div className="mx-auto max-w-md px-4 md:px-8 py-16 text-center">
          <h1 className="font-display text-xl text-text-primary">
            Mature content
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            This character has mature content. You&apos;ll need a verified
            age and mature content enabled in your profile settings to view
            it.
          </p>
          <Button asChild className="mt-6">
            <Link href="/profile/settings">Go to Settings</Link>
          </Button>
        </div>
      );
    }
  }

  return (
    // CHARACTER-REACTIONS: wraps the whole page (not just Hero+Engagement)
    // since it's a cheap Context provider with no render cost of its own —
    // simpler than threading it around just the two consumers, and leaves
    // room for a future reaction source (gallery, gifts) anywhere on this
    // page without re-plumbing. See character-reaction-context.tsx.
    <CharacterReactionProvider>
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-6">
      {/* IMMERSIVE-UI-PHASE-1: cinematic hero replaces the plain framed
          portrait — atmosphere + deterministic presence state, same
          image/badge data as before, see character-hero.tsx. */}
      <CharacterHero character={character} />

      <div className="mt-6 text-center">
        <h1 className="font-display text-2xl text-text-primary">
          {character.name}
          {character.age && (
            <span className="text-text-secondary font-sans text-lg">
              {" "}
              · {character.age}
            </span>
          )}
        </h1>
        {character.archetype && (
          <p className="mt-1 text-sm text-text-secondary">{character.archetype}</p>
        )}
        <div className="mt-3">
          <CharacterEngagement
            characterId={character.id}
            initialLikeCount={character.like_count}
            initialFollowerCount={character.follower_count}
          />
        </div>
      </div>

      {character.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {character.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border-hairline px-3 py-1 text-xs text-text-secondary"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {character.description && (
        <p className="mt-6 text-[15px] leading-relaxed text-text-primary text-center max-w-xl mx-auto">
          {character.description}
        </p>
      )}

      <div className="mt-8 flex flex-col items-center gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <StartChatButton characterId={character.id} />
          <StartRoleplayButton characterId={character.id} />
        </div>
        <CharacterNicknameEditor characterId={character.id} />
      </div>

      <div className="mt-10">
        <Tabs defaultValue="gallery">
          <TabsList className="justify-center">
            <TabsTrigger value="gallery">Gallery</TabsTrigger>
            <TabsTrigger value="world">World Profile</TabsTrigger>
            <TabsTrigger value="story">Our Story</TabsTrigger>
          </TabsList>
          <TabsContent value="gallery" className="pt-5">
            <CharacterGallery
              characterName={character.name}
              introVideoUrl={character.intro_video_url}
              galleryImageUrls={character.gallery_image_urls}
              galleryVideoUrls={character.gallery_video_urls}
            />
          </TabsContent>
          <TabsContent value="world" className="pt-5">
            <CharacterWorldProfileSection characterId={character.id} />
          </TabsContent>
          <TabsContent value="story" className="pt-5">
            <CharacterStorySection characterId={character.id} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
    </CharacterReactionProvider>
  );
}
