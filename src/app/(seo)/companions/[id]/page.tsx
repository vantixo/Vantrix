import type { Metadata } from "next";
import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import {
  getPublicCharacter,
  getPublicCharacterIds,
} from "@/lib/seo/public-character";
import { generateCharacterSchema, safeJsonLd } from "@/lib/seo/structured";
import { resolveImageSrc, absoluteUrl } from "@/lib/utils";
import { PublicHeader } from "@/components/public/public-header";
import { Footer } from "@/components/home/footer";
import { GuestChatWidget } from "@/components/public/guest-chat-widget";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * §2.5 — public, crawlable character pages.
 *
 * Mirrors (seo)/[landing]/page.tsx's structure (static params + metadata +
 * JSON-LD via safeJsonLd, PublicHeader/Footer shell) since that's the
 * established pattern for every other public/indexable route in this app.
 *
 * generateCharacterSchema() (src/lib/seo/structured.ts) already existed,
 * already had a dedicated XSS-regression test
 * (sec-05-jsonld-xss.test.ts), and its own docstring already assumed a
 * character detail page would call it — but nothing ever did (same
 * "backend/helper built, no consumer" pattern this codebase's other
 * audit passes kept finding elsewhere). This is its first real caller.
 *
 * Route is /companions/[id], not /characters/[id] — the latter is
 * already an authenticated (app) route at the exact same URL; Next
 * can't resolve two page.tsx files to one path even across different
 * route groups, so a new indexable surface needs a distinct path. The
 * in-app chat/detail experience for a signed-in user still lives at
 * /characters/[id] and /chat/[id]; this page never renders that
 * component tree.
 *
 * GUEST-CHAT-WIRE-FIX: this page's hero CTA used to be a bare "Chat with
 * X" link straight to signup — but POST /api/chat/guest,
 * src/lib/guest-transcript.ts, and POST /api/chat/claim-guest-transcript
 * were all already fully built (crisis detection, cookie-bound rate
 * limiting, idempotent post-signup backfill) with zero UI ever calling
 * any of them. GuestChatWidget is that missing consumer: a real,
 * unauthenticated exchange happens right on this page, and the CTA only
 * appears once the guest actually hits the message limit (see
 * EmotionalPeakPaywall) — not before they've felt anything.
 *
 * force-dynamic for the same class of reason [landing]/page.tsx uses
 * it: nothing here reads cookies, but the public-character set changes
 * continuously (new approvals, creators toggling visibility) and this
 * is a low-traffic-per-URL long-tail page, not a hot path worth ISR
 * complexity for. generateStaticParams still runs so build-time
 * link-checking / the crawler know about today's public characters;
 * dynamicParams stays at its default (true), so a character approved
 * after the last build is still reachable and indexable, not 404'd
 * until the next deploy.
 */
export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  const ids = await getPublicCharacterIds();
  return ids.map((id) => ({ id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const character = await getPublicCharacter(id);
  if (!character) return {};

  const url = absoluteUrl(`/companions/${character.id}`);
  const title = `Chat with ${character.name} — AI Companion | Vantrix`;
  const description =
    character.description?.slice(0, 155) ??
    `Meet ${character.name}, an AI companion on Vantrix. Start a free conversation now.`;
  const image = resolveImageSrc(character.image_url);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "Vantrix",
      type: "profile",
      images: [{ url: image }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function PublicCharacterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [character, nonce] = await Promise.all([
    getPublicCharacter(id),
    (async () => (await headers()).get("x-nonce"))(),
  ]);
  if (!character) notFound();

  const signUpHref = `/login?mode=sign-up&redirect=${encodeURIComponent(`/characters/${character.id}`)}`;
  const schema = generateCharacterSchema({
    id: character.id,
    name: character.name,
    description: character.description ?? "",
    image_url: resolveImageSrc(character.image_url),
    age: character.age,
    occupation: character.occupation,
    category: character.category,
    tags: character.tags,
  });

  return (
    <div className="min-h-screen bg-base">
      {/* eslint-disable-next-line @next/next/no-sync-scripts -- static JSON-LD, escaped via safeJsonLd */}
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }}
      />

      <PublicHeader />

      <section className="px-4 md:px-8 pt-12 pb-16 max-w-4xl mx-auto">
        <div className="grid sm:grid-cols-[280px_1fr] gap-8 items-start">
          <div className="relative aspect-[3/4] rounded-lg overflow-hidden border border-border-hairline">
            <Image
              src={resolveImageSrc(character.image_url)}
              alt={character.name}
              fill
              sizes="(max-width: 640px) 100vw, 280px"
              priority
              className="object-cover"
            />
          </div>

          <div>
            <h1 className="font-display text-3xl md:text-4xl text-text-primary">
              {character.name}
              {character.age ? (
                <span className="text-text-secondary font-normal text-2xl">
                  {" "}
                  · {character.age}
                </span>
              ) : null}
            </h1>
            {(character.archetype || character.occupation) && (
              <p className="mt-1.5 text-gold-400 font-semibold">
                {[character.archetype, character.occupation]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {character.description && (
              <p className="mt-4 text-text-secondary text-[15px] leading-relaxed">
                {character.description}
              </p>
            )}

            {character.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {character.tags.slice(0, 8).map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {character.opening_line && (
              <blockquote className="mt-5 border-l-2 border-gold-500 pl-4 italic text-text-secondary">
                &ldquo;{character.opening_line}&rdquo;
              </blockquote>
            )}

            <div className="mt-4 flex gap-4 text-sm text-text-secondary">
              <span>{character.like_count.toLocaleString()} likes</span>
              <span>{character.follower_count.toLocaleString()} followers</span>
            </div>

            <div className="mt-8">
              <GuestChatWidget
                character={{
                  id: character.id,
                  name: character.name,
                  image_url: character.image_url,
                  opening_line: character.opening_line,
                }}
                signUpHref={signUpHref}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 md:px-8 pb-16 max-w-4xl mx-auto border-t border-border-hairline pt-10 text-center">
        <p className="text-text-secondary text-sm">
          Want to explore more AI companions like {character.name}?
        </p>
        <Button asChild variant="secondary" className="mt-3">
          <Link href="/discover">Browse companions</Link>
        </Button>
      </section>

      <Footer />
    </div>
  );
}
