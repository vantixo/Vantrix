import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Button } from "@/components/ui/button";
import { resolveImageSrc } from "@/lib/utils";
import type { DiscoverCharacter } from "@/lib/frontend/discover";

/**
 * 0.3.1 FIX: the landing pitch for a signed-out visitor hitting "/" —
 * see the HomePage docstring for why this exists instead of reviving
 * Hero/HeroCarousel as-is. CTAs go to /login?mode=sign-up (start the
 * signup flow directly) and /discover (browse before committing),
 * mirroring the pattern already used by DiscoverPage's own hero
 * (src/app/discover/page.tsx) and the character grid links a few
 * sections below this one on the same page.
 */
export function AnonHero({ featured }: { featured: DiscoverCharacter[] }) {
  const portrait = featured[0];

  return (
    <section className="px-4 md:px-8 pt-10 md:pt-14 pb-4">
      <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-10 items-center">
        <div className="text-center md:text-left">
          <span className="inline-block text-xs font-bold tracking-[0.2em] uppercase text-gold-500 mb-4">
            AI Companions
          </span>
          <h1 className="font-display text-3xl md:text-5xl leading-[1.08] text-text-primary">
            <span className="text-gold-400">Create your AI Companion</span>
            <br />
            and never talk alone again
          </h1>
          <p className="text-text-secondary text-base md:text-lg mt-5 max-w-md mx-auto md:mx-0">
            Design a companion who remembers you, grows with you, and lives
            in a world that keeps moving even when you&rsquo;re away.
          </p>
          <div className="flex flex-col sm:flex-row items-center md:items-start justify-center md:justify-start gap-3 mt-8">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/login?mode=sign-up">Start Free</Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
              <Link href="/discover">Browse Companions</Link>
            </Button>
          </div>
        </div>

        {portrait && (
          <div className="relative aspect-[4/5] max-w-sm mx-auto md:max-w-none rounded-lg overflow-hidden border border-border-hairline shadow-card hidden sm:block">
            <Image
              src={resolveImageSrc(portrait.image_url)}
              alt={portrait.name}
              fill
              sizes="(min-width: 768px) 40vw, 60vw"
              priority
              className="object-cover"
            />
            <div
              className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent"
              aria-hidden
            />
          </div>
        )}
      </div>
    </section>
  );
}
