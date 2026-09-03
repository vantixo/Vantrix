import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges conditional class names (clsx) then dedupes conflicting Tailwind
 * utilities (tailwind-merge) — e.g. cn("px-2", cond && "px-4") resolves to
 * just "px-4" instead of emitting both. Every component in components/ui
 * and components/* wants this; re-added here per FRONTEND_DIRECTIVE §13
 * ("a 3-line restore, every component will want it").
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * `crypto.randomUUID()` is gated to secure contexts (HTTPS, or exactly
 * `localhost`/`127.0.0.1`) — it's `undefined` on plain-HTTP LAN origins
 * like `http://10.x.x.x:3000`, and calling it there throws
 * "crypto.randomUUID is not a function" synchronously. That's fatal when
 * it's the first statement in a handler (e.g. chat-window.tsx's
 * newId(), called at the top of handleSend()): the throw happens before
 * any state update runs, so the UI just does nothing on tap. Elsewhere
 * it's merely misleading, e.g. inside a try/catch that reports a generic
 * "couldn't generate" error for what's actually a missing-API issue.
 *
 * `crypto.getRandomValues()` has no such secure-context restriction, so
 * we fall back to building a v4 UUID from it whenever `randomUUID` isn't
 * present.
 */
export function safeRandomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Per RFC 4122 §4.4: set version (4) and variant (10) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// NOTE: never import `@/env` here. That module validates the full server
// Zod schema (every secret key name included) against process.env; in a
// build target that still bundles this file into client-reachable code,
// that schema would ship to the client. NEXT_PUBLIC_* vars are inlined by
// Next.js at build time, so process.env is safe here regardless.

/**
 * Relative-time label ("3m ago", "2d ago"). Previously only lived as a
 * private copy inside notifications-list.tsx; pulled out here so the
 * community feed/thread components (which need the same formatting for
 * posts and replies) don't fork a third copy.
 */
export function timeAgo(iso: string, short = false): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return short ? "now" : "just now";
  if (mins < 60) return short ? `${mins}m` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return short ? `${hrs}h` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return short ? `${days}d` : `${days}d ago`;
  return formatDate(iso);
}

