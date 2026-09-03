import type { Metadata } from "next";
import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import {
  getLandingPage,
  getLandingPageSlugs,
} from "@/lib/seo/landing-pages";
import { getDiscoverHome } from "@/lib/frontend/discover";
import { generateFAQSchema, safeJsonLd } from "@/lib/seo/structured";
import { resolveImageSrc, absoluteUrl } from "@/lib/utils";
import { PublicHeader } from "@/components/public/public-header";
import { Footer } from "@/components/home/footer";
import { Button } from "@/components/ui/button";

/**
 * 0.3.1/0.3.2/2.1/14.1/14.2 FIX: this is the template landing-pages.ts's
 * own docstring has referenced since it was written ("the template at
 * app/(seo)/[landing]/page.tsx picks them up automatically via
 * generateStaticParams") — it never existed, so every LANDING_PAGES
 * entry (ai-girlfriend, ai-boyfriend, anime-ai-chat, ai-friend,
 * virtual-companion, web-login) 404'd and no SEO copy was reachable.
 *
 * Also the first production caller of generateFAQSchema()/safeJsonLd()
 * (src/lib/seo/structured.ts) — that helper had a dedicated XSS-regression
 * test (sec-05-jsonld-xss.test.ts) but, per its own docstring referencing
 * a route path that doesn't exist in this tree, was never actually wired
 * into a rendered page. FAQs here are static config, not user input, but
 * safeJsonLd() is used anyway rather than raw JSON.stringify — it's the
 * established convention for every dangerouslySetInnerHTML JSON-LD payload
 * in this codebase, and costs nothing to apply uniformly.
 *
 * force-dynamic because getDiscoverHome() -> fetchInternal() reads
 * next/headers cookies(), which opts the route out of static rendering
 * regardless — matches src/app/discover/page.tsx's own reasoning.
 * generateStaticParams still runs so build-time link-checking / the
 * matcher know about these paths, and unknown slugs 404 via notFound()
 * (dynamicParams stays at its default of true, so a slug removed from
 * LANDING_PAGES later serves a real 404 instead of a stale build).
 */
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return getLandingPageSlugs().map((landing) => ({ landing }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ landing: string }>;
}): Promise<Metadata> {
  const { landing } = await params;
  const page = getLandingPage(landing);
  if (!page) return {};

  const url = absoluteUrl(`/${page.slug}`);
  return {
    title: page.title,
    description: page.description,
    keywords: page.keywords,
    alternates: { canonical: url },
    openGraph: {
      title: page.title,
      description: page.description,
      url,
      siteName: "Vantrix",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
    },
  };
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ landing: string }>;
}) {
  const { landing } = await params;
  const page = getLandingPage(landing);
  if (!page) notFound();

  const [{ allCharacters }, nonce] = await Promise.all([
    getDiscoverHome(page.gender ? { gender: page.gender } : undefined),
    (async () => (await headers()).get("x-nonce"))(),
  ]);
  const showcase = allCharacters.slice(0, 8);

  const ctaHref = page.ctaHref ?? "/login?mode=sign-up";
  const ctaLabel = page.ctaLabel ?? "Start Free";
  const secondaryHref = page.secondaryCtaHref ?? "/discover";
  const secondaryLabel = page.secondaryCtaLabel ?? "Browse companions";

  const faqSchema = generateFAQSchema(page.faqs);

  return (
    <div className="min-h-screen bg-base">
      {/* eslint-disable-next-line @next/next/no-sync-scripts -- static JSON-LD, escaped via safeJsonLd */}
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqSchema) }}
      />

      <PublicHeader />

      {/* Hero */}
      <section className="px-4 md:px-8 pt-14 pb-10 text-center max-w-3xl mx-auto">
        <span className="inline-block text-xs font-bold tracking-[0.2em] uppercase text-gold-500 mb-4">
          Vantrix
        </span>
        <h1 className="font-display text-3xl md:text-5xl leading-[1.1] text-text-primary whitespace-pre-line">
          {page.h1}
        </h1>
        <p className="mt-4 text-gold-400 font-semibold text-lg">
          {page.tagline}
        </p>
        <p className="mt-5 text-text-secondary text-[15px] leading-relaxed max-w-2xl mx-auto">
          {page.intro}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href={ctaHref}>{ctaLabel}</Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href={secondaryHref}>{secondaryLabel}</Link>
          </Button>
        </div>
      </section>

      {/* Live character showcase */}
      {showcase.length > 0 && (
        <section className="px-4 md:px-8 pb-16 max-w-5xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {showcase.map((c) => (
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
        </section>
      )}

      {/* Features */}
      <section className="px-4 md:px-8 py-14 border-t border-border-hairline">
        <div className="max-w-5xl mx-auto grid sm:grid-cols-3 gap-10">
          {page.features.map((f) => (
            <div key={f.title}>
              <div className="text-3xl mb-3" aria-hidden>
                {f.icon}
              </div>
              <h3 className="font-display text-lg text-text-primary mb-1.5">
                {f.title}
              </h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Steps */}
      <section className="px-4 md:px-8 py-14 border-t border-border-hairline">
        <h2 className="font-display text-2xl text-text-primary text-center mb-10">
          How it works
        </h2>
        <div className="max-w-5xl mx-auto grid sm:grid-cols-3 gap-10">
          {page.steps.map((s) => (
            <div key={s.n}>
              <span className="font-display text-gold-500 text-2xl">
                {s.n}
              </span>
              <h3 className="font-display text-lg text-text-primary mt-2 mb-1.5">
                {s.title}
              </h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="px-4 md:px-8 py-14 border-t border-border-hairline max-w-3xl mx-auto">
        <h2 className="font-display text-2xl text-text-primary text-center mb-10">
          Frequently asked questions
        </h2>
        <div className="space-y-7">
          {page.faqs.map((f) => (
            <div key={f.question}>
              <h3 className="text-text-primary font-semibold text-[15px] mb-1.5">
                {f.question}
              </h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                {f.answer}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-4 md:px-8 py-16 border-t border-border-hairline text-center">
        <h2 className="font-display text-2xl md:text-3xl text-text-primary mb-2">
          {page.cta.headline}
        </h2>
        <p className="text-text-secondary mb-7">{page.cta.sub}</p>
        <Button asChild size="lg">
          <Link href={ctaHref}>{ctaLabel}</Link>
        </Button>
      </section>

      <Footer />
    </div>
  );
}
