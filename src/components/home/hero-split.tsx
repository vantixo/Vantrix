import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { ArrowRight, Heart, Flame } from "lucide-react";
import { cn, resolveImageSrc, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { HomeContextChat, HomeContextInitiative } from "@/lib/frontend/home-context";
import type { HomeHeroStreak, HomeHeroTopMatch } from "@/lib/frontend/home-hero";
import { CinematicBackground } from "@/components/immersive/cinematic-background";
import { MotionWrapper } from "@/components/immersive/motion-wrapper";
import { cinematicReveal } from "@/components/immersive/motion";

interface Featured {
  name: string;
  image: string | null;
  eyebrow: string;
  quote: string | null;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string | null;
  meta: string | null;
}

/**
 * Priority is initiative-first: a character who's actually reached out
 * is a stronger, truer "pick this back up" prompt than the most recently
 * touched conversation, and it's the same priority order home-context's
 * own urgency sort already implies. Falls back to the most recent
 * conversation when there's no pending initiative.
 */
function resolveFeatured(
  initiative: HomeContextInitiative | null,
  chats: HomeContextChat[]
): Featured | null {
  if (initiative) {
    return {
      name: initiative.character.name,
      image: initiative.character.image_url,
      eyebrow: "Someone's thinking of you",
      quote: initiative.message,
      primaryHref: `/characters/${initiative.character.id}`,
      primaryLabel: `Reply to ${initiative.character.name}`,
      secondaryHref: null,
      meta: null,
    };
  }

  const chat = chats[0];
  if (chat?.character.id) {
    return {
      name: chat.character.name ?? "Companion",
      image: chat.character.image_url ?? null,
      eyebrow: "Continue your story",
      quote: chat.character.opening_line ?? null,
      primaryHref: `/chat/${chat.conversationId}`,
      primaryLabel: "Continue conversation",
      secondaryHref: `/characters/${chat.character.id}`,
      meta: chat.lastMessageAt ? `Last message ${timeAgo(chat.lastMessageAt)}` : null,
    };
  }

  return null;
}

const MATCH_TIER_LABEL: Record<string, string> = {
  spark: "Spark",
  flame: "Flame",
  deep: "Deep bond",
  soulmate: "Soulmate",
};

/**
 * Reference-image parity: the signature hero-split block — a large
 * "continue your story" card (left) beside a two-widget side stack
 * ("Tonight's match" / "Streak").
 *
 * REPLACES-FIX: supersedes ContinueYourStories + HomeSideRail's "someone
 * is thinking about you" widget on Home (both left in place, unused by
 * this page, in case their grid/tri-avatar layouts are wanted elsewhere
 * — same precedent as Hero/HeroCarousel in hero.tsx). This does
 * everything they did with strictly more real data behind it: the
 * initiative's actual message as a quote instead of just a name+reason
 * string, plus two widgets (Tonight's Match, Streak) neither component
 * had. `chats`/`initiative` are the same getHomeContext() rows those two
 * components already consumed — no new fetch on their side.
 *
 * Each of the three pieces (featured card, Tonight's Match, Streak)
 * degrades independently — a user with a streak but no matches yet still
 * gets that one widget, not an empty gap. The whole section renders
 * nothing only when all three are empty (a genuinely fresh account),
 * same "no dead sections" contract as every other Home component.
 *
 * IMMERSIVE-UI-PHASE-1 (Home hero pass): the featured card is this
 * page's one hero-level moment — same role CharacterHero plays on the
 * character detail page — so it gets that same CinematicBackground +
 * MotionWrapper(cinematicReveal) treatment, and nothing else on this page
 * does (spec §3/§18 restraint: one or two cinematic moments per page, not
 * every card — see cinematic-background.tsx's own SCOPE NOTE). Tonight's
 * Match / Streak stay as they were; they're compact utility widgets, not
 * the cinematic moment.
 */
export function HeroSplit({
  initiative,
  chats,
  topMatch,
  streak,
}: {
  initiative: HomeContextInitiative | null;
  chats: HomeContextChat[];
  topMatch: HomeHeroTopMatch | null;
  streak: HomeHeroStreak | null;
}) {
  const featured = resolveFeatured(initiative, chats);

  // EMPTY-HOME-HERO FIX: a brand-new account (no conversations, no
  // initiative, no matches, no streak) hit the `return null` below and
  // got a bare gap where the hero normally sits — the single most
  // prominent image on the page, missing for exactly the audience (a
  // first-time visitor) who most needs a visual hook before they've
  // generated any content of their own. Falls back to a static discovery
  // banner with the same card treatment as the real featured card, so
  // Home never opens on a dead, imageless section.
  if (!featured && !topMatch && !streak) {
    return (
      <section className="px-4 md:px-8 pt-6 md:pt-8">
        <div className="max-w-7xl mx-auto">
          <div className="relative overflow-hidden rounded-lg border border-border-hairline shadow-card min-h-[280px] md:min-h-[340px]">
            <Image
              src="/images/characters/astra-nocturne-gallery-1.jpg"
              alt=""
              fill
              sizes="100vw"
              quality={70}
              priority
              className="object-cover object-[center_22%]"
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/40 to-transparent"
              aria-hidden
            />
            <div className="relative z-10 h-full flex flex-col justify-end p-6 md:p-8">
              <p className="text-[11px] font-extrabold tracking-[0.1em] uppercase text-gold-400 mb-2">
                Welcome to Vantrix
              </p>
              <h2 className="font-display italic text-3xl md:text-[44px] leading-none text-text-primary mb-3 max-w-md">
                Your first companion is waiting.
              </h2>
                <div className="flex flex-wrap items-center gap-3">
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link href="/characters" className="gap-2">
                    Explore characters
                    <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const streakPct = streak
    ? Math.min(100, Math.round((streak.current / Math.max(streak.longest, 1)) * 100))
    : 0;

  return (
    <section className="px-4 md:px-8 pt-6 md:pt-8">
      <div
        className={cn(
          "max-w-7xl mx-auto grid gap-5",
          featured ? "lg:grid-cols-[1.6fr_1fr]" : "sm:grid-cols-2"
        )}
      >
        {featured && (
          <MotionWrapper variants={cinematicReveal} className="relative overflow-x-hidden">
            <CinematicBackground intensity="default" className="-inset-8" />
            <div className="relative rounded-lg overflow-hidden border border-border-hairline shadow-card min-h-[340px]">
              <Image
                src={resolveImageSrc(featured.image)}
                alt={featured.name}
                fill
                sizes="(min-width: 1024px) 60vw, 100vw"
                priority
                className="object-cover"
              />
              <div
                className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/35 to-transparent"
                aria-hidden
              />
              <div className="relative z-10 h-full flex flex-col justify-end p-6 md:p-8">
                <p className="flex items-center gap-2 text-[11px] font-extrabold tracking-[0.1em] uppercase text-gold-400 mb-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-gold-400 animate-pulse" aria-hidden />
                  {featured.eyebrow}
                </p>
                <h2 className="font-display italic text-3xl md:text-[44px] leading-none text-text-primary mb-3">
                  {featured.name}
                </h2>
                {featured.quote && (
                  <p className="max-w-md text-[14.5px] leading-relaxed text-[#E7E1D6] bg-white/[0.05] border border-white/[0.08] backdrop-blur-sm rounded-tl-2xl rounded-tr-2xl rounded-br-2xl rounded-bl-sm px-4 py-3 mb-4">
                    &ldquo;{featured.quote}&rdquo;
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button asChild size="lg">
                    <Link href={featured.primaryHref} className="gap-2">
                      {featured.primaryLabel}
                      <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
                    </Link>
                  </Button>
                  {featured.secondaryHref && (
                    <Button asChild variant="secondary" size="lg">
                      <Link href={featured.secondaryHref}>View profile</Link>
                    </Button>
                  )}
                </div>
                {featured.meta && (
                  <p className="text-text-tertiary text-xs mt-3">{featured.meta}</p>
                )}
              </div>
            </div>
          </MotionWrapper>
        )}

        <div className={cn("flex flex-col gap-5", !featured && "sm:flex-row")}>
          {topMatch && (
            <Link
              href={`/dating/match/${topMatch.matchId}`}
              className="flex-1 rounded-lg border border-gold-500/25 bg-gradient-to-br from-gold-900/25 via-base to-base shadow-card p-5 transition-colors ease-premium hover:border-gold-500/45"
            >
              <p className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-[0.09em] uppercase text-text-tertiary mb-3">
                <Heart className="h-3.5 w-3.5 text-gold-500" strokeWidth={2} />
                Tonight&rsquo;s match
              </p>
              <div className="flex items-center gap-3">
                <div className="relative h-11 w-11 rounded-full overflow-hidden shrink-0 border border-border-hairline">
                  <Image
                    src={resolveImageSrc(topMatch.character.image_url)}
                    alt={topMatch.character.name}
                    fill
                    sizes="44px"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-text-primary truncate">
                    {topMatch.character.name}
                  </div>
                  <div className="text-xs text-text-tertiary mt-0.5">
                    {topMatch.compatibilityPct}% {MATCH_TIER_LABEL[topMatch.matchTier] ?? "match"}
                    {topMatch.isNew ? " \u00b7 new" : ""}
                  </div>
                </div>
              </div>
            </Link>
          )}

          {streak && (
            <div className="flex-1 rounded-lg border border-border-hairline shadow-card p-5">
              <p className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-[0.09em] uppercase text-text-tertiary mb-3">
                <Flame className="h-3.5 w-3.5 text-gold-500" strokeWidth={2} />
                Streak
              </p>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[28px] font-semibold text-text-primary">
                  {streak.current}
                </span>
                <span className="text-xs text-text-tertiary">
                  day{streak.current === 1 ? "" : "s"} &middot; best {streak.longest}
                </span>
              </div>
              <div className="h-[5px] rounded-full bg-white/[0.06] mt-3 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gold-fill"
                  style={{ width: `${streakPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
