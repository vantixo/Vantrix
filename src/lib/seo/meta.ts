import { Metadata } from "next";
import { absoluteUrl } from "@/lib/utils";
import { env } from "@/env";

interface SEOMetaOptions {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article" | "product";
  publishedTime?: string;
  modifiedTime?: string;
  keywords?: string[];
  noIndex?: boolean;
}

export function generateSEOMeta({
  title,
  description,
  path,
  image = "/og-image.jpg",
  type = "website",
  publishedTime,
  modifiedTime,
  keywords = [],
  noIndex = false,
}: SEOMetaOptions): Metadata {
  const url = absoluteUrl(path);
  const ogImage = absoluteUrl(image);

  return {
    title,
    description,
    keywords: [
      "AI companion",
      "AI girlfriend",
      "AI boyfriend",
      "AI chat",
      "AI dating",
      "anime AI",
      "character AI",
      "virtual companion",
      ...keywords,
    ],
    authors: [{ name: "Vantrix Ai" }],
    creator: "Vantrix Ai",
    publisher: "Vantrix Ai",
    metadataBase: new URL(absoluteUrl("/")),
    alternates: {
      // Canonical only — hreflang removed until i18n routes (/en/, /es/ etc)
      // actually exist. Fake hreflang pointing to 404s wastes crawl budget
      // and can cause Google to deindex pages.
      canonical: url,
    },
    openGraph: ({
      title,
      description,
      url,
      siteName: "Vantrix Ai",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      locale: "en_US",
      type,
      ...(publishedTime && { publishedTime }),
      ...(modifiedTime && { modifiedTime }),
    } as Record<string, unknown>),
  twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
      creator: "@vantrixai",
    },
    robots: {
      index: !noIndex,
      follow: !noIndex,
      googleBot: {
        index: !noIndex,
        follow: !noIndex,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION ?? "",
    },
  };
}

// Dynamic OG image URL for character pages
export function characterOgImageUrl(name: string, imageUrl?: string | null): string {
  const APP_URL = env.NEXT_PUBLIC_APP_URL;
  const params = new URLSearchParams({ title: name });
  if (imageUrl) params.set("image", imageUrl);
  return `${APP_URL}/api/og?${params.toString()}`;
}
