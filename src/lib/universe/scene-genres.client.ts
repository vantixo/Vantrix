/**
 * Client-safe mirror of SCENE_GENRES from `scene-composer.ts`.
 *
 * Not re-exported from that file directly because it pulls in
 * `supabaseAdmin`, `lora-pipeline`, and `video-router` — all server-only —
 * which would drag the whole server generation pipeline into the client
 * bundle for the sake of one string array. Genre values/order must stay in
 * sync with `SCENE_GENRES` in `src/lib/universe/scene-composer.ts`; the
 * backend route is the source of truth and validates against its own copy,
 * so a drift here only affects the picker's options, not correctness.
 */
export const SCENE_GENRES_CLIENT = [
  "noir-thriller",
  "high-fantasy",
  "cyberpunk",
  "romance",
  "slice-of-life",
  "horror",
  "heist",
  "political-drama",
  "festival-celebration",
  "war-and-conflict",
] as const;

export type SceneGenreClient = (typeof SCENE_GENRES_CLIENT)[number];

export function formatGenreLabel(genre: string): string {
  return genre
    .split("-")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}
