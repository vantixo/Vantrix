"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { LivingPortrait } from "./living-portrait";
import { Character3DErrorBoundary } from "./character-3d-error-boundary";

// BUILD-OPT: Character3D and CharacterAvatar3DFromCharacter pull in
// @react-three/fiber + @react-three/drei + three — one of the heaviest
// dependency trees in this app (drei alone exports 100+ named helpers;
// see next.config.js's optimizePackageImports comment for the same
// point about barrel-evaluation cost). They were previously static
// top-of-file imports, meaning that bundle was included directly in
// this route's initial client JS — and since the CharacterAvatar3D tier
// below renders for "effectively every character" (no character has a
// real model_url yet, per character-avatar-3d.tsx's own header), that
// cost was being paid on nearly every character-page and landing-page
// load, on the critical path, even before anything WebGL-related had
// actually mounted.
//
// next/dynamic + ssr:false splits both into their own chunk, fetched in
// parallel rather than blocking initial parse/eval of this route's main
// bundle, and never sent to the server render at all (react-three-fiber's
// <Canvas> isn't SSR-safe regardless). The existing <Suspense fallback>
// below already covers the loading gap — the fallback (2D LivingPortrait)
// is what's shown until the chunk arrives, same UX contract as before,
// just no longer paid for on every route that merely CAN show a 3D tier.
const Character3D = dynamic(
  () => import("./character-3d").then((m) => m.Character3D),
  { ssr: false },
);
const CharacterAvatar3DFromCharacter = dynamic(
  () => import("./character-avatar-3d").then((m) => m.CharacterAvatar3DFromCharacter),
  { ssr: false },
);

/**
 * Single entry point for "the character's portrait" — CharacterHero and
 * the landing page's featured portrait both render this instead of
 * choosing between LivingPortrait/Character3D/CharacterAvatar3D
 * themselves. That choice lives in exactly one place so it changes in
 * exactly one place: today it's "does this character have a model_url,
 * then does it have appearance data", tomorrow it could be a user/device
 * capability check (low-end device, data-saver) without touching either
 * call site.
 *
 * Named *Viewer, not CharacterPortrait, to avoid colliding with
 * landing-page.tsx's existing local `CharacterPortrait` (the gradient +
 * name + presence card wrapping the featured character — a different,
 * higher-level thing that will itself render this component).
 *
 * THREE TIERS, cheapest-fidelity-fallback-first:
 *  1. model_url set → real per-character Character3D (.glb from the
 *     image-to-3D pipeline, see lib/fal/character-3d-model.ts). Best case,
 *     effectively no character has this yet.
 *  2. model_url null but appearance fields present → CharacterAvatar3D, a
 *     procedural, data-driven (real hair_color/eye_color/skin_tone/
 *     body_type) stylized 3D bust — see character-avatar-3d.tsx for why
 *     this exists instead of just falling straight to 2D. Still an
 *     abstract form, not a likeness.
 *  3. Neither → 2D LivingPortrait, the original fallback and the one
 *     every character effectively used before this tier existed.
 * Each tier's failure/loading state degrades to the next-cheapest one,
 * never below the 2D image: the 3D path is wrapped in both Suspense (the
 * model is downloading) and Character3DErrorBoundary (the model failed to
 * load), and the procedural avatar — being pure geometry with no network
 * fetch — has nothing to suspend or fail on in the first place.
 */
export function CharacterPortraitViewer({
  modelUrl,
  imageSrc,
  alt,
  sizes,
  priority,
  className,
  appearance,
}: {
  modelUrl: string | null;
  imageSrc: string;
  alt: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
  /** hair_color/eye_color/skin_tone/body_type — drives the procedural 3D
   * avatar tier when there's no real model_url yet. Omit to skip straight
   * to the 2D fallback (e.g. call sites that don't have these columns
   * selected). */
  appearance?: {
    hair_color?: string | null;
    eye_color?: string | null;
    skin_tone?: string | null;
    body_type?: string | null;
  };
}) {
  const fallback = (
    <LivingPortrait src={imageSrc} alt={alt} sizes={sizes} priority={priority} className={className} />
  );

  if (modelUrl) {
    return (
      <Character3DErrorBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <Character3D src={modelUrl} ariaLabel={alt} className={className} />
        </Suspense>
      </Character3DErrorBoundary>
    );
  }

  if (appearance) {
    // ROOT-CAUSE FIX (2026-09-03): this tier was the one real gap in the
    // "never below 2D" contract described above — Character3D (tier 1)
    // was already wrapped in Character3DErrorBoundary, but this
    // procedural-avatar tier (tier 2, the one that actually renders for
    // effectively every character today, since ~none have model_url yet)
    // mounted react-three-fiber's <Canvas> completely unguarded. Any
    // failure inside the r3f/react-reconciler render tree — most
    // concretely, react-reconciler@^0.27.0 (what @react-three/fiber@8.x
    // itself depends on) throwing "Cannot read properties of undefined
    // (reading 'ReactCurrentBatchConfig')" against React 18.3.1's
    // internals shape — had no boundary to catch it, so it propagated
    // straight past this component, past CharacterHero, past the
    // /characters/[id] page, up to the route's error.tsx: "This page
    // couldn't load," on literally every character detail view and
    // every landing-page featured portrait (this component's only two
    // callers). Reusing the same boundary+fallback tier 1 already had
    // closes the gap: any runtime failure here — the reconciler
    // incompatibility, a missing/blocked WebGL context, anything else —
    // now degrades to the 2D portrait instead of taking down the page.
    // See package.json's new `overrides["react-reconciler"]` for the
    // actual fix to the underlying incompatibility so the 3D avatar
    // renders instead of falling back; this boundary is the backstop
    // that makes the page unbreakable either way.
    return (
      <Character3DErrorBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <CharacterAvatar3DFromCharacter character={appearance} ariaLabel={alt} className={className} />
        </Suspense>
      </Character3DErrorBoundary>
    );
  }

  return fallback;
}
