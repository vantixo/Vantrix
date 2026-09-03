import "server-only";
import { cookies } from "next/headers";
import { absoluteUrl } from "@/lib/utils";

/**
 * FRONTEND_DIRECTIVE §10 draws a line between two Server Component data
 * paths: call a lib/* function directly when the route handler is a thin
 * wrapper, or go through HTTP when the route does "real request-shaping
 * ... you don't want to reimplement." /api/discover/featured and
 * /api/user/home-context are squarely the second case — NSFW gating, the
 * personalization/AI-curator pass, urgency sorting, and graceful-degrade
 * error handling all live inline in those route handlers, not in a
 * separate importable function. Reimplementing that in every Server
 * Component that wants discover data would fork the logic; calling the
 * route is the actually-thin option here.
 *
 * Server Component `fetch` has no implicit origin (unlike a browser same-
 * origin request) and does not automatically forward the incoming
 * request's cookies to an outgoing call, so both have to be supplied by
 * hand: an absolute URL via absoluteUrl(), and the session cookie via
 * next/headers so the target route sees the same authenticated user.
 */
export async function fetchInternal<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const cookieStore = await cookies();
  const res = await fetch(absoluteUrl(path), {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      cookie: cookieStore.toString(),
    },
    // These routes are per-user (auth + NSFW gating) and already own their
    // own CDN-facing Cache-Control headers; this server-to-server hop
    // should never serve a stale cross-user response out of Next's fetch
    // cache, so it opts out explicitly rather than inheriting a default.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`fetchInternal: ${path} responded ${res.status}`);
  }

  return res.json() as Promise<T>;
}
