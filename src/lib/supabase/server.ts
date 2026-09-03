import type { Database }             from "@/types/supabase";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/env";

export async function createClient() {
  const cookieStore = await cookies();
  const storageKey = cookieStore.get("vantrix-surface")?.value === "pwa"
    ? "vantrix-auth-pwa"
    : "vantrix-auth-web";

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { storageKey },
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try { cookieStore.set({ name, value, ...options }); } catch { /* server component */ }
      },
      remove(name: string, options: CookieOptions) {
        try { cookieStore.set({ name, value: "", ...options }); } catch { /* server component */ }
      },
    },
  });
}
