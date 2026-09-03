import { PermissionsManager } from "@/components/admin/permissions/permissions-manager";

export default function AdminPermissionsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      <div>
        <h2 className="font-display text-2xl mb-1">Permissions</h2>
        <p className="text-text-secondary text-sm">
          Scope what moderator-role accounts can do.
        </p>
      </div>
      <PermissionsManager />
    </div>
  );
}
