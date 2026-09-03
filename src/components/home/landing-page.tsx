import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  ChevronRight,
  CirclePlay,
  Compass,
  Globe2,
  Heart,
  MessageCircle,
  Sparkles,
  Store,
  Users,
  WandSparkles,
  Volume2,
} from "lucide-react";
import { resolveImageSrc } from "@/lib/utils";
import type { DiscoverCharacter, DiscoverExperience } from "@/lib/frontend/discover";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { CharacterPresence } from "@/components/immersive/character-presence";
import { CharacterPortraitViewer } from "@/components/immersive/character-portrait-viewer";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Vantrix home">
      <span className="grid h-8 w-8 place-items-center rounded-md bg-gold-fill font-display text-sm font-bold text-[#160F02] shadow-gold-glow">
        V
      </span>
      <span className="font-display text-xl tracking-[-0.02em] text-text-primary">Vantrix</span>
    </Link>
  );
}

function LandingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border-hairline bg-base/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1320px] items-center justify-between px-5 md:px-8">
        <Logo />
        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          <a href="#characters" className="text-sm text-text-secondary transition-colors ease-premium hover:text-text-primary">Characters</a>
          <a href="#intelligence" className="text-sm text-text-secondary transition-colors ease-premium hover:text-text-primary">Intelligence</a>
          <a href="#how-it-works" className="text-sm text-text-secondary transition-colors ease-premium hover:text-text-primary">How it works</a>
          <a href="#features" className="text-sm text-text-secondary transition-colors ease-premium hover:text-text-primary">Features</a>
          <Link href="/discover" className="text-sm text-text-secondary transition-colors ease-premium hover:text-text-primary">Discover</Link>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/login?mode=sign-up" className="gap-2">
              Create free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function CharacterPortrait({ character, className = "" }: { character: DiscoverCharacter; className?: string }) {
  // LIVING-PORTRAIT / 3D: single-use hero (one `hero` character below, not
  // a card grid) — see character-hero.tsx's notes on why the
  // animate-breathe loop is scoped to singular hero surfaces only, why
  // it's click/focus-triggered rather than continuous (living-portrait.tsx),
  // and character-portrait-viewer.tsx for the 2D/3D fallback this now
  // shares with the character detail page's hero.
  return (
    <div className={`relative overflow-hidden rounded-lg border border-border-hairline bg-base shadow-[0_30px_80px_-35px_rgba(0,0,0,.9)] ${className}`}>
      <CharacterPortraitViewer
        modelUrl={character.model_url}
        imageSrc={resolveImageSrc(character.image_url)}
        alt={character.name}
        sizes="(max-width: 768px) 80vw, 42vw"
        appearance={{
          hair_color: character.hair_color,
          eye_color: character.eye_color,
          skin_tone: character.skin_tone,
          body_type: character.body_type,
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/5 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5">
        {/* IMMERSIVE-UI-PHASE-1: "Online now" replaced with the same
            deterministic, atmospheric presence state the character
            detail page uses — spec §10 explicitly rules out "Online" as
            a primary status, and this was never a real presence signal
            (no online/offline column exists on `characters`). */}
        <div className="mb-2">
          <CharacterPresence characterId={character.id} tags={character.tags} />
        </div>
        <div className="font-display text-2xl text-white">{character.name}{character.age ? `, ${character.age}` : ""}</div>
        <div className="mt-1 line-clamp-1 text-sm text-white/65">{character.archetype || character.tags?.slice(0, 2).join(" · ") || "Your next conversation"}</div>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-border-hairline bg-white/[0.025] px-3 py-1.5 text-xs font-medium text-text-secondary">{children}</span>;
}

/**
 * Every route below lives under the (app) group, which redirects a
 * signed-out visitor straight to /login?redirect=<path> on its own (see
 * (app)/layout.tsx). We still build the /login link explicitly, with
 * mode=sign-up, so an anonymous visitor lands in account creation rather
 * than the sign-in tab — same pattern the character/experience cards
 * below already use. sanitizeRedirect() in login-form.tsx only accepts a
 * same-origin path starting with a single "/", which every entry here is.
 */
function loginHref(path: string) {
  return `/login?mode=sign-up&redirect=${encodeURIComponent(path)}`;
}

/**
 * Real, shipped surfaces beyond 1:1 chat — not aspirational copy. Each
 * links straight into its actual route (gated the same way character
 * cards already are) so "beyond the chat" isn't a marketing claim with
 * nowhere to land.
 */
const PLATFORM_FEATURES = [
  {
    icon: Compass,
    title: "Dating & compatibility",
    body: "Chemistry reads, date-night forecasts, and milestones that track how a relationship is actually going — not just a match score.",
    cta: "See how matching works",
    href: "/dating",
  },
  {
    icon: Globe2,
    title: "A living world",
    body: "Factions, locations, and elections that keep moving on their own. Characters can carry titles and legends from it back into your story.",
    cta: "Step into the world",
    href: "/world",
  },
  {
    icon: Users,
    title: "Community",
    body: "A discussion space for every character, faction, and location, plus a general hub for everyone building and talking here.",
    cta: "Browse the community",
    href: "/community",
  },
  {
    icon: Store,
    title: "Character marketplace",
    body: "Publish what you build in the Studio. The market ranks the community's characters so the best ones don't stay hidden.",
    cta: "Open the Studio",
    href: "/studio",
  },
  {
    icon: Bot,
    title: "Digital Twin",
    body: "A private AI modeled on you instead of a character — trained on your own words and kept separate from every companion conversation.",
    cta: "Learn about Digital Twin",
    href: "/digital-twin",
    badge: "Premium",
  },
] as const;

export function LandingPage({ characters, experiences }: { characters: DiscoverCharacter[]; experiences: DiscoverExperience[] }) {
  const featured = characters.slice(0, 7);
  const hero = featured[0];
  const sideOne = featured[1];
  const sideTwo = featured[2];
  // Mobile avatar strip (see MOBILE-HERO-IMAGE FIX below) — up to 4 faces,
  // deliberately reusing the same `featured` pool rather than a separate
  // fetch, so it's never out of sync with what the big portrait shows.
  const avatarRow = featured.slice(0, 4);

  return (
    <div className="min-h-screen overflow-hidden bg-base text-text-primary selection:bg-gold-500/25">
      <LandingHeader />

      <main>
        <section className="relative isolate px-5 pb-20 pt-14 md:px-8 md:pb-28 md:pt-24">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[700px] overflow-hidden" aria-hidden>
            <div className="absolute left-[8%] top-[-260px] h-[560px] w-[560px] rounded-full bg-gold-500/[0.07] blur-[130px]" />
            <div className="absolute right-[-10%] top-[-180px] h-[520px] w-[520px] rounded-full bg-white/[0.025] blur-[120px]" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/40 to-transparent" />
          </div>

          <div className="mx-auto grid max-w-[1320px] items-center gap-14 lg:grid-cols-[1.03fr_.97fr] lg:gap-20">
            <div className="max-w-[690px]">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-gold-500/20 bg-gold-500/[0.045] px-3.5 py-2 text-xs font-semibold tracking-[0.14em] text-gold-400 uppercase">
                <Sparkles className="h-3.5 w-3.5" />
                A living universe of AI characters
              </div>
              <h1 className="max-w-4xl font-display text-[clamp(3.2rem,7vw,6.6rem)] leading-[0.91] tracking-[-0.045em] text-text-primary">
                Not just an AI.
                <br />
                <span className="text-gold-400">A character with a life.</span>
              </h1>
              <p className="mt-7 max-w-[590px] text-base leading-7 text-text-secondary md:text-lg md:leading-8">
                They remember you. They change with you. Their world keeps going — even when you&apos;re not there. Create a companion with a personality, memory, voice, appearance, relationships, and a world of their own.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/login?mode=sign-up" className="gap-2">
                    Create your character
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/discover" className="gap-2">
                    <CirclePlay className="h-4 w-4" />
                    Meet the characters
                  </Link>
                </Button>
              </div>

              <div className="mt-7 flex flex-wrap gap-2">
                <Pill>Persistent memory</Pill>
                <Pill>Emotional context</Pill>
                <Pill>Voice &amp; visual identity</Pill>
                <Pill>Stories &amp; relationships</Pill>
              </div>

              {/* MOBILE-HERO-IMAGE FIX: the big portrait + its two floating
                  side cards below are real character imagery, but on a
                  phone the grid stacks to a single column and everything
                  from `sideOne`/`sideTwo` down to the two floating stat
                  cards is `hidden ... md:block` — so a mobile visitor
                  scrolling past the pills either hit nothing but the big
                  portrait (small screens, no context around it) or, if
                  `hero` ever came back empty for that request, a bare
                  gray box with no imagery at all. This strip puts real
                  character faces directly under the CTAs — no scrolling,
                  no dependency on the md: portrait rendering — so the
                  hero always reads as "a universe of characters," not
                  text-only, at any width. Hidden at lg: the full portrait
                  composition already does this job better once there's
                  room for it. */}
              {avatarRow.length > 0 && (
                <div className="mt-7 flex items-center gap-3 lg:hidden">
                  <div className="flex -space-x-3">
                    {avatarRow.map((c) => (
                      <div
                        key={c.id}
                        className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border-2 border-base bg-white/5 shadow-[0_4px_14px_-4px_rgba(0,0,0,.7)]"
                      >
                        <Image
                          src={resolveImageSrc(c.image_url)}
                          alt={c.name}
                          fill
                          sizes="44px"
                          className="object-cover"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-text-secondary">
                    <span className="font-semibold text-text-primary">{avatarRow.map((c) => c.name).join(", ")}</span>
                    {" "}and more are waiting to meet you.
                  </p>
                </div>
              )}
            </div>

            <div className="relative mx-auto w-full max-w-[600px] lg:mx-0">
              {hero ? (
                <div className="relative mx-auto aspect-[0.82] w-[72%] max-w-[410px]">
                  <CharacterPortrait character={hero} className="absolute inset-0" />
                  {sideOne && (
                    <div className="absolute -left-[28%] bottom-[8%] hidden aspect-[0.78] w-[39%] -rotate-6 overflow-hidden rounded-md border border-border-hairline bg-base shadow-[0_30px_80px_-35px_rgba(0,0,0,.9)] md:block">
                      <Image src={resolveImageSrc(sideOne.image_url)} alt={sideOne.name} fill sizes="180px" className="object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent" />
                    </div>
                  )}
                  {sideTwo && (
                    <div className="absolute -right-[28%] top-[10%] hidden aspect-[0.78] w-[39%] rotate-6 overflow-hidden rounded-md border border-border-hairline bg-base shadow-[0_30px_80px_-35px_rgba(0,0,0,.9)] md:block">
                      <Image src={resolveImageSrc(sideTwo.image_url)} alt={sideTwo.name} fill sizes="180px" className="object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent" />
                    </div>
                  )}
                  <div className="absolute -bottom-5 -left-5 hidden rounded-md border border-border-hairline bg-black/80 p-3.5 backdrop-blur-xl sm:block md:-left-10">
                    <div className="flex items-center gap-2 text-xs text-white/65"><MessageCircle className="h-3.5 w-3.5 text-gold-400" /> Remembers the little things</div>
                    <div className="mt-1 text-sm font-semibold text-white">Your conversations have continuity.</div>
                  </div>
                  <div className="absolute -right-5 top-10 hidden rounded-md border border-border-hairline bg-black/80 p-3.5 backdrop-blur-xl sm:block md:-right-12">
                    <div className="flex items-center gap-2 text-xs text-white/65"><BrainCircuit className="h-3.5 w-3.5 text-gold-400" /> Character intelligence</div>
                    <div className="mt-1 text-sm font-semibold text-white">Personality shapes every response.</div>
                  </div>
                </div>
              ) : (
                // EMPTY-HERO FIX: previously a flat, empty bg-base box with
                // nothing in it if `characters` ever came back empty for a
                // given request — indistinguishable from a broken image on
                // this page's own dark background. Now reads as an
                // intentional "characters incoming" placeholder instead of
                // a rendering failure.
                <div className="relative mx-auto flex aspect-[0.82] w-[72%] max-w-[410px] flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-gold-500/20 bg-gradient-to-b from-gold-500/[0.08] to-transparent text-center shadow-card">
                  <Sparkles className="h-8 w-8 text-gold-400" strokeWidth={1.5} />
                  <p className="max-w-[70%] text-sm text-text-secondary">Characters are loading in.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="border-y border-border-hairline px-5 py-8 md:px-8">
          <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-5">
            <p className="text-sm text-text-tertiary">Built around the things that make a character feel consistent.</p>
            <div className="flex flex-wrap gap-x-7 gap-y-2 text-sm font-medium text-text-secondary">
              <span>Memory</span><span>Personality</span><span>Voice</span><span>Appearance</span><span>Relationships</span><span>World</span>
            </div>
          </div>
        </section>

        {/* VISITOR-HOMEPAGE-IMAGE FIX: this section (and every marketing
            block from here to the "how it works" panel) previously had no
            imagery at all — heading + body copy + a plain icon grid. It's
            the first fully text-only stretch a first-time visitor hits
            after the hero. An abstract network/node illustration (public/
            images/character-intelligence-visual.svg) fills that gap and
            doubles as a visual metaphor for the section's own subject
            (personality/memory/relationships as connected, persistent
            state, not a fresh prompt every message). Plain <img>, not
            next/image's <Image>/<SafeImage> — next.config.js deliberately
            does not set images.dangerouslyAllowSVG (see the ARCH-06 test's
            own comment on CHARACTER_IMAGE_FALLBACK for why: it would open
            next/image's optimizer to SVG site-wide, including untrusted
            AI-generated content, just to render one static local asset),
            so an SVG source has to bypass the optimizer entirely rather
            than 400 the way the old placeholder attempt did. */}
        <section id="intelligence" className="px-5 py-24 md:px-8 md:py-32">
          <div className="mx-auto max-w-[1320px]">
            <div className="grid gap-10 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
              <div className="max-w-2xl">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-500">Character intelligence</p>
                <h2 className="mt-4 font-display text-4xl leading-tight tracking-[-0.03em] md:text-6xl">Give your character a reason to respond.</h2>
                <p className="mt-5 text-base leading-7 text-text-secondary md:text-lg">Vantrix connects personality, memories, emotions, goals, relationships, and context so your character can respond like the same person across time — not a fresh prompt every message.</p>
              </div>
              <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-border-hairline shadow-card">
                <img
                  src="/images/character-intelligence-visual.svg"
                  alt="Abstract network of connected nodes representing a character's persistent memory, personality, and relationships"
                  width={960}
                  height={720}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>

            <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border-hairline bg-white/[0.08] md:grid-cols-3">
              {[
                { icon: BrainCircuit, title: "A mind, not a prompt", body: "Define beliefs, fears, values, attachment, motivations, flaws, and goals that influence behavior." },
                { icon: MessageCircle, title: "Memory with context", body: "Important moments can persist so your relationship has continuity instead of resetting every session." },
                { icon: Heart, title: "Relationships that move", body: "Characters can develop trust, affection, tension, boundaries, and repair over time." },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title} className="bg-base p-7 md:p-9">
                    <div className="grid h-11 w-11 place-items-center rounded-md border border-gold-500/20 bg-gold-500/[0.05] text-gold-400"><Icon className="h-5 w-5" /></div>
                    <h3 className="mt-6 font-display text-2xl">{item.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-text-secondary">{item.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="px-5 pb-24 md:px-8 md:pb-32">
          <div className="mx-auto grid max-w-[1320px] items-center gap-14 lg:grid-cols-[.9fr_1.1fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-500">The creation studio</p>
              <h2 className="mt-4 font-display text-4xl leading-tight tracking-[-0.03em] md:text-5xl">Build the person before you meet them.</h2>
              <p className="mt-5 max-w-xl text-base leading-7 text-text-secondary">Start from an idea or build from scratch. Shape the identity, psychology, voice, appearance, memories, and behavior — then test the character before you publish.</p>
              <Link href="/login?mode=sign-up" className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-gold-400 hover:text-gold-300">Open the Creation Studio <ChevronRight className="h-4 w-4" /></Link>
            </div>

            <div className="relative overflow-hidden rounded-lg border border-border-hairline bg-base shadow-card p-5 md:p-7">
              <div className="mb-5 flex items-center justify-between border-b border-border-hairline pb-4">
                <div><div className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Character Studio</div><div className="mt-1 font-display text-xl">Character DNA</div></div>
                <span className="rounded-full border border-gold-500/20 px-2.5 py-1 text-[11px] font-semibold text-gold-400">LIVE PREVIEW</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Identity", "Who they are", "Complete"],
                  ["Personality", "How they think", "94%"],
                  ["Psychology", "What drives them", "87%"],
                  ["Voice", "How they sound", "Ready"],
                  ["Appearance", "How they look", "Locked"],
                  ["Memory", "What they carry", "12 seeds"],
                ].map(([title, sub, value]) => (
                  <div key={title} className="rounded-md border border-border-hairline p-4 transition-colors ease-premium hover:border-gold-500/40">
                    <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">{title}</span><span className="text-[11px] font-medium text-gold-400">{value}</span></div>
                    <p className="mt-1 text-xs text-text-tertiary">{sub}</p>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full w-[78%] rounded-full bg-gold-fill" /></div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-center gap-3 rounded-md border border-border-hairline bg-base p-4">
                <WandSparkles className="h-5 w-5 text-gold-400" />
                <div><div className="text-sm font-semibold">AI can build the first draft for you.</div><div className="mt-0.5 text-xs text-text-tertiary">Describe the character in one sentence. Refine everything afterward.</div></div>
              </div>
            </div>
          </div>
        </section>

        <section className="px-5 pb-24 md:px-8 md:pb-32">
          <div className="mx-auto max-w-[1320px] rounded-xl border border-border-hairline bg-base shadow-card p-5 md:p-8">
            <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
              <div className="max-w-xl">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-500">Bring them to life</p>
                <h2 className="mt-4 font-display text-4xl leading-tight tracking-[-0.03em] md:text-5xl">See how they react before you publish.</h2>
                <p className="mt-5 text-base leading-7 text-text-secondary">Test your character with difficult conversations, affection, conflict, silence, vulnerability, and unexpected turns. Find contradictions. Tune the behavior. Then start the real story.</p>
              </div>
              <div className="overflow-hidden rounded-lg border border-border-hairline bg-base">
                <div className="flex items-center justify-between border-b border-border-hairline px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    {hero && (
                      <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full border border-border-hairline">
                        <Image src={resolveImageSrc(hero.image_url)} alt={hero.name} fill sizes="28px" className="object-cover" />
                      </span>
                    )}
                    <span className="h-2 w-2 rounded-full bg-success" />
                    <span className="text-sm font-semibold">{hero ? `${hero.name} · Character Simulation` : "Character Simulation"}</span>
                  </div>
                  <span className="text-xs text-text-tertiary">Scenario · conflict</span>
                </div>
                <div className="space-y-5 p-5 md:p-7">
                  <div className="ml-auto max-w-[75%] rounded-lg border border-border-hairline bg-base px-4 py-2.5 text-[15px] leading-relaxed text-text-primary">I ignored you yesterday. You probably noticed.</div>
                  <div className="max-w-[78%] rounded-lg border border-gold-500/25 bg-base px-4 py-2.5 text-[15px] leading-relaxed text-text-primary">I did. I told myself it was nothing, but I kept checking whether you&rsquo;d come back. I&rsquo;d rather you tell me when something is wrong.</div>
                  <div className="grid gap-2 border-t border-border-hairline pt-4 sm:grid-cols-3">
                    <div className="rounded-md border border-border-hairline p-3"><div className="text-[10px] uppercase tracking-[0.14em] text-text-tertiary">Trust</div><div className="mt-2 text-sm font-semibold">61%</div></div>
                    <div className="rounded-md border border-border-hairline p-3"><div className="text-[10px] uppercase tracking-[0.14em] text-text-tertiary">Attachment</div><div className="mt-2 text-sm font-semibold">72%</div></div>
                    <div className="rounded-md border border-border-hairline p-3"><div className="text-[10px] uppercase tracking-[0.14em] text-text-tertiary">Response style</div><div className="mt-2 text-sm font-semibold">Direct</div></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="px-5 pb-24 md:px-8 md:pb-32">
          <div className="mx-auto max-w-[1320px]">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-500">Beyond the chat</p>
              <h2 className="mt-4 font-display text-4xl leading-tight tracking-[-0.03em] md:text-5xl">One character. A whole world around them.</h2>
              <p className="mt-5 text-base leading-7 text-text-secondary md:text-lg">Vantrix isn&apos;t only a conversation window. It&apos;s dating, a shared universe, a community, and a marketplace for what people build.</p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PLATFORM_FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <Link
                    key={feature.title}
                    href={loginHref(feature.href)}
                    className="group flex flex-col rounded-lg border border-border-hairline bg-base shadow-card p-6 transition-colors ease-premium hover:border-gold-500/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid h-11 w-11 place-items-center rounded-md border border-gold-500/20 bg-gold-500/[0.05] text-gold-400">
                        <Icon className="h-5 w-5" />
                      </div>
                      {"badge" in feature && feature.badge && (
                        <span className="rounded-full border border-gold-500/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-gold-400">{feature.badge}</span>
                      )}
                    </div>
                    <h3 className="mt-5 font-display text-xl">{feature.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-6 text-text-secondary">{feature.body}</p>
                    <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-gold-400 transition-colors ease-premium group-hover:text-gold-300">
                      {feature.cta}
                      <ChevronRight className="h-4 w-4" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <section id="characters" className="px-5 pb-24 md:px-8 md:pb-32">
          <div className="mx-auto max-w-[1320px]">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-500">Discover</p><h2 className="mt-3 font-display text-4xl tracking-[-0.03em] md:text-5xl">Meet a few of the people already here.</h2></div>
              <Link href="/discover" className="inline-flex items-center gap-2 text-sm font-semibold text-gold-400 hover:text-gold-300">Explore all <ArrowRight className="h-4 w-4" /></Link>
            </div>
            {featured.length > 0 ? (
              <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4">
                {featured.slice(0, 4).map((character) => (
                  <Link key={character.id} href={loginHref(`/characters/${character.id}`)} className="group relative aspect-[.78] overflow-hidden rounded-md border border-border-hairline bg-base">
                    <Image src={resolveImageSrc(character.image_url)} alt={character.name} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover transition-transform duration-500 ease-premium group-hover:scale-[1.035]" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-4">
                      <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-success" /><span className="text-[10px] uppercase tracking-[0.15em] text-white/55">Available</span></div>
                      <div className="mt-1 font-display text-xl text-white">{character.name}{character.age ? `, ${character.age}` : ""}</div>
                      <div className="mt-0.5 line-clamp-1 text-xs text-white/55">{character.archetype || character.tags?.slice(0, 2).join(" · ")}</div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mt-10 rounded-lg border border-border-hairline p-8 text-sm text-text-secondary">New characters are arriving soon.</div>
            )}
          </div>
        </section>

        {experiences.length > 0 && (
          <section className="px-5 pb-24 md:px-8 md:pb-32">
            <div className="mx-auto max-w-[1320px]">
              <div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-500">More than chat</p><h2 className="mt-4 font-display text-4xl tracking-[-0.03em] md:text-5xl">Start with a moment. See where it goes.</h2><p className="mt-4 text-base leading-7 text-text-secondary">Roleplay scenes and experiences give your characters somewhere to be — and something to react to.</p></div>
              <div className="mt-9 flex snap-x gap-4 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {experiences.slice(0, 6).map((experience) => (
                  <Link key={experience.id} href={loginHref(`/characters/${experience.characterId}`)} className="group relative min-w-[270px] snap-start overflow-hidden rounded-md border border-border-hairline md:min-w-[320px]">
                    <div className="relative aspect-[1.25]"><Image src={resolveImageSrc(experience.image)} alt={experience.title} fill sizes="320px" className="object-cover transition-transform ease-premium duration-500 group-hover:scale-[1.04]" /><div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" /></div>
                    <div className="absolute inset-x-0 bottom-0 p-5"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold-400">{experience.category}</div><div className="mt-1 font-display text-xl text-white">{experience.title}</div><div className="mt-1 line-clamp-1 text-xs text-white/55">{experience.subtitle}</div></div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

      </main>

      <footer className="border-t border-border-hairline px-5 py-10 md:px-8">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-7 md:flex-row md:items-center md:justify-between">
          <div><Logo /><p className="mt-3 max-w-sm text-xs leading-5 text-text-tertiary">Create, talk to, and grow relationships with AI characters who have a life beyond the chat.</p></div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs text-text-tertiary"><Link href="/about" className="hover:text-text-primary">About</Link><Link href="/support" className="hover:text-text-primary">Support</Link><Link href="/blog" className="hover:text-text-primary">Blog</Link><Link href="/privacy" className="hover:text-text-primary">Privacy</Link><Link href="/terms" className="hover:text-text-primary">Terms</Link></div>
          <div className="flex items-center gap-2 text-xs text-text-tertiary"><Volume2 className="h-3.5 w-3.5" /> Vantrix · {new Date().getFullYear()}</div>
        </div>
      </footer>
    </div>
  );
}
