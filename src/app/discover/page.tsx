import type { Metadata } from "next";
import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { getDiscoverHome } from "@/lib/frontend/discover";
import { resolveImageSrc } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PublicHeader } from "@/components/public/public-header";

/**
 * ROUTING-FIX (0.1/0.3.2/1.1): vercel /home, the SEO landing CTA, the
 * registration reminder, and structured-data search URLs all pointed at
 * "/discover" — which was never an actual App Router page, only
 * /api/discover. This page closes that gap using the existing
 * getDiscoverHome() Server Component helper (@/lib/frontend/discover),
 * which already wraps GET /api/discover/featured and fails soft to an
 * empty-but-valid shape.
 *
 * Works for logged-out visitors: /api/discover/featured never requires a
 * session (its NSFW gate already excludes is_nsfw content for anyone who
 * isn't age-verified + opted in — see resolveNsfwDiscoveryAccess()), so
 * this is safe as the top of the public acquisition funnel
 * (landing → /discover → character → signup) described in the audit.
 *
 * PERF FIX (2026-09-03): was `force-dynamic`, meaning every visitor —
 * including every crawler/bot hit on this SEO landing page, per its own
 * purpose above — paid a full fresh server render + getDiscoverHome()
 * round-trip with zero caching. Nothing on this page is session- or
 * cookie-scoped (DiscoverCharacter has no per-user fields — like_count/
 * follower_count are global stats, not "did I like this"; confirmed via
 * lib/frontend/discover.ts), and this route sits outside the (app) route
 * group, so — unlike /world, /chats, etc. — it doesn't inherit a
 * session-checking parent layout that would force dynamic rendering
 * regardless of this export. Switched to ISR: same content served from
 * cache for up to 2 minutes instead of hitting the DB/API on every
 * request, then revalidated in the background. 2 minutes balances real
 * cache benefit against the "New"/featured-rotation badges and `is_live`
 * status not being instantaneous — acceptable staleness for a discovery
 * landing page, not for anything session-scoped.
 */
export const revalidate = 120;

export const metadata: Metadata = {
  title: "Discover AI Companions | Vantrix",
  description:
    "Browse Vantrix's AI companions — each with their own personality, memory, and story. Start a conversation free, no card required.",
};

export default async function DiscoverPage() {
  const { featured, allCharacters } = await getDiscoverHome();
  const hero = featured[0];

  return (
    <div className="min-h-screen bg-base">
      <PublicHeader />

      <section className="px-4 md:px-8 pt-14 pb-10 text-center max-w-2xl mx-auto">
        <h1 className="font-display text-3xl md:text-4xl tracking-tight text-text-primary">
          Meet your next companion.
        </h1>
        <p className="mt-4 text-text-secondary text-[15px] leading-relaxed">
          Every character on Vantrix remembers your conversations and grows
          with you. Pick someone who fits your mood — chatting is free to
          start.
        </p>
        <Button asChild size="md" className="mt-7">
          <Link href="/login?mode=sign-up">Start free</Link>
        </Button>
      </section>

      {hero && (
        <section className="px-4 md:px-8 pb-10">
          <div className="max-w-5xl mx-auto rounded-lg overflow-hidden border border-border-hairline relative aspect-[16/7] hidden md:block">
            <Image
              src={resolveImageSrc(hero.image)}
              alt={hero.title}
              fill
              sizes="1024px"
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent flex flex-col justify-end p-8">
              <span className="text-xs uppercase tracking-wide text-gold-400 font-semibold">
                {hero.badge}
              </span>
              <h2 className="font-display text-2xl text-white mt-1">
                {hero.title}
              </h2>
              <p className="text-white/70 text-sm mt-1 max-w-md">
                {hero.subtitle}
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="px-4 md:px-8 pb-20 max-w-5xl mx-auto">
        <h2 className="font-display text-lg text-text-primary mb-4">
          Popular companions
        </h2>
        {allCharacters.length === 0 ? (
          <p className="text-text-secondary text-sm">
            New companions are on the way — check back soon.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {allCharacters.slice(0, 24).map((c) => (
              <Link
                key={c.id}
                href={`/login?mode=sign-up&redirect=${encodeURIComponent(`/characters/${c.id}`)}`}
                className="group rounded-md overflow-hidden border border-border-hairline"
              >
                <div className="relative aspect-[3/4]">
                  <Image
                    src={resolveImageSrc(c.image_url)}
                    alt={c.name}
                    fill
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="object-cover transition-transform ease-premium duration-200 group-hover:scale-[1.03]"
                  />
                </div>
                <div className="p-2.5">
                  <p className="text-sm font-semibold text-text-primary truncate">
                    {c.name}
                    {c.age ? (
                      <span className="text-text-secondary font-normal">
                        {" "}
                        · {c.age}
                      </span>
                    ) : null}
                  </p>
                  {c.archetype && (
                    <p className="text-xs text-text-secondary truncate mt-0.5">
                      {c.archetype}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
