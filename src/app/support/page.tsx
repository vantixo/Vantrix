import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/public/public-header";
import { getContactEmail, getDiscordUrl } from "@/lib/config/contact";

export const metadata: Metadata = {
  title: "Help Center | Vantrix",
  description: "Get help with your Vantrix account, billing, or a safety concern.",
};

const TOPICS = [
  {
    title: "Account & login",
    body: "Trouble signing in, resetting your password, or verifying your age.",
  },
  {
    title: "Billing & subscriptions",
    body: "Questions about a charge, canceling, or refunds. See your plan in Premium settings.",
    href: "/premium",
    linkLabel: "Go to Premium",
  },
  {
    title: "Report content or a safety concern",
    body: "Report a character, conversation, or another user's behavior that violates our policies.",
  },
];

export default async function SupportPage() {
  const [contactEmail, discordUrl] = await Promise.all([
    getContactEmail(),
    getDiscordUrl(),
  ]);

  return (
    <div className="min-h-screen bg-base">
      <PublicHeader />
      <main className="max-w-2xl mx-auto px-4 md:px-8 py-16">
        <h1 className="font-display text-3xl text-text-primary">Help Center</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-text-secondary">
          Email us at{" "}
          <a
            href={`mailto:${contactEmail}`}
            className="text-gold-400 hover:text-gold-300"
          >
            {contactEmail}
          </a>{" "}
          and we&apos;ll get back to you within 1–2 business days. Include
          your account email and, if it&apos;s a billing question, the
          approximate date of the charge.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
          Prefer chatting live? Join our{" "}
          <a
            href={discordUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold-400 hover:text-gold-300"
          >
            Discord community
          </a>{" "}
          — the fastest way to reach the team and other users for
          non-account-specific questions. For anything involving your
          account, billing, or a safety report, use email so we can verify
          your identity.
        </p>

        <div className="mt-10 space-y-6">
          {TOPICS.map((t) => (
            <div key={t.title} className="border-t border-border-hairline pt-5">
              <h2 className="font-display text-base text-text-primary">
                {t.title}
              </h2>
              <p className="mt-1.5 text-sm text-text-secondary leading-relaxed">
                {t.body}
              </p>
              {t.href && (
                <Link
                  href={t.href}
                  className="mt-2 inline-block text-sm text-gold-400 hover:text-gold-300"
                >
                  {t.linkLabel} →
                </Link>
              )}
            </div>
          ))}
        </div>

        <p className="mt-10 text-xs text-text-secondary/80 leading-relaxed">
          See also our{" "}
          <Link href="/terms" className="text-gold-400 hover:text-gold-300">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-gold-400 hover:text-gold-300">
            Privacy Policy
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
