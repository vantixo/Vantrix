// src/lib/supabase/middleware.ts
//
// M-01 FIX: updateSession now returns the user it already fetched instead of
// discarding it. Previously, middleware.ts called updateSession (which called
// auth.getUser() internally), then immediately created a second Supabase client
// and called auth.getUser() again for the age-gate check — two round-trips on
// every protected page request.
//
// Now: one auth.getUser() call per request, full stop.
// Callers that previously re-checked the user should destructure `user` from
// the return value instead of creating their own client.
//
// ENV-FIX: previously read process.env.NEXT_PUBLIC_SUPABASE_URL! and
// process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! directly with a non-null
// assertion and no fallback. If those vars were empty/missing for any
// reason (wrong env file for the running command, values only added to
// .env.production while running `next dev`, a typo in the var name, etc.),
// createServerClient() throws "Your project's URL and Key are required..."
// — and since this function runs on literally every request, that one
// missing value took down the entire app on every route, not just
// Supabase-dependent ones. Routing through the validated `env` object
// means: (a) the same values as everywhere else in the app — no more
// silent per-file drift, (b) in production a genuinely missing value fails
// loudly and clearly at boot via env.ts's own error, instead of this
// cryptic Supabase-internal message repeated on every request, and (c) in
// dev, missing values fall back to env.ts's placeholders instead of
// crashing outright — auth will correctly fail to work, but the server
// stays up and every other route keeps functioning while you fix it.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest }          from 'next/server';
import type { User }                               from '@supabase/supabase-js';
import { edgeEnv as env }                          from '@/env.edge';

export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const storageKey = request.cookies.get('vantrix-surface')?.value === 'pwa'
    ? 'vantrix-auth-pwa'
    : 'vantrix-auth-web';

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { storageKey },
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );

  // Single auth.getUser() call — refreshes the session cookie AND gives us
  // the user. Returned to callers so they don't need a second round-trip.
  const { data: { user } } = await supabase.auth.getUser();

  return { response, user };
}
