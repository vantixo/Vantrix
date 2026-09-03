import { CharacterSectionTransition } from "@/components/immersive/page-transition";

/**
 * Scopes the advanced cinematic transition (blur+scale crossfade) to
 * navigation *within* /characters — browse ↔ detail, detail ↔ detail —
 * without touching any other section of the app. See
 * page-transition.tsx for why this needs to be a persistent layout
 * rather than a per-route template, and why it isn't hoisted onto
 * (app)/layout.tsx instead.
 */
export default function CharactersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CharacterSectionTransition>{children}</CharacterSectionTransition>;
}
