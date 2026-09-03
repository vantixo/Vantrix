/**
 * GET /api/admin/waitlist-export
 * Admin-only — exports the full waitlist as CSV or JSON.
 *
 * Query params:
 *   format — "csv" (default) | "json"
 *   source — filter by source (optional)
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser }             from "@/lib/auth/get-authed-user";
import { requireAdmin }              from "@/lib/auth/admin";
import { supabaseAdmin }             from "@/lib/supabase/admin";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";

type WaitlistRow = {
  id:         number;
  email:      string;
  source:     string;
  confirmed:  boolean;
  created_at: string;
};

export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await requireAdmin(user.id);

  const url    = new URL(req.url);
  const format = url.searchParams.get("format") ?? "csv";
  const source = url.searchParams.get("source");

  let query = (supabaseAdmin as ReturnType<typeof supabaseAdmin.from> extends never
    ? any  // eslint-disable-line
    : typeof supabaseAdmin)
    .from("waitlist")
    .select("id, email, source, confirmed, created_at")
    .order("created_at", { ascending: false });

  if (source) query = query.eq("source", source);

  const { data, error } = await query as { data: WaitlistRow[] | null; error: unknown };

  if (error || !data) {
    logger.error("waitlist export failed", { error });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  logger.info("waitlist export", { admin: user.id, count: data.length, format });

  if (format === "json") {
    return NextResponse.json(data, {
      headers: {
        "Content-Disposition": `attachment; filename="vantrix-waitlist-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  }

  const header = ["id", "email", "source", "confirmed", "created_at"].join(",");
  const rows   = data.map(r =>
    [r.id, `"${r.email}"`, r.source, r.confirmed, r.created_at].join(",")
  );
  const csv = [header, ...rows].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type":        "text/csv",
      "Content-Disposition": `attachment; filename="vantrix-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
