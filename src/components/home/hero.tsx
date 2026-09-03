import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Button } from "@/components/ui/button";
import { resolveImageSrc } from "@/lib/utils";
import { HeroCarousel } from "./hero-carousel";
import type { DiscoverFeaturedItem } from "@/lib/frontend/discover";

/**
 * §3.1 Hero. Desktop: eyebrow tag, headline with one gold accent phrase,
 * subtext, two CTAs, large portrait right. Mobile: single-CTA carousel
 * (HeroCarousel) replaces the static portrait — the directive calls
 * these out as two distinct layouts, not one made responsive, so this
 * component picks between them with plain `hidden md:*` rather than
 * trying to reflow one markup tree into both.
 */
export function Hero({ featured }: { featured: DiscoverFeaturedItem[] }) {
  const portrait = featured[0];

  return (
    <section className="px-4 md:px-8 pt-8 md:pt-12">
      <div className="hidden md:grid grid-cols-2 gap-12 items-center max-w-7xl mx-auto">
        <div>
          <span className="inline-block text-xs font-bold tracking-[0.2em] uppercase text-gold-500 mb-4">
            AI Companions
          </span>
          <h1 className="font-display text-5xl leading-[1.05] text-text-primary">
            <span className="text-gold-400">Create your AI Companion</span>
            <br />
            and never talk alone again
          </h1>
          <p className="text-text-secondary text-lg mt-5 max-w-md">
            Design a companion who remembers you, grows with you, and lives
            in a world that keeps moving even when you&rsquo;re away.
          </p>
          <div className="flex items-center gap-3 mt-8">
            <Button asChild size="lg">
              <Link href="/studio">Create Now</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/characters">Explore Companions</Link>
            </Button>
          </div>
        </div>

        <div className="relative aspect-[4/5] rounded-lg overflow-hidden border border-border-hairline shadow-card">
          <Image
            src={resolveImageSrc(portrait?.image)}
            alt={portrait?.title ?? "Featured companion"}
            fill
            sizes="(min-width: 768px) 40vw, 0vw"
            priority
            className="object-cover"
          />
          <div
            className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent"
            aria-hidden
          />
        </div>
      </div>

      <div className="md:hidden">
        <span className="inline-block text-xs font-bold tracking-[0.2em] uppercase text-gold-500 mb-3">
          AI Companions
        </span>
        <h1 className="font-display text-3xl leading-[1.1] text-text-primary mb-4">
          <span className="text-gold-400">Create your AI Companion</span> and
          never talk alone again
        </h1>

        <HeroCarousel items={featured} />

        <Button asChild size="lg" className="w-full mt-4">
          <Link href="/studio">Create Now</Link>
        </Button>
      </div>
    </section>
  );
}
