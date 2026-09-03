// src/lib/admin/safe-rpc.ts
// ─────────────────────────────────────────────────────────────────────────
// Shared by every admin data-layer module that calls a Postgres RPC
// (analytics.ts, analytics-engagement.ts, and any future one) — extracted
// out of analytics.ts so a second dashboard's data layer didn't have to
// either re-implement this or import a module whose name/doc comment says
// it's specifically analytics.ts's own concern.
// ─────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * `name` is a dynamic RPC name (union of many generated function
 * overloads), so the generated Supabase client type can't resolve a single
 * overload for a generic dispatch helper. Narrowed to just the `rpc` shape
 * actually used here instead of `any`, so a typo in `supabaseAdmin`
 * elsewhere would still be caught.
 */
type RpcCapable = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

/**
 * Calls a Postgres RPC and fails soft to `fallback` on any error, logging
 * rather than throwing — so one broken metric can't take a whole dashboard
 * down. Every admin analytics/engagement query goes through this.
 */
export async function safeRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
  fallback: T
): Promise<T> {
  try {
    const { data, error } = await (supabaseAdmin as unknown as RpcCapable).rpc(name, args);
    if (error) throw error;
    return (data as T) ?? fallback;
  } catch (err) {
    logger.error("admin:analytics-rpc-error", { rpc: name, error: String(err) });
    return fallback;
  }
}