export function formatDate(input: string | number | Date): string {
  const date = new Date(input);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function absoluteUrl(path: string) {
  // LOCAL-DEV-SELF-FETCH-FIX: "localhost" was previously used as the
  // fallback here, but on Windows (and some Linux/WSL setups) "localhost"
  // often resolves to the IPv6 loopback (::1) first while `next dev` only
  // binds IPv4 — the self-fetch then fails with ECONNREFUSED even though
  // the browser's direct request to 127.0.0.1 works fine, silently
  // emptying every page that goes through fetchInternal in
  // lib/frontend/api.ts (e.g. /community, /dating, /profile/settings,
  // which all swallow the failure into an empty/"unavailable" state).
  //
  // BUG (this revision): the previous fix only applied that 127.0.0.1
  // fallback when NEXT_PUBLIC_APP_URL was completely unset. A `.env.local`
  // that explicitly sets NEXT_PUBLIC_APP_URL=http://localhost:3000 (a very
  // common local-dev value — it's what most Next.js setup guides suggest)
  // bypassed the fallback entirely via `??`, so the exact same
  // ECONNREFUSED self-fetch failure still happened. Confirmed this was
  // live: the `characters` table has 65 rows, so /api/community/list's
  // static General/Creator Hub entries plus every character community
  // should always render — the only way the page shows zero results is
  // this internal fetch failing and being swallowed into an empty array
  // (see getCommunities() in lib/frontend/community.ts). Rewriting
  // "localhost" -> "127.0.0.1" unconditionally in non-production closes
  // that gap: it fixes both the unset case and the explicitly-set-to-
  // localhost case, and is a no-op for every real deployment (whose
  // APP_URL is never "localhost").
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  let base = configured ?? "http://127.0.0.1:3000";
  if (process.env.NODE_ENV !== "production") {
    base = base.replace(/^(https?:\/\/)localhost(:\d+)?/i, "$1127.0.0.1$2");
  }
  // TRAILING-SLASH-FIX: NEXT_PUBLIC_APP_URL is very commonly copy-pasted
  // with a trailing slash (e.g. "http://127.0.0.1:3000/", or a prod value
  // like "https://vantrix.ink/"). Without stripping it, `${base}${path}`
  // produces a double slash ("http://127.0.0.1:3000//api/dating/world"),
  // which Next.js's router treats as a non-existent route and 404s —
  // silently breaking every single fetchInternal() call app-wide (dating
  // world, community list, gifts, matches, ...), each of which then
  // swallows the failure into an empty/"unavailable" state per its own
  // catch block. Stripping here, plus normalizing `path` to always start
  // with exactly one slash, makes this correct regardless of how the env
  // var or call site is formatted.
  base = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export function generateSEOTitle(title: string) {
  return `${title} | Vantrix — AI Companion & Dating`;
}

export function truncate(str: string, length: number) {
  return str.length > length ? `${str.substring(0, length)}...` : str;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns 1.0 for all countries — all users pay the same global price.
 * Regional discount pricing has been removed; this function is kept for
 * backwards-compatibility with call sites that may check the return value.
 */
export function getCountryMultiplier(_country?: string): number {
  return 1.0;
}

/**
 * Returns the full USD price for all users regardless of country.
 * No regional adjustments are applied.
 */
export function getLocalizedPrice(usd: number, _country?: string, _currency = "USD"): { amount: number; currency: string; display: string } {
  return { amount: usd, currency: "USD", display: `$${usd.toFixed(2)}` };
}

/**
 * Fallback shown wherever a character/conversation/ad image is missing.
 * characters.image_url is nullable in the DB (no NOT NULL constraint) even
 * though the TypeScript Character type optimistically claims `string` —
 * next/image's <Image> component throws a hard render error
 * ("Image is missing required 'src' property") on an empty/null/undefined
 * src, which is exactly the kind of error a generic error.tsx boundary
 * swallows into an unhelpful "Page error" with no detail visible to the
 * user. Always resolve through this before passing a value to <Image src=…>.
 *
 * PNG, not SVG: next/image's optimizer rejects SVG sources outright
 * ("image type is not allowed", HTTP 400) unless images.dangerouslyAllowSVG
 * is set in next.config.js — and that flag is named scarily for a reason:
 * it applies to every image that flows through <Image> site-wide, including
 * user-uploaded and AI-generated character images, which is a real SVG/XSS
 * surface to take on just to render a placeholder. A raster fallback avoids
 * the tradeoff entirely.
 */
export const CHARACTER_IMAGE_FALLBACK = "/images/character-placeholder.png";

// World hub (locations + factions) fallback — deliberately a separate
// asset from CHARACTER_IMAGE_FALLBACK. world_locations.image_url and
// factions.image_url are both nullable and, until every row is backfilled
// via /admin/world, most rows will be NULL — resolveImageSrc() used to
// silently substitute a character's portrait for a city/faction banner in
// that case (wrong subject entirely), because it only ever had one
// fallback to offer. This is a neutral compass/seal motif that reads
// correctly at both the 16:7 detail-page banner crop and the 4:3
// LocationCard/FactionCard crop.
export const WORLD_IMAGE_FALLBACK = "/images/world-placeholder.png";

// Story Mode scenario cover fallback — same reasoning as WORLD_IMAGE_FALLBACK.
// roleplay_scenarios.cover_image_url is nullable and, as of this constant's
// introduction, NULL on all 28 seeded scenarios ("The Heist", "Midnight
// Precinct", etc. — see the location/faction prompt sheets' scenario
// counterpart): world-scenarios-section.tsx, scenario-picker.tsx, and
// popular-scenarios.tsx's non-dedicated-image branch all called
// resolveImageSrc(scenario.cover_image_url) with no second argument, so
// every scenario without art rendered a character's portrait as its cover
// — wrong subject, same failure mode the World hub had. A quill-and-page
// motif reads correctly at both the scenario-picker card crop and the
// wider Home/World hub tile crops.
export const SCENARIO_IMAGE_FALLBACK = "/images/scenario-placeholder.png";

// Keep in sync with images.remotePatterns in next.config.js. next/image
// throws a hard, uncaught render error ("hostname is not configured under
// images in next.config.js") for any src on a host not in that list — it's
// not a warning, it takes down the whole route (this is what caused the
// /studio "Page error" before fal.media/v3.fal.media/fal-cdn.com were added
// to next.config.js). Mirroring the allowlist here lets us fail soft to the
// placeholder image instead, so a future un-whitelisted host degrades
// gracefully rather than crashing the page again.
const ALLOWED_IMAGE_HOSTS: (string | RegExp)[] = [
  "images.unsplash.com",
  "cdn.vantrix.ink",
  "vantrix.ink",
  "ui-avatars.com",
  "lh3.googleusercontent.com",
  /\.supabase\.co$/,
  /\.supabase\.in$/,
  "avatars.githubusercontent.com",
  "cdn.discordapp.com",
  "fal.media",
  "v3.fal.media",
  "fal-cdn.com",
];

// Exported (not just used internally by resolveImageSrc) so any other spot
// that renders an admin/DB-configured src through next/image directly —
// e.g. the /auth/login portrait collage — can validate a hostname *before*
// deciding whether to trust it, not just after receiving something to render.
//
// AVATAR-REVERT-FIX: this used to read `process.env.R2_PUBLIC_URL` — a
// server-only var, deliberately NOT prefixed NEXT_PUBLIC_ (see r2.ts/env.ts).
// Next.js only inlines NEXT_PUBLIC_* vars into the browser bundle; any other
// process.env.* reference resolves to `undefined` client-side. This file's
// own header comment above already states the rule this violated ("NEXT_
// PUBLIC_* vars are inlined... so process.env is safe here regardless") —
// R2_PUBLIC_URL doesn't meet that bar, so isAllowedImageHost silently fell
// through to the static ALLOWED_IMAGE_HOSTS list on every "use client"
// caller (avatar-upload.tsx, message-bubble.tsx, swipe-card.tsx, etc — see
// the audit that found this for the full call-site list). For any R2 bucket
// not on a custom domain that happens to already be in that static list,
// this meant: upload a new avatar → PATCH /api/profile/settings persists
// the real R2 URL correctly → router.refresh() correctly re-renders with
// that URL as `currentUrl` → but resolveImageSrc(currentUrl), run client-
// side, couldn't recognize the R2 host and silently substituted
// CHARACTER_IMAGE_FALLBACK instead. The upload and save both succeeded;
// only the client-side render check was wrong, which is why refreshing the
// page or checking the DB directly would have shown the correct URL stored
// — only the rendered image reverted.
//
// Fix: NEXT_PUBLIC_R2_PUBLIC_URL is a new, public mirror of R2_PUBLIC_URL
// (same value — a public CDN URL, not a secret, so mirroring it is safe;
// see .env.example). It's inlined into every bundle, server or client, so
// this check now actually works from "use client" components. Server-side
// callers still also fall back to the original R2_PUBLIC_URL so this keeps
// working immediately even if a deployment hasn't set the new var yet —
// only client-side rendering needs the NEXT_PUBLIC_ variant to be set.
export function isAllowedImageHost(hostname: string): boolean {
  const r2PublicUrl =
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_R2_PUBLIC_URL) ||
    (typeof process !== "undefined" && process.env?.R2_PUBLIC_URL) ||
    null;
  if (r2PublicUrl) {
    try {
      if (new URL(r2PublicUrl).hostname === hostname) return true;
    } catch {
      // Not a valid URL — ignore, fall through to the static list
    }
  }
  return ALLOWED_IMAGE_HOSTS.some(h =>
    typeof h === "string" ? h === hostname : h.test(hostname),
  );
}

export function resolveImageSrc(
  url?: string | null,
  fallback: string = CHARACTER_IMAGE_FALLBACK,
): string {
  if (!url || url.trim().length === 0) return fallback;
  // Local/relative paths (e.g. "/promos/x.jpg") always bypass the remote
  // host check — they're served from this app, not an external allowlist.
  if (url.startsWith("/")) return url;
  try {
    const hostname = new URL(url).hostname;
    return isAllowedImageHost(hostname) ? url : fallback;
  } catch {
    // Not a valid absolute URL — treat as unsafe/unusable, fall back.
    return fallback;
  }
}

/**
 * Video equivalent of resolveImageSrc's host check, for message.video_url
 * (chat's Fal Animate "living portrait" clips — same origin infra as
 * character images, per types/index.ts's video_url doc comment, so this
 * reuses isAllowedImageHost rather than maintaining a second allowlist).
 *
 * Returns null instead of a placeholder path on failure: unlike a character
 * image, there's no safe silent-fallback video to loop in its place, so
 * callers are expected to just skip rendering the video block entirely
 * when this returns null — same "degrade, don't crash" intent as
 * resolveImageSrc, just with "omit" instead of "substitute" as the fallback.
 */
export function resolveVideoSrc(url?: string | null): string | null {
  if (!url || url.trim().length === 0) return null;
  if (url.startsWith("/")) return url;
  try {
    const hostname = new URL(url).hostname;
    return isAllowedImageHost(hostname) ? url : null;
  } catch {
    return null;
  }
}
