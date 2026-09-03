import { cn } from "@/lib/utils";

/**
 * Atmospheric backdrop for immersive surfaces (character hero, profile
 * page) — Phase 1 Immersive UI Upgrade §12: "CSS atmospheric background,
 * subtle particles ... gradient lighting" instead of an expensive 3D/GPU
 * layer (§3: "do not introduce dedicated GPU servers ... continuous
 * character simulation").
 *
 * Pure CSS, server-rendered, zero client JS:
 *  - two soft radial glows built from the *active theme's* own
 *    --gold-* CSS variables (not hardcoded hex), so this re-skins itself
 *    under data-theme="nova"/"velvet" exactly like the rest of the app —
 *    see globals.css's theming note. No new color language introduced.
 *  - a sparse, fixed-position particle field (not Math.random() — fixed
 *    values keep server/client output byte-identical, and cost nothing
 *    to compute).
 * Directive §1 / spec §4 restraint rule applies: glows sit at low opacity
 * behind content, never a solid fill, and intensity="subtle" exists for
 * surfaces where even that should recede further (e.g. behind readable
 * body text).
 *
 * SCOPE NOTE (revisit pass): this is a singular-hero primitive — one per
 * page (character detail hero, a future homepage hero). Do not mount one
 * per card inside a scroll row or grid (Featured Companions, Explore
 * Characters, etc. render 12-24 CompanionCards at once): even at this
 * component's low real cost, 24 stacked instances of 2 blurred gradient
 * layers + 8 particles each is 24x the paint work for something that
 * reads identically at card scale anyway. Spec §8 already scopes cards to
 * "subtle hover/touch animation... no excessive animation" — CardCard's
 * existing hover treatment is the right amount of motion for a grid;
 * this component is for the one or two moments per page that should feel
 * cinematic, not for repeating tiles.
 *
 * Animation is plain CSS `animation`, so it's already covered by the
 * global `prefers-reduced-motion` kill switch in globals.css
 * (animation-duration: 0.01ms !important) — no extra media query needed
 * in this file.
 */

const PARTICLES = [
  { top: "12%", left: "18%", size: 3, delay: "0s", duration: "9s" },
  { top: "22%", left: "76%", size: 2, delay: "1.2s", duration: "11s" },
  { top: "38%", left: "8%", size: 2, delay: "2.4s", duration: "8s" },
  { top: "54%", left: "88%", size: 3, delay: "0.6s", duration: "10s" },
  { top: "64%", left: "30%", size: 2, delay: "3.1s", duration: "12s" },
  { top: "74%", left: "62%", size: 3, delay: "1.8s", duration: "9.5s" },
  { top: "84%", left: "14%", size: 2, delay: "2.9s", duration: "10.5s" },
  { top: "18%", left: "50%", size: 2, delay: "0.9s", duration: "11.5s" },
] as const;

const INTENSITY = {
  subtle: { glow: "0.08", particles: false },
  default: { glow: "0.14", particles: true },
  premium: { glow: "0.2", particles: true },
} as const;

export function CinematicBackground({
  className,
  intensity = "default",
}: {
  className?: string;
  intensity?: keyof typeof INTENSITY;
}) {
  const cfg = INTENSITY[intensity];

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <div
        className="absolute -top-1/4 left-1/2 h-[70%] w-[70%] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, rgb(var(--gold-500) / ${cfg.glow}) 0%, transparent 70%)` }}
      />
      <div
        className="absolute bottom-0 right-0 h-[55%] w-[55%] translate-x-1/4 translate-y-1/4 rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, rgb(var(--gold-700) / ${cfg.glow}) 0%, transparent 70%)` }}
      />
      {cfg.particles &&
        PARTICLES.map((p, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-gold-300/40 animate-pulse"
            style={{
              top: p.top,
              left: p.left,
              width: p.size,
              height: p.size,
              animationDelay: p.delay,
              animationDuration: p.duration,
            }}
          />
        ))}
      <div className="absolute inset-0 bg-gradient-to-t from-base via-transparent to-transparent" />
    </div>
  );
}
