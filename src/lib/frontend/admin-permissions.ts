import type { AdminPermission, ModeratorPermissionsRow } from "@/lib/auth/permissions";

export type { AdminPermission, ModeratorPermissionsRow };

export async function fetchModeratorPermissions(): Promise<{
  moderators: ModeratorPermissionsRow[];
  allPermissions: AdminPermission[];
}> {
  const res = await fetch("/api/admin/permissions");
  if (!res.ok) throw new Error("Failed to load permissions");
  return res.json();
}

export async function grantPermission(moderatorId: string, permission: AdminPermission): Promise<void> {
  const res = await fetch("/api/admin/permissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ moderatorId, permission }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to grant permission");
  }
}

export async function revokePermission(moderatorId: string, permission: AdminPermission): Promise<void> {
  const qs = new URLSearchParams({ moderatorId, permission });
  const res = await fetch(`/api/admin/permissions?${qs.toString()}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to revoke permission");
  }
}
