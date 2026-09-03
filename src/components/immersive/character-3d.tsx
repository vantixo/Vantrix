"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations, Environment, ContactShadows } from "@react-three/drei";
import type { Group } from "three";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Actual 3D character rendering — react-three-fiber + drei loading a real
 * .glb/.gltf per character (character.model_url, see the
 * 20261213_character_model_url.sql migration and character-portrait.tsx,
 * the entry point that decides 2D vs 3D and falls back for the ~all
 * characters that don't have a model yet).
 *
 * PLACEHOLDER ASSET: no character has real 3D art yet — see
 * public/models/README.md. This component itself has no knowledge of
 * that; it just renders whatever `src`/`animationClip` it's given, so
 * swapping in real per-character models later is a data change, not a
 * code change.
 *
 * SAME INTERACTION MODEL AS THE 2D PORTRAIT (living-portrait.tsx): the
 * character only moves — idle animation plays, the model does its slow
 * auto-rotate — while clicked/toggled-on or keyboard-focused. At rest it
 * renders a static, correctly-lit first frame, not a frozen mid-motion
 * pose (the animation mixer is paused, not just hidden). Keeping this
 * consistent with the 2D version matters more than either one being
 * "more impressive" on its own — a character shouldn't behave
 * differently depending on whether it happens to have a 3D asset yet.
 *
 * prefers-reduced-motion: checked before ever mounting the auto-rotate/
 * animation loop (not just capped in duration) — for a WebGL scene,
 * "reduced" should mean no continuous render loop, not a subtler one.
 */

function AnimatedModel({ url, awake, animationClip }: { url: string; awake: boolean; animationClip?: string }) {
  const group = useRef<Group>(null);
  const { scene, animations } = useGLTF(url);
  const { actions, names } = useAnimations(animations, group);

  const clipName = useMemo(() => {
    if (animationClip && names.includes(animationClip)) return animationClip;
    const idleMatch = names.find((n) => n.toLowerCase().includes("idle") || n.toLowerCase().includes("survey"));
    return idleMatch ?? names[0];
  }, [names, animationClip]);

  useEffect(() => {
    if (!clipName) return;
    const action = actions[clipName];
    action?.reset().play();
    return () => {
      action?.stop();
    };
  }, [actions, clipName]);

  useEffect(() => {
    const action = clipName ? actions[clipName] : undefined;
    if (!action) return;
    // Pause (not stop) so the model holds its current pose rather than
    // snapping back to frame 0 every time focus/click toggles off.
    action.paused = !awake;
  }, [awake, actions, clipName]);

  useFrame((_, delta) => {
    if (!awake || !group.current) return;
    group.current.rotation.y += delta * 0.35;
  });

  return <primitive ref={group} object={scene} />;
}

function SceneFallback() {
  // Suspense fallback rendered *inside* the Canvas while the model
  // downloads/parses — kept to a bare ambient light (no geometry) so
  // there's nothing to pop/flash in once the real model resolves.
  return <ambientLight intensity={0.4} />;
}

export function Character3D({
  src,
  animationClip,
  className,
  ariaLabel,
}: {
  src: string;
  /** Named clip to prefer as the idle loop; falls back to an Idle/Survey-named clip, then the first clip. */
  animationClip?: string;
  className?: string;
  ariaLabel: string;
}) {
  const [awake, setAwake] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  return (
    <div
      // absolute inset-0, matching next/image's `fill` prop that
      // LivingPortrait uses — this needs to overlay the same
      // relative/aspect-ratio container CharacterHero already sets up,
      // not just fill it in normal flow.
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
        camera={{ position: [0, 1.1, 3.2], fov: 32 }}
        dpr={[1, 1.75]}
        // No continuous render loop for reduced-motion users — "demand"
        // frameloop only re-renders on prop/state changes, not every tick,
        // which also means useFrame's auto-rotate above simply never
        // fires (frameloop=never would need manual invalidate() calls
        // instead, so "demand" is the correct middle ground here).
        frameloop={shouldReduceMotion ? "demand" : "always"}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 4, 3]} intensity={1.1} />
        <Suspense fallback={<SceneFallback />}>
          <AnimatedModel url={src} awake={awake && !shouldReduceMotion} animationClip={animationClip} />
          <Environment preset="city" />
          <ContactShadows position={[0, -1, 0]} opacity={0.35} blur={2.5} far={2} />
        </Suspense>
      </Canvas>
    </div>
  );
}
