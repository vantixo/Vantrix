import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Canonical list of auditable admin actions. Kept as a union rather than a
 * DB CHECK constraint (see migration comment) so adding a new action type
 * is a one-line change here, not a migration.
 */
export type AdminAuditAction =
  | "user.disable"
  | "user.enable"
  | "user.tokens_adjusted"
  | "user.role_changed"
  | "character.approved"
  | "character.rejected"
  | "content.generated"
  | "content.published"
  | "content.rejected"
  | "revocation_flag.cleared"
  | "referral.approved"
  | "referral.rejected"
  | "suspension.lifted"
  | "permission.granted"
  | "permission.revoked";

export type AdminAuditTargetType =
  | "user"
  | "character"
  | "content_queue_item"
  | "referral_partner"
  | "moderator_permission";

export interface RecordAdminActionInput {
  adminId: string;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string;
  targetLabel?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Persists one row to admin_audit_log. Fire-and-log: a failure to write
 * the audit row is logged loudly but never thrown back to the caller —
 * an audit-log outage shouldn't block the underlying admin action (e.g.
 * disabling an abusive account) from completing. Every call site should
 * still call this *after* the underlying mutation succeeds, so the log
 * only records actions that actually happened.
 */
export async function recordAdminAction(input: RecordAdminActionInput): Promise<void> {
  const { error } = await supabaseAdmin.from("admin_audit_log").insert({
    admin_id: input.adminId,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    target_label: input.targetLabel ?? null,
    metadata: (input.metadata ?? {}) as never,
  });

  if (error) {
    logger.error("Admin audit log write failed", {
      error, action: input.action, targetType: input.targetType, targetId: input.targetId,
    });
  }
}

export interface AdminAuditLogRow {
  id: string;
  created_at: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string;
  target_label: string | null;
  metadata: Record<string, unknown>;
  admin_username?: string | null;
}

export interface ListAdminAuditLogInput {
  action?: string;
  targetType?: AdminAuditTargetType;
  adminId?: string;
  limit?: number;
  before?: string; // created_at cursor, exclusive — for "load older" pagination
}

/**
 * Reads admin_audit_log, newest first, with optional filters. Joins the
 * acting admin's username in a second query (rather than a Postgres join)
 * since supabaseAdmin's query builder doesn't have a FK relationship
 * declared from admin_audit_log.admin_id -> profiles — same pattern as
 * getAdminOverview's recentUsers query.
 */
export async function listAdminAuditLog(
  input: ListAdminAuditLogInput = {},
): Promise<{ rows: AdminAuditLogRow[]; hasMore: boolean }> {
  const limit = Math.min(input.limit ?? 50, 200);

  let query = supabaseAdmin
    .from("admin_audit_log")
    .select("id, created_at, admin_id, action, target_type, target_id, target_label, metadata")
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (input.action) query = query.eq("action", input.action);
  if (input.targetType) query = query.eq("target_type", input.targetType);
  if (input.adminId) query = query.eq("admin_id", input.adminId);
  if (input.before) query = query.lt("created_at", input.before);

  const { data, error } = await query;
  if (error) {
    logger.error("Admin audit log read failed", { error });
    return { rows: [], hasMore: false };
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const adminIds = [...new Set(page.map((r) => r.admin_id))];
  const usernameById = new Map<string, string | null>();
  if (adminIds.length > 0) {
    const { data: admins } = await supabaseAdmin
      .from("profiles")
      .select("id, username")
      .in("id", adminIds);
    for (const a of admins ?? []) usernameById.set(a.id, a.username);
  }

  return {
    rows: page.map((r) => ({
      ...r,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      admin_username: usernameById.get(r.admin_id) ?? null,
    })),
    hasMore,
  };
}
