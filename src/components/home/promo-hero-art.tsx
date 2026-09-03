/**
 * Code-rendered hero promo art.
 *
 * Replaces the old JPG hero banners (public/promos/*.jpg, 200KB-1MB each)
 * with pure SVG/CSS. Same gold-on-black brand language as the poster
 * mockups this was built from (gold V-diamond mark, serif display
 * headline, thin gold rule, small-caps tagline) but shipped as ~1-2KB of
 * markup instead of a downloaded photo — no network request, no LCP
 * image decode, scales crisper on retina/zoom than any raster export
 * could, and it's themeable via the existing --gold-* CSS vars instead
 * of being baked into pixels.
 *
 * Used by HeroAdsCarousel: an `ads.image_url` of `code:<slug>` (see the
 * 20261215_seed_code_promo_ads.sql migration) renders one of these
 * instead of <Image>. Add a new poster concept by adding a slug here and
 * an `ads` row pointing at `code:<slug>` — no new asset file, no image
 * optimization step, nothing to upload.
 */
import type { CSSProperties } from "react";

export type PromoHeroSlug =
  | "meet-your-characters"
  | "universe-connections"
  | "step-into-the-world"
  | "your-story-your-choices"
  | "find-your-match"
  | "create-evolve-legendary";

interface PromoCopy {
  eyebrow?: string;
  title: string[];
  tagline: string;
}

const COPY: Record<PromoHeroSlug, PromoCopy> = {
  "meet-your-characters": {
    title: ["Meet Your", "Characters"],
    tagline: "Every personality. Every story.",
  },
  "universe-connections": {
    title: ["One Universe.", "Endless Connections."],
    tagline: "Worlds to explore. People to meet.",
  },
  "step-into-the-world": {
    title: ["Step Into", "The World"],
    tagline: "Locations to explore. Stories to uncover.",
  },
  "your-story-your-choices": {
    title: ["Your Story.", "Your Choices."],
    tagline: "Branching scenes shaped by you.",
  },
  "find-your-match": {
    title: ["Find Your", "Match"],
    tagline: "Real chemistry. Real choices.",
  },
  "create-evolve-legendary": {
    title: ["Create. Evolve.", "Become Legendary."],
    tagline: "Build a character people actually want to meet.",
  },
};

/** Gold V-diamond mark — same silhouette across every poster mockup. */
function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * 0.9}
      viewBox="0 0 40 36"
      fill="none"
      aria-hidden
      className="drop-shadow-[0_0_6px_rgb(var(--gold-500)/0.35)]"
    >
      <path
        d="M20 2 L36 12 L28 34 L20 22 L12 34 L4 12 Z"
        stroke="rgb(var(--gold-500))"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M20 2 L20 22" stroke="rgb(var(--gold-500))" strokeWidth="1.2" />
    </svg>
  );
}

function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden fill="rgb(var(--gold-500))">
      <path d="M8 0 L9.3 6.7 L16 8 L9.3 9.3 L8 16 L6.7 9.3 L0 8 L6.7 6.7 Z" />
    </svg>
  );
}

/** Faint procedural "spires" silhouette used as texture on a couple of variants — pure vector, no imagery. */
function SkylineTexture() {
  const spires = [8, 22, 14, 30, 18, 26, 12, 34, 20, 10];
  return (
    <svg
      viewBox="0 0 400 60"
      preserveAspectRatio="none"
      className="absolute inset-x-0 bottom-0 h-1/3 w-full opacity-[0.18]"
      aria-hidden
    >
      {spires.map((h, i) => (
        <rect
          key={i}
          x={i * 40}
          y={60 - h}
          width="30"
          height={h}
          fill="rgb(var(--gold-500))"
        />
      ))}
    </svg>
  );
}

const FRAME: CSSProperties = {
  background:
    "radial-gradient(ellipse 120% 90% at 50% 0%, rgb(var(--gold-900) / 0.35), transparent 60%), linear-gradient(180deg, #0a0a0c 0%, #050505 100%)",
};

export function PromoHeroArt({
  slug,
  className = "",
}: {
  slug: PromoHeroSlug;
  className?: string;
}) {
  const copy = COPY[slug];
  const showSkyline = slug === "step-into-the-world" || slug === "universe-connections";

  return (
    <div
      className={`relative h-full w-full overflow-hidden ${className}`}
      style={FRAME}
    >
      {/* gold frame, matches the poster mockups' border treatment */}
      <div className="pointer-events-none absolute inset-2 rounded-sm border border-gold-500/30 md:inset-4" />
      {showSkyline && <SkylineTexture />}

      <div className="relative flex h-full flex-col items-center justify-center gap-3 px-6 text-center md:gap-4">
        <BrandMark />

        <h3 className="font-display text-2xl leading-tight tracking-wide text-text-primary md:text-4xl lg:text-5xl">
          {copy.title.map((line, i) => (
            <span key={i} className="block">
              {i === copy.title.length - 1 ? (
                <span className="text-gold-400">{line}</span>
              ) : (
                line
              )}
            </span>
          ))}
        </h3>

        <div className="flex items-center gap-2 text-gold-500/70">
          <span className="h-px w-8 bg-gold-500/40" />
          <Sparkle className="h-2.5 w-2.5" />
          <span className="h-px w-8 bg-gold-500/40" />
        </div>

        <p className="max-w-xs text-xs uppercase tracking-[0.15em] text-text-secondary md:text-sm">
          {copy.tagline}
        </p>
      </div>
    </div>
  );
}

export function isPromoHeroCode(imageUrl: string): imageUrl is `code:${PromoHeroSlug}` {
  return imageUrl.startsWith("code:") && imageUrl.slice(5) in COPY;
}

export function promoHeroSlugFrom(imageUrl: string): PromoHeroSlug {
  return imageUrl.slice(5) as PromoHeroSlug;
}
