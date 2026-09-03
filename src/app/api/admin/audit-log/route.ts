/**
 * GET /api/admin/audit-log
 *
 * Admin-only, read-only endpoint over admin_audit_log. The table has been
 * written to since the 20260935 migration but had no read surface at all —
 * "who disabled this user" was answerable only with a raw SQL console.
 *
 * Query params:
 *   action     — filter by exact AdminAuditAction (optional)
 *   targetType — filter by AdminAuditTargetType (optional)
 *   adminId    — filter to one acting admin (optional)
 *   before     — ISO timestamp cursor, exclusive, for "load older" paging
 *   limit      — page size, default 50, capped at 200
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { requireAdmin } from "@/lib/auth/admin";
import { listAdminAuditLog } from "@/lib/admin/audit";
import { toErrorBody, AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    await requireAdmin(user.id);

    const url = req.nextUrl;
    const { rows, hasMore } = await listAdminAuditLog({
      action: url.searchParams.get("action") ?? undefined,
      targetType: (url.searchParams.get("targetType") as never) ?? undefined,
      adminId: url.searchParams.get("adminId") ?? undefined,
      before: url.searchParams.get("before") ?? undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
    });

    return NextResponse.json({ entries: rows, hasMore });
  } catch (err) {
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
