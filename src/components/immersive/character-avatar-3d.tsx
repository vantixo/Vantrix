"use client";

import { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import type { Group } from "three";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { getBodyTypeScale, getCharacterAppearanceColors } from "@/lib/characters/appearance-colors";

/**
 * PROCEDURAL 3D AVATAR — no real per-character .glb exists yet for
 * (effectively) any character (see public/models/README.md and
 * character-3d.tsx). Rather than every character with no model_url falling
 * straight through to the 2D LivingPortrait, this renders a stylized
 * low-poly 3D bust built from primitives (sphere head, hair cap, cone/
 * cylinder shoulders, eye dots) and colored from the character's *actual*
 * hair_color/eye_color/skin_tone/body_type fields (see
 * lib/characters/appearance-colors.ts) — so it's a real, data-driven,
 * per-character 3D presence today, not a generic placeholder shared by
 * every character the way the single Fox demo model would be.
 *
 * This is explicitly NOT a substitute for a real character likeness — it's
 * an abstract stylized form, not a face. It exists to give every character
 * *some* interactive 3D presence now, while a real image-to-3D generation
 * pipeline (lib/fal/character-3d-model.ts) fills in actual per-character
 * .glb models over time. character-portrait-viewer.tsx swaps this out for
 * the real Character3D the moment model_url is set — no call-site changes
 * needed when that happens, same reasoning as that component's own
 * docstring.
 *
 * INTERACTION MODEL: deliberately identical to Character3D and
 * LivingPortrait (see character-3d.tsx's own note on this) — idle only
 * while clicked/toggled-on or keyboard-focused, static correctly-lit first
 * frame at rest, prefers-reduced-motion checked before the render loop
 * ever starts. A character's behavior shouldn't depend on which of the
 * three tiers (real model / procedural avatar / 2D image) it happens to be
 * using right now.
 */

function ProceduralBust({
  hairColor,
  eyeColor,
  skinColor,
  shoulderScale,
  awake,
}: {
  hairColor: string;
  eyeColor: string;
  skinColor: string;
  shoulderScale: number;
  awake: boolean;
}) {
  const group = useRef<Group>(null);

  useFrame((_, delta) => {
    if (!awake || !group.current) return;
    group.current.rotation.y += delta * 0.35;
  });

  return (
    <group ref={group} position={[0, -0.15, 0]}>
      {/* Shoulders/torso */}
      <mesh position={[0, -0.55, 0]} scale={[shoulderScale, 1, shoulderScale]}>
        <coneGeometry args={[0.62, 1.05, 32, 1, true]} />
        <meshStandardMaterial color={skinColor} roughness={0.65} metalness={0.05} side={2} />
      </mesh>
      {/* Neck */}
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.16, 0.19, 0.28, 24]} />
        <meshStandardMaterial color={skinColor} roughness={0.65} metalness={0.05} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 0.42, 0]}>
        <sphereGeometry args={[0.36, 32, 32]} />
        <meshStandardMaterial color={skinColor} roughness={0.6} metalness={0.05} />
      </mesh>
      {/* Hair cap — slightly larger sphere, upper hemisphere only via scale+position trick */}
      <mesh position={[0, 0.5, -0.02]} scale={[1.04, 0.82, 1.04]}>
        <sphereGeometry args={[0.38, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
        <meshStandardMaterial color={hairColor} roughness={0.5} metalness={0.1} />
      </mesh>
      {/* Eyes */}
      <mesh position={[-0.13, 0.42, 0.32]}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshStandardMaterial color={eyeColor} roughness={0.3} />
      </mesh>
      <mesh position={[0.13, 0.42, 0.32]}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshStandardMaterial color={eyeColor} roughness={0.3} />
      </mesh>
    </group>
  );
}

export function CharacterAvatar3D({
  hairColor,
  eyeColor,
  skinColor,
  shoulderScale = 1,
  className,
  ariaLabel,
}: {
  hairColor: string;
  eyeColor: string;
  skinColor: string;
  shoulderScale?: number;
  className?: string;
  ariaLabel: string;
}) {
  const [awake, setAwake] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  return (
    <div
      className={cn("absolute inset-0 cursor-pointer select-none", className)}
      tabIndex={0}
      role="button"
      aria-pressed={awake}
      aria-label={`${ariaLabel} — tap or focus to animate`}
      onClick={() => setAwake((prev) => !prev)}
      onFocus={() => setAwake(true)}
      onBlur={() => setAwake(false)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setAwake((prev) => !prev);
        }
      }}
    >
      <Canvas
        camera={{ position: [0, 0.25, 2.2], fov: 32 }}
        dpr={[1, 1.75]}
        frameloop={shouldReduceMotion ? "demand" : "always"}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[2, 4, 3]} intensity={1.1} />
        <ProceduralBust
          hairColor={hairColor}
          eyeColor={eyeColor}
          skinColor={skinColor}
          shoulderScale={shoulderScale}
          awake={awake && !shouldReduceMotion}
        />
        <Environment preset="city" />
        <ContactShadows position={[0, -1.1, 0]} opacity={0.3} blur={2.5} far={2} />
      </Canvas>
    </div>
  );
}

/** Convenience wrapper: build the avatar directly from a character row's
 * appearance fields, so call sites don't need to import the color-mapping
 * helpers themselves. */
export function CharacterAvatar3DFromCharacter({
  character,
  className,
  ariaLabel,
}: {
  character: {
    hair_color?: string | null;
    eye_color?: string | null;
    skin_tone?: string | null;
    body_type?: string | null;
  };
  className?: string;
  ariaLabel: string;
}) {
  const colors = getCharacterAppearanceColors(character);
  const shoulderScale = getBodyTypeScale(character.body_type);

  return (
    <CharacterAvatar3D
      hairColor={colors.hair}
      eyeColor={colors.eye}
      skinColor={colors.skin}
      shoulderScale={shoulderScale}
      className={className}
      ariaLabel={ariaLabel}
    />
  );
}
