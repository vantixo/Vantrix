import type { CharacterDraft, StageId } from "./types";

/**
 * Per-stage completeness — pure function, easy to test, no side effects.
 * Each stage is "done" once its load-bearing fields are filled; optional
 * flourishes (secrets, friends, daily routine…) don't gate the checkmark,
 * matching how forgiving the doc's own "readiness" meter is meant to feel
 * — a creator shouldn't be blocked from Preview by an empty "friends" tag
 * list.
 */
export function stageComplete(draft: CharacterDraft, stage: StageId): boolean {
  switch (stage) {
    case "concept":
      return draft.description.trim().length > 0;
    case "identity":
      return draft.name.trim().length > 0 && draft.description.trim().length >= 10;
    case "personality":
      return draft.personality.trim().length > 0 || draft.archetype.trim().length > 0;
    case "psychology":
      return draft.backstory.trim().length > 0;
    case "voice":
      return draft.speech_style.trim().length > 0;
    case "appearance":
      return !!draft.imageUrl;
    case "memory":
      return draft.memories.length > 0;
    case "preview":
      return false; // never "done" on its own — it's the destination, not a fillable stage
    default:
      return false;
  }
}

/** Overall completeness 0-100, weighted evenly across the 7 fillable stages (Preview excluded). */
export function overallCompleteness(draft: CharacterDraft): number {
  const fillable: StageId[] = ["concept", "identity", "personality", "psychology", "voice", "appearance", "memory"];
  const done = fillable.filter((s) => stageComplete(draft, s)).length;
  return Math.round((done / fillable.length) * 100);
}

/** True once the two hard requirements for actually creating the character are met. */
export function canPublish(draft: CharacterDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.description.trim().length >= 10 &&
    !!draft.imageUrl
  );
}
