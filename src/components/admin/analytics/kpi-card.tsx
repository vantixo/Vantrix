import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { AnimatedCounter } from "@/components/admin/motion/animated-counter";
import { RevealItem } from "@/components/admin/motion/reveal";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  /** A plain number animates via AnimatedCounter; a string (e.g. "$1,204") renders as-is. */
  value: number | string;
  sublabel?: string;
  /** % change vs. the prior half of the window — positive/negative styles automatically. */
  trendPct?: number | null;
  /** Whether a rising trend is good for this metric — inverts arrow color for e.g. churn/cancellations. */
  trendGoodDirection?: "up" | "down";
  accent?: boolean;
}

export function KpiCard({
  icon: Icon,
  label,
  value,
  sublabel,
  trendPct,
  trendGoodDirection = "up",
  accent,
}: KpiCardProps) {
  const hasTrend = trendPct !== null && trendPct !== undefined && Number.isFinite(trendPct);
  const isPositive = hasTrend && trendPct! > 0;
  const isGood = hasTrend && (trendGoodDirection === "up" ? isPositive : !isPositive && trendPct !== 0);

  return (
    <RevealItem>
      <Card interactive={false} className="p-5">
        <div className="flex items-center justify-between mb-3">
          <Icon
            className={accent ? "h-4 w-4 text-gold-500" : "h-4 w-4 text-text-tertiary"}
            strokeWidth={1.75}
          />
          {hasTrend && trendPct !== 0 && (
            <span
              className={cn(
                "flex items-center gap-0.5 text-[11px] font-medium tabular-nums",
                isGood ? "text-success" : "text-danger"
              )}
            >
              {isPositive ? (
                <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
              ) : (
                <ArrowDownRight className="h-3 w-3" strokeWidth={2} />
              )}
              {Math.abs(trendPct!).toFixed(1)}%
            </span>
          )}
        </div>
        <div
          className={cn(
            "font-display text-2xl tabular-nums",
            accent ? "text-gold-400" : "text-text-primary"
          )}
        >
          {typeof value === "number" ? <AnimatedCounter value={value} /> : value}
        </div>
        <p className="text-xs text-text-secondary mt-1">{label}</p>
        {sublabel && <p className="text-[11px] text-text-tertiary mt-0.5">{sublabel}</p>}
      </Card>
    </RevealItem>
  );
}
