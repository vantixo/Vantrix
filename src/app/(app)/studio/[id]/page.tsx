import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { getEditableCharacter, getCharacterMemories } from "@/lib/frontend/studio-edit";
import { resolveImageSrc } from "@/lib/utils";
import { CharacterBuilderForm } from "@/components/studio/builder/character-builder-form";
import { MemoryBuilder } from "@/components/studio/builder/memory-builder";
import { CharacterActions } from "@/components/studio/builder/character-actions";
import { VisibilityToggle } from "@/components/studio/visibility-toggle";
import { ImageGalleryTab } from "@/components/studio/gallery/image-gallery-tab";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const dynamic = "force-dynamic";

/**
 * The Studio surface intentionally deferred in the first pass — see
 * characters/[id]/route.ts's own docstring: this backs "the 5 Creator
 * Studio builders (Brain / Knowledge / Voice / Appearance — Memory has
 * its own route)", plus the LoRA training / animate / export actions
 * from §11's Characters row. Import lives on the Studio hub instead of
 * here (it creates a new character, not edit an existing one).
 */
export default async function EditCharacterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [character, memories] = await Promise.all([
    getEditableCharacter(id),
    getCharacterMemories(id),
  ]);

  if (!character) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-6">
      <Link
        href="/studio"
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Studio
      </Link>

      <div className="flex items-center gap-4 mb-6">
        <div className="relative h-16 w-16 rounded-md overflow-hidden border border-border-hairline shrink-0">
          <Image src={resolveImageSrc(character.image_url)} alt={character.name} fill sizes="64px" className="object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl text-text-primary truncate">{character.name}</h1>
          <Link
            href={`/characters/${character.id}`}
            className="inline-flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300"
          >
            <Eye className="h-3.5 w-3.5" /> View public page
          </Link>
        </div>
        <VisibilityToggle
          characterId={character.id}
          isPublic={character.is_public}
          canGoPublic={character.moderation_status === "approved"}
        />
      </div>

      <div className="mb-6">
        <CharacterActions
          characterId={character.id}
          initialLoraStatus={character.lora_training_status}
          initialLoraError={character.lora_training_error}
          initialVideoStatus={character.video_status}
          initialVideoError={character.video_error}
        />
      </div>

      <Tabs defaultValue="builder">
        <TabsList>
          <TabsTrigger value="builder">Builder</TabsTrigger>
          <TabsTrigger value="memory">Memory ({memories.length})</TabsTrigger>
          <TabsTrigger value="gallery">Gallery ({character.gallery_image_urls?.length ?? 0})</TabsTrigger>
        </TabsList>
        <TabsContent value="builder" className="pt-2">
          <CharacterBuilderForm character={character} />
        </TabsContent>
        <TabsContent value="memory" className="pt-6">
          <MemoryBuilder characterId={character.id} initial={memories} />
        </TabsContent>
        <TabsContent value="gallery" className="pt-6">
          <ImageGalleryTab
            characterId={character.id}
            initialGalleryUrls={character.gallery_image_urls ?? []}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
