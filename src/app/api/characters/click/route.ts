/**
 * POST /api/characters/click
 *
 * Fire-and-forget click ping from a character card — the "most clicked by
 * visitors" trending signal (see the 20261123_character_click_tracking.sql
 * migration and lib/recommendations/trending.ts). No auth: character
 * discovery is a public, logged-out-friendly surface (see discover/page.tsx's
 * "public acquisition funnel" note), and record_character_click() is
 * SECURITY DEFINER + granted to anon/authenticated — same shape as
 * increment_ad_stat() in /api/ads/route.ts.
 *
 * Body: { id: string }  — character UUID.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** See trending.ts's own comment — record_character_click() isn't in the
 *  generated Database type yet, so the rpc() call is narrowed to just the
 *  shape it needs rather than cast to `any`. */
type RpcCapable = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

export async function POST(req: NextRequest) {
  try {
    const { id } = (await req.json()) as { id?: string };
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid payload", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const { error } = await (supabaseAdmin as unknown as RpcCapable).rpc("record_character_click", {
      p_character_id: id,
    });
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("character click POST error", { error: err instanceof Error ? err.message : String(err) });
    // Stat pings should never break the user's experience — fail quiet.
    return NextResponse.json({ success: false }, { status: 200 });
  }
}
