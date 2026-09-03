import type { AdminAuditLogRow } from "@/lib/admin/audit";

export type { AdminAuditLogRow };

export async function fetchAuditLog(params: {
  action?: string;
  targetType?: string;
  before?: string;
} = {}): Promise<{ entries: AdminAuditLogRow[]; hasMore: boolean }> {
  const qs = new URLSearchParams();
  if (params.action) qs.set("action", params.action);
  if (params.targetType) qs.set("targetType", params.targetType);
  if (params.before) qs.set("before", params.before);

  const res = await fetch(`/api/admin/audit-log?${qs.toString()}`);
  if (!res.ok) throw new Error("Failed to load audit log");
  return res.json();
}
