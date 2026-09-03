import type { Database }    from "@/types/supabase";
import { createClient }     from "@supabase/supabase-js";
import { env }              from "@/env";

// Next.js's build phase always forces NODE_ENV=production and statically
// evaluates every module (including this one) to collect page data, before
// any real secrets are necessarily available — env.ts itself tolerates this
// via the same NEXT_PHASE check and falls back to an empty `{}` cast as the
// full env type, so `env.NEXT_PUBLIC_SUPABASE_URL` can genuinely be
// `undefined` here at build time even though TypeScript thinks it's always
// `string`. A bare placeholder is fine here ONLY because nothing during the
// build phase actually issues a network call against this client.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

/**
 * supabaseAdmin — Service-role client for server-side operations.
 * Bypasses RLS. Use only in API routes and server actions, never in Client Components.
 *
 * B-01 fix: previously read process.env directly with its own
 * `?? "placeholder-service-role-key"` fallback that was always active —
 * even at real runtime in production. That meant a misconfigured secret in
 * production would silently construct a working-looking client against
 * placeholder credentials; every call would pass client instantiation and
 * only fail later at the API layer with a generic 401 instead of failing
 * loudly at boot. Importing from `@/env` ties this client to the same
 * validated, fail-fast source of truth used everywhere else — the
 * build-phase placeholder above is the only remaining exception, and it's
 * scoped specifically to `next build`'s static analysis pass, not to any
 * runtime path.
 */
export const supabaseAdmin = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL || (isBuildPhase ? "https://placeholder.supabase.co" : ""),
  env.SUPABASE_SERVICE_ROLE_KEY || (isBuildPhase ? "placeholder-service-role-key" : ""),
  {
    auth: { persistSession: false, autoRefreshToken: false },
    db:   { schema: "public" },
  }
);

// NOTE: a `supabasePool` export previously existed here, intended as a
// PgBouncer/Supavisor-backed client for high-connection-count scenarios. It
// passed a Postgres connection string (SUPABASE_DB_POOLER_URL — something
// like postgresql://...@...pooler.supabase.com:6543/postgres) directly into
// createClient(), which throws "Invalid supabaseUrl: Must be a valid HTTP
// or HTTPS URL" — the Supabase JS SDK's createClient() always wants the
// project's HTTPS REST endpoint, never a raw Postgres connection string, so
// this could never have worked. It also had zero call sites anywhere in the
// app. Removed rather than "fixed" — a real pooled-Postgres client would
// need an actual Postgres driver (e.g. `pg` or `postgres`), which isn't
// pulled into a feature anywhere today; add it deliberately if/when a
// specific high-connection-count use case actually needs it.
