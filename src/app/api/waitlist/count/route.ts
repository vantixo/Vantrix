/**
 * GET /api/waitlist/count
 * Public — returns total signup count for the website live counter.
 * Cache-Control: 60s so it doesn't hammer the DB.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = (process.env.WAITLIST_ALLOWED_ORIGINS ?? "").split(",").map(o => o.trim());

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "*";
  const cors = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] ?? "*"),
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
  };

  const { count, error } = await supabaseAdmin
    .from("waitlist")
    .select("*", { count: "exact", head: true });

  if (error) {
    return NextResponse.json({ count: 0 }, { status: 200, headers: cors });
  }

  return NextResponse.json({ count: count ?? 0 }, { status: 200, headers: cors });
}
