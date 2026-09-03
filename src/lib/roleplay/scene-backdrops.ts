/**
 * Story Mode — location backdrop themes
 *
 * RoleplayStage previously rendered every scenario on a flat `bg-base` —
 * the narrator prompt already varies per scenario (setting/tone/premise,
 * see prompt.ts), but nothing visual did. `roleplay_scenarios.cover_image_url`
 * exists in the schema for real art (admin-uploaded, via the same
 * resolveImageSrc/R2 path every other image on the site uses) but is NULL
 * on every seeded scenario today — nobody has uploaded any yet.
 *
 * Rather than ship a visually-flat scene until someone gets around to
 * uploading cover art, this is a CSS-only fallback: a per-slug gradient
 * tuned to that scene's setting/tone, using only existing design tokens
 * (gold scale + base/void, per the site's dark-glassmorphism language).
 * RoleplayStage prefers a real `cover_image_url` when one is set and only
 * falls back to this for scenarios that don't have one yet — so uploading
 * real art later is a pure upgrade, nothing to migrate away from.
 */
export interface SceneBackdrop {
  /** Tailwind gradient classes applied behind the whole stage. */
  gradient: string;
  /** Low-opacity radial tint layered on top for depth. */
  glow: string;
}

export const SCENE_BACKDROPS: Record<string, SceneBackdrop> = {
  "first-date": {
    gradient: "bg-gradient-to-b from-[#2a1a12] via-[#1a1210] to-black",
    glow: "bg-[radial-gradient(circle_at_50%_20%,rgb(var(--gold-500)/0.16),transparent_60%)]",
  },
  "late-night-talk": {
    gradient: "bg-gradient-to-b from-[#0d1220] via-[#0a0d14] to-black",
    glow: "bg-[radial-gradient(circle_at_50%_15%,rgba(120,140,220,0.10),transparent_55%)]",
  },
  jealousy: {
    gradient: "bg-gradient-to-b from-[#210f14] via-[#160c0f] to-black",
    glow: "bg-[radial-gradient(circle_at_50%_20%,rgba(210,60,90,0.14),transparent_55%)]",
  },
  "at-the-beach": {
    gradient: "bg-gradient-to-b from-[#152229] via-[#0e1a1f] to-black",
    glow: "bg-[radial-gradient(circle_at_50%_15%,rgb(var(--gold-400)/0.14),transparent_60%)]",
  },
};

export const DEFAULT_BACKDROP: SceneBackdrop = {
  gradient: "bg-gradient-to-b from-[#161616] via-[#0e0e0e] to-black",
  glow: "bg-[radial-gradient(circle_at_50%_15%,rgb(var(--gold-500)/0.10),transparent_55%)]",
};

export function getSceneBackdrop(slug: string | null | undefined): SceneBackdrop {
  if (!slug) return DEFAULT_BACKDROP;
  return SCENE_BACKDROPS[slug] ?? DEFAULT_BACKDROP;
}
