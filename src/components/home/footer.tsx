import Link from "next/link";
import { getContactEmail, getDiscordUrl } from "@/lib/config/contact";

type FooterLink = { label: string; href: string; external?: boolean };

const STATIC_COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Characters", href: "/characters" },
      { label: "Dating", href: "/dating" },
      { label: "World", href: "/world" },
      { label: "Studio", href: "/studio" },
      { label: "Premium", href: "/premium" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Careers", href: "/careers" },
      { label: "Blog", href: "/blog" },
    ],
  },
];

// Support column is built per-render since its Contact link now depends on
// the fetched email — see getContactEmail() in Footer() below.
function buildSupportColumn(contactEmail: string): { title: string; links: FooterLink[] } {
  return {
    title: "Support",
    links: [
      { label: "Help Center", href: "/support" },
      { label: "Contact", href: `mailto:${contactEmail}` },
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
    ],
  };
}

// Community column mirrors buildSupportColumn's pattern: external, so it's
// rendered with a plain <a> (not next/link) and opens in a new tab.
function buildCommunityColumn(discordUrl: string): { title: string; links: FooterLink[] } {
  return {
    title: "Community",
    links: [
      { label: "Discord", href: discordUrl, external: true },
      { label: "Twitter / X", href: "https://twitter.com/vantrixai", external: true },
      { label: "Telegram", href: "https://t.me/vantrixai", external: true },
    ],
  };
}

/**
 * §3.6 / §9 Open Question 3 resolved: omit entirely on mobile rather
 * than a condensed version — every link here already lives one tap away
 * in the sidebar drawer (§2), so a mobile footer would only duplicate
 * navigation the user already has, at the cost of extra scroll on the
 * page that's supposed to convert fastest. `hidden md:block` enforces
 * that at the component level rather than relying on callers to gate it.
 */
export async function Footer() {
  const [contactEmail, discordUrl] = await Promise.all([
    getContactEmail(),
    getDiscordUrl(),
  ]);
  const columns = [
    ...STATIC_COLUMNS,
    buildSupportColumn(contactEmail),
    buildCommunityColumn(discordUrl),
  ];

  return (
    <footer className="hidden md:block border-t border-border-hairline mt-4">
      <div className="max-w-7xl mx-auto px-8 py-10 grid grid-cols-5 gap-8">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-7 w-7 rounded-xs bg-gold-fill flex items-center justify-center font-display font-bold text-[#160F02] text-sm">
              V
            </span>
            <span className="font-display text-lg tracking-tight text-text-primary">
              Vantrix
            </span>
          </div>
          <p className="text-text-secondary text-sm mt-3 max-w-[220px]">
            AI companions who remember, grow, and live in a world of their
            own.
          </p>
        </div>

        {columns.map((col) => (
          <div key={col.title}>
            <div className="text-text-primary text-sm font-semibold mb-3">
              {col.title}
            </div>
            <ul className="space-y-2">
              {col.links.map((link) =>
                link.external ? (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-secondary text-sm hover:text-gold-400 transition-colors ease-premium"
                    >
                      {link.label}
                    </a>
                  </li>
                ) : (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-text-secondary text-sm hover:text-gold-400 transition-colors ease-premium"
                    >
                      {link.label}
                    </Link>
                  </li>
                )
              )}
            </ul>
          </div>
        ))}
      </div>
      <div className="max-w-7xl mx-auto px-8 pb-8 text-text-tertiary text-xs">
        © {new Date().getFullYear()} Vantrix Ai. All rights reserved.
      </div>
    </footer>
  );
}
