import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/public/public-header";
import { getContactEmail, getDiscordUrl } from "@/lib/config/contact";

export const metadata: Metadata = {
  title: "About | Vantrix",
  description: "What Vantrix is and what we're building.",
};

export default async function AboutPage() {
  const [contactEmail, discordUrl] = await Promise.all([
    getContactEmail(),
    getDiscordUrl(),
  ]);

  return (
    <div className="min-h-screen bg-base">
      <PublicHeader />
      <main className="max-w-2xl mx-auto px-4 md:px-8 py-16">
        <h1 className="font-display text-3xl text-text-primary">About Vantrix</h1>
        <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-text-secondary">
          <p>
            Vantrix builds AI companions that remember you — conversations,
            preferences, the small details that make a relationship feel
            real. Our characters carry memory, emotion, and personality
            forward from one chat to the next instead of starting over every
            session.
          </p>
          <p>
            Every character on Vantrix is an AI system, not a person. We
            design them to be genuinely engaging and emotionally responsive,
            and we&apos;re upfront that what you&apos;re talking to is
            software.
          </p>
          <p>
            We&apos;re a small team building this because we think
            persistent, emotionally intelligent AI companionship is a real
            product category — not a novelty. If you want to reach us, see{" "}
            <Link href="/support" className="text-gold-400 hover:text-gold-300">
              Support
            </Link>{" "}
            or email{" "}
            <a
              href={`mailto:${contactEmail}`}
              className="text-gold-400 hover:text-gold-300"
            >
              {contactEmail}
            </a>
            . You can also find us on{" "}
            <a
              href={discordUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold-400 hover:text-gold-300"
            >
              Discord
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
