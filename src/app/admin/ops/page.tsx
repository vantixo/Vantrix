import { OpsConsole } from "@/components/admin/ops/ops-console";

export default function AdminOpsPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16">
      <div>
        <h2 className="font-display text-2xl mb-1">Ops</h2>
        <p className="text-text-secondary text-sm">
          Background jobs, circuit breakers, and one-off data operations.
        </p>
      </div>
      <OpsConsole />
    </div>
  );
}
