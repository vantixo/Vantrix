"use client";

import type { Database }        from "@/types/supabase";
import { createBrowserClient }  from "@supabase/ssr";

// NEXT_PUBLIC_* vars are inlined at build time by Next.js.
// During `next build` static page generation these are undefined — we fall
// back to placeholder values so the build succeeds. At runtime in a real
// browser the real values must be present (enforced by env.ts at server boot).
const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "https://placeholder.supabase.co";
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";

// The installed PWA and the plain website are the same origin, so by default
// Supabase's browser client (localStorage-backed) shares ONE auth session
// between them. That means logging into Account B on the website silently
// signs out / overwrites Account A in the installed app (and vice versa) —
// users can't stay on two different accounts on one device.
//
// Fix: give the installed (standalone) PWA its own storage key, isolated
// from the website's session. Each surface keeps its own login.
function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function createClient() {
  const storageKey = isStandalonePwa()
    ? "vantrix-auth-pwa"
    : "vantrix-auth-web";

  return createBrowserClient<Database>(supabaseUrl, supabaseAnon, {
    auth: { storageKey },
  });
}
