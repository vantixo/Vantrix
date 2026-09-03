import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import Script from "next/script";
import { display, sans } from "@/lib/fonts";
import { ServiceWorkerRegister } from "@/components/shell/sw-register";
import { ViewportHeightSync } from "@/components/shell/viewport-height-sync";
import { AnalyticsPageview } from "@/lib/analytics/client";
import { ThemeHydration } from "@/components/theme/theme-hydration";
import {
  generateOrganizationSchema,
  generateSoftwareApplicationSchema,
  safeJsonLd,
} from "@/lib/seo/structured";
import "./globals.css";

// BRAND POSITIONING (keep in sync with src/app/llms.txt/route.ts and
// the brand positioning doc): tagline "A living universe of AI
// characters," promise "They remember you. They change with you. Their
// world keeps going." Title/description below are the copy search
// engines and AI answer engines pull first, so they carry the
// persistence differentiator rather than generic "AI companion" copy.
export const metadata: Metadata = {
  title: "Vantrix — A Living Universe of AI Characters",
  description:
    "Vantrix is a living universe of AI characters. They remember you, they change with you, and their world keeps going — persistent memory and evolving personalities, not a chatbot that resets every session.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Vantrix",
  },
  // APPLE-TOUCH-ICON FIX: manifest.webmanifest's full icon set (including
  // the two maskable entries) only ever reaches Chrome/Edge/Android's
  // install prompt — iOS Safari's "Add to Home Screen" doesn't read the
  // web manifest for icons at all, it specifically needs a
  // <link rel="apple-touch-icon"> in the document head. Without one, an
  // iOS home-screen install silently falls back to an auto-generated
  // screenshot of the page as its icon instead of the Vantrix mark.
  // Next's Metadata API emits that link from `icons.apple` below; reuses
  // the existing 192px icon (already square, already the right mark)
  // rather than shipping a dedicated apple-touch-icon asset.
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  // Gold default. A returning "nova" visitor gets this corrected to
  // #0A0710 before paint by public/theme-init.js (and live, on toggle, by
  // theme-store.ts) — this static value can't itself read the theme
  // cookie/localStorage without forcing every route in the app into
  // dynamic rendering (see theme-init.js's own comment for why that
  // tradeoff isn't worth it just for browser-chrome tint).
  themeColor: "#0A0A0A",
  width: "device-width",
  initialScale: 1,
  // MOBILE-SEND-FIX: without this, opening the on-screen keyboard doesn't
  // shrink the layout viewport, so every 100dvh-based height in the app
  // (chat-window.tsx's composer reservation in particular) doesn't
  // shrink either — the keyboard just overlays on top of the page
  // instead, covering the chat composer/Send button so taps on it never
  // land. "resizes-content" makes the browser actually resize (and
  // 100dvh recompute) when the keyboard opens, matching what
  // chat-window.tsx's calc() already assumed was happening.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="bg-base text-text-primary min-h-screen">
        {/* Site-wide Organization + SoftwareApplication JSON-LD. These were
            previously defined in lib/seo/structured.ts but never rendered
            anywhere — meaning search engines and LLM answer engines had no
            structured entity to resolve "Vantrix" to beyond the per-landing-
            page FAQ schema. Rendered once here (root layout) rather than
            per-page so every route — not just the SEO landing pages —
            carries the canonical brand identity/description. See that
            file's AI-DISCOVERABILITY comment on why both schema types are
            kept in sync with the same positioning language. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(generateOrganizationSchema()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(generateSoftwareApplicationSchema()) }}
        />
        {/* Sets data-theme on <html> (and corrects the theme-color meta
            tag) before hydration — see the file's own header comment for
            why this has to be an external beforeInteractive script rather
            than an inline one. */}
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <ThemeHydration />
        <ServiceWorkerRegister />
        <ViewportHeightSync />
        <Suspense fallback={null}>
          <AnalyticsPageview />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
