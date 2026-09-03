"use client";

import { useEffect, useState } from "react";
import Image, { type ImageProps } from "next/image";
import { CHARACTER_IMAGE_FALLBACK } from "@/lib/utils";

/**
 * IMAGES-NOT-RENDERING FIX (2026-08-28 whole-app pass): resolveImageSrc
 * (lib/utils.ts) only validates that a URL's *host* is safe to request —
 * an allowlisted remote host, or a same-origin "/" path. It has no way to
 * know whether that path actually 404s (deleted asset, typo'd filename, a
 * DB row that was never backfilled with real art) — that's a real network
 * request the browser hasn't made yet at render time. Every call site that
 * rendered a resolveImageSrc(...) result straight into next/image's <Image>
 * was therefore one bad URL away from a raw broken-image icon, despite
 * several of those call sites' own comments already describing "falls back
 * to the shared placeholder" as the intended behavior.
 *
 * Drop-in replacement for next/image's default export: same props, same
 * rendering, but swaps to `fallback` on error instead of leaving a broken
 * icon. Resets its error state if `src` changes, so a recycled component
 * instance (list virtualization, swipe-card recycling, a new character
 * selected in the same DOM node) gets a fresh attempt at the new src
 * rather than staying stuck on the previous src's fallback.
 */
export function SafeImage({
  src,
  fallback = CHARACTER_IMAGE_FALLBACK,
  onError,
  ...rest
}: ImageProps & { fallback?: string }) {
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [src]);

  return (
    // eslint-disable-next-line jsx-a11y/alt-text -- `alt` is a required prop (enforced by ImageProps) and always present in `...rest`; the linter can't see it through the spread.
    <Image
      {...rest}
      src={errored ? fallback : src}
      onError={(e) => {
        setErrored(true);
        onError?.(e);
      }}
    />
  );
}
