"use client";

/**
 * useCountry — reads the `vx_country` cookie set by middleware.ts (from the
 * edge network's ip-country header) for lightweight copy targeting.
 *
 * Returns `null` until mounted (SSR-safe: this page is a client component
 * with no server-rendered personalization, so there's nothing to hydrate
 * against) and thereafter either the ISO 3166-1 alpha-2 code or "" if the
 * cookie is missing (e.g. non-Vercel/non-Cloudflare environments, or a
 * request that hit middleware before this deploy).
 *
 * Not for anything security- or access-relevant — copy targeting only.
 */

import { useEffect, useState } from "react";

function readCountryCookie(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)vx_country=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function useCountry(): string | null {
  const [country, setCountry] = useState<string | null>(null);

  useEffect(() => {
    setCountry(readCountryCookie());
  }, []);

  return country;
}
