import { cn } from "@/lib/utils";

/**
 * UX AUDIT FIX (item 4): the app had zero loading.tsx files anywhere, so
 * every server-rendered page showed a blank screen for the duration of
 * its data fetch. tailwind.config.ts already defines a `shimmer`
 * keyframe/animation for exactly this purpose — it just had no consumer
 * yet. Kept to a translucent white overlay rather than a new bg color,
 * per §1 ("one background value everywhere"): this is a transient
 * placeholder element, not a surface panel.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-sm bg-gradient-to-r from-white/[0.04] via-white/[0.09] to-white/[0.04] bg-[length:200%_100%] animate-shimmer",
        className
      )}
    />
  );
}
