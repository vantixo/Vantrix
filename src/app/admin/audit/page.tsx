import { AuditLogTable } from "@/components/admin/audit/audit-log-table";

export default function AdminAuditPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16">
      <div>
        <h2 className="font-display text-2xl mb-1">Audit Log</h2>
        <p className="text-text-secondary text-sm">
          Every state-changing admin action, who did it, and when.
        </p>
      </div>
      <AuditLogTable />
    </div>
  );
}
