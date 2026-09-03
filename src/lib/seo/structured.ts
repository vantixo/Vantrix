import { absoluteUrl } from "@/lib/utils";
import { env } from "@/env";

/**
 * SEC-XX FIX: Safely serialize a JSON-LD object for embedding via
 * dangerouslySetInnerHTML inside a <script type="application/ld+json"> tag.
 *
 * JSON.stringify does NOT escape `<`, so any field that flows into a schema
 * (e.g. character.name / character.description, which are user/creator
 * supplied) could contain a literal "</script>" and prematurely close the
 * tag, letting an attacker inject arbitrary HTML/script into the page.
 *
 * Escaping <, >, and & to their \uXXXX form keeps the JSON semantically
 * identical (valid inside a JSON string, parsed back to the original
 * characters) while making it impossible to break out of the surrounding
 * <script> element. Always use this — never JSON.stringify directly — when
 * building a dangerouslySetInnerHTML payload from schema data.
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export function generateOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Vantrix Ai",
    url: absoluteUrl("/"),
    areaServed: {
      "@type": "Place",
      name: "Worldwide",
    },
    // Only include profiles that are actually live — a sameAs entry
    // pointing at a dead or nonexistent profile can hurt disambiguation
    // more than it helps. Add each URL here as soon as the real profile
    // exists (LinkedIn company page, Instagram, TikTok, YouTube,
    // Product Hunt, GitHub org, Crunchbase, etc.).
    sameAs: [
      "https://twitter.com/vantrixai",
      "https://discord.gg/py7JQNqqz",
      "https://t.me/vantrixai",
      // "https://www.linkedin.com/company/vantrix",
      // "https://www.instagram.com/vantrixai",
      // "https://www.tiktok.com/@vantrixai",
      // "https://www.youtube.com/@vantrixai",
      // "https://www.producthunt.com/products/vantrix",
      // "https://github.com/vantrix",
    ],
    description:
      "Vantrix is a living universe of AI characters. They remember you, they change with you, and their world keeps going — persistent cross-session memory and evolving personalities, not a chatbot that resets every conversation.",
  };
}

export function generateWebSiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Vantrix Ai",
    url: absoluteUrl("/"),
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absoluteUrl("/discover?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function generateCharacterSchema(character: {
  id?:         string;
  name:        string;
  description: string;
  image_url:   string | null;
  age?:        number | null;
  occupation?: string | null;
  category?:   string | null;
  tags?:       string[] | null;
}) {
  const APP_URL = env.NEXT_PUBLIC_APP_URL;
  const charUrl = `${APP_URL}/chat/${character.id ?? "unknown"}`;
  return {
    "@context":   "https://schema.org",
    "@type":      "Person",
    "@id":        `${charUrl}#character`,
    name:         character.name,
    description:  character.description,
    image:        character.image_url ?? `${APP_URL}/og-image.jpg`,
    url:          charUrl,
    jobTitle:     character.occupation ?? character.category ?? "AI Companion",
    ...(character.age && { age: character.age }),
    ...(character.tags?.length && { keywords: character.tags.filter(Boolean).join(", ") }),
    mainEntityOfPage: { "@type": "WebPage", "@id": charUrl },
  };
}

export function generateFAQSchema(faqs: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

/**
 * AI-DISCOVERABILITY: SoftwareApplication schema, the entity type LLM-backed
 * answer engines (Perplexity, AI Overviews, Copilot) and structured-data
 * parsers most reliably map to "product a user could be recommended" —
 * stronger for that purpose than Organization alone. Kept in sync with the
 * canonical description in generateOrganizationSchema(); do not let the two
 * drift into different category/positioning language (see module docstring
 * intent: AI systems need one stable semantic identity, not several).
 */
export function generateSoftwareApplicationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": absoluteUrl("/#software"),
    name: "Vantrix Ai",
    applicationCategory: "LifestyleApplication",
    applicationSubCategory: "AI Companion Platform",
    operatingSystem: "Web, iOS, Android",
    url: absoluteUrl("/"),
    description:
      "Vantrix is a living universe of AI characters. They remember you, they change with you, and their world keeps going — persistent cross-session memory and evolving personalities, not a chatbot that resets every conversation. Free tier available; paid plans unlock additional characters, memory depth, and generation.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free tier — limited daily messages, no card required.",
      category: "Freemium",
    },
    featureList: [
      "AI character conversations",
      "Persistent conversation memory",
      "Custom character creation",
      "Voice interaction",
      "AI image generation",
      "Community discussions",
    ],
    aggregateRating: undefined, // add once a real, verifiable rating exists — never fabricate this
  };
}

export function generateBreadcrumbSchema(items: { name: string; path?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.path && { item: absoluteUrl(item.path) }),
    })),
  };
}
