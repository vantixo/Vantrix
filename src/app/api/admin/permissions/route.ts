/**
 * /api/admin/permissions — grant/revoke moderator permissions
 *
 * The granular AdminPermission system (src/lib/auth/permissions.ts) has
 * existed since the 20260936 migration — hasPermission/requirePermission/
 * listModeratorPermissions and the admin_permissions table are all real —
 * but nothing ever called them: no route to grant or revoke a permission,
 * so every 'moderator'-role account was permission-less by construction
 * and the whole system was dead code. This route is the missing write
 * surface; src/app/admin/permissions/page.tsx is the missing UI.
 *
 * GET    — list every moderator and their current grants
 * POST   — grant a permission to a moderator
 * DELETE — revoke a permission from a moderator
 *
 * Gated by requireAdmin (full admins only) rather than requirePermission
 * ('permissions.manage') because that permission itself only means
 * anything for moderators, and moderators granting/revoking their own or
 * each other's permissions would be a privilege-escalation hole. Matches
 * the migration's own comment: "moderators can't self-grant — only
 * enforced at the application layer via requirePermission gating the
 * grant/revoke actions themselves to full admins."
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { requireAdmin } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { ALL_PERMISSIONS, listModeratorPermissions, type AdminPermission } from "@/lib/auth/permissions";
import { toErrorBody, AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const permissionSchema = z.enum(ALL_PERMISSIONS as [AdminPermission, ...AdminPermission[]]);

export async function GET() {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    await requireAdmin(user.id);

    const moderators = await listModeratorPermissions();
    return NextResponse.json({ moderators, allPermissions: ALL_PERMISSIONS });
  } catch (err) {
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

const grantSchema = z.object({
  moderatorId: z.string().uuid(),
  permission: permissionSchema,
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    await requireAdmin(user.id);

    const parsed = grantSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    const { moderatorId, permission } = parsed.data;

    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("id, role, username")
      .eq("id", moderatorId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: "User not found", code: "NOT_FOUND" }, { status: 404 });
    }
    if (target.role !== "moderator") {
      return NextResponse.json(
        { error: "Only moderator-role accounts can hold granular permissions", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }

    const { error } = await supabaseAdmin
      .from("admin_permissions")
      .upsert(
        { moderator_id: moderatorId, permission, granted_by: user.id },
        { onConflict: "moderator_id,permission", ignoreDuplicates: true },
      );
    if (error) {
      logger.error("Grant permission failed", { error, moderatorId, permission });
      return NextResponse.json({ error: "Failed to grant permission" }, { status: 500 });
    }

    await recordAdminAction({
      adminId: user.id,
      action: "permission.granted",
      targetType: "moderator_permission",
      targetId: moderatorId,
      targetLabel: target.username,
      metadata: { permission },
    });

    return NextResponse.json({ ok: true, moderatorId, permission });
  } catch (err) {
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

const revokeSchema = z.object({
  moderatorId: z.string().uuid(),
  permission: permissionSchema,
});

export async function DELETE(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    await requireAdmin(user.id);

    const url = req.nextUrl;
    const parsed = revokeSchema.safeParse({
      moderatorId: url.searchParams.get("moderatorId"),
      permission: url.searchParams.get("permission"),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    const { moderatorId, permission } = parsed.data;

    const { error } = await supabaseAdmin
      .from("admin_permissions")
      .delete()
      .eq("moderator_id", moderatorId)
      .eq("permission", permission);
    if (error) {
      logger.error("Revoke permission failed", { error, moderatorId, permission });
      return NextResponse.json({ error: "Failed to revoke permission" }, { status: 500 });
    }

    await recordAdminAction({
      adminId: user.id,
      action: "permission.revoked",
      targetType: "moderator_permission",
      targetId: moderatorId,
      metadata: { permission },
    });

    return NextResponse.json({ ok: true, moderatorId, permission });
  } catch (err) {
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
