import { AlertTriangle, Cpu, ListTree, Zap } from "lucide-react";
import { LiveDot } from "@/components/admin/motion/live-dot";
import { RevealGroup, RevealItem } from "@/components/admin/motion/reveal";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { OpsSnapshot } from "@/lib/admin/ops-snapshot";

const STATUS_META: Record<
  OpsSnapshot["status"],
  { label: string; signal: "healthy" | "degraded" | "critical" }
> = {
  healthy: { label: "All systems healthy", signal: "healthy" },
  degraded: { label: "Degraded", signal: "degraded" },
  throttled: { label: "Throttled", signal: "degraded" },
  billing_lag: { label: "Billing lag", signal: "critical" },
};

export function OpsHealthPanel({ ops }: { ops: OpsSnapshot }) {
  const meta = STATUS_META[ops.status];
  const circuitEntries = Object.entries(ops.providers.circuits);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <LiveDot status={meta.signal} />
        <p className="text-sm font-medium text-text-primary">{meta.label}</p>
        <span className="text-xs text-text-tertiary ml-auto">
          Updated {new Date(ops.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {ops.alerts.length > 0 && (
        <RevealGroup className="space-y-2">
          {ops.alerts.map((a, i) => (
            <RevealItem key={i}>
              <div
                className={cn(
                  "flex items-start gap-2.5 rounded-sm border px-3.5 py-2.5 text-sm",
                  a.severity === "error"
                    ? "border-danger/40 text-danger bg-danger/5"
                    : "border-gold-500/30 text-gold-400 bg-gold-500/5"
                )}
              >
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                {a.message}
              </div>
            </RevealItem>
          ))}
        </RevealGroup>
      )}

      <RevealGroup className="grid sm:grid-cols-3 gap-4">
        <RevealItem>
          <Card interactive={false} className="p-4">
            <div className="flex items-center gap-2 mb-2 text-text-tertiary">
              <Zap className="h-4 w-4" strokeWidth={1.75} />
              <span className="text-xs uppercase tracking-wide">AI Cost</span>
            </div>
            <p className="font-display text-xl text-text-primary">
              {ops.ai.estimatedCostHour}
              <span className="text-xs text-text-tertiary font-sans">/hr</span>
            </p>
            <p className="text-xs text-text-secondary mt-1">
              {ops.ai.budgetPct}% of hourly budget ·{" "}
              {ops.ai.cacheHitRatePct != null
                ? `${ops.ai.cacheHitRatePct}% cache hit`
                : "cache n/a"}
            </p>
          </Card>
        </RevealItem>

        <RevealItem>
          <Card interactive={false} className="p-4">
            <div className="flex items-center gap-2 mb-2 text-text-tertiary">
              <ListTree className="h-4 w-4" strokeWidth={1.75} />
              <span className="text-xs uppercase tracking-wide">Queue</span>
            </div>
            <p className="font-display text-xl text-text-primary tabular-nums">
              {ops.queue.total}
            </p>
            <p className="text-xs text-text-secondary mt-1">
              jobs pending · DLQ {ops.ai.billingDLQDepth}
            </p>
          </Card>
        </RevealItem>

        <RevealItem>
          <Card interactive={false} className="p-4">
            <div className="flex items-center gap-2 mb-2 text-text-tertiary">
              <Cpu className="h-4 w-4" strokeWidth={1.75} />
              <span className="text-xs uppercase tracking-wide">Providers</span>
            </div>
            <p className="font-display text-xl text-text-primary">
              {ops.providers.allHealthy ? "All up" : `${ops.providers.openCircuits.length} open`}
            </p>
            <p className="text-xs text-text-secondary mt-1">
              {circuitEntries.length} circuits monitored
            </p>
          </Card>
        </RevealItem>
      </RevealGroup>

      <RevealGroup className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        {circuitEntries.map(([name, c]) => (
          <RevealItem key={name}>
            <div className="flex items-center gap-2.5 rounded-sm border border-border-hairline px-3 py-2.5">
              <LiveDot status={c.state === "closed" ? "healthy" : c.state === "half-open" ? "degraded" : "critical"} />
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-primary truncate capitalize">
                  {name.replace(/-/g, " ")}
                </p>
                <p className="text-[11px] text-text-tertiary capitalize">{c.state}</p>
              </div>
            </div>
          </RevealItem>
        ))}
      </RevealGroup>
    </div>
  );
}
