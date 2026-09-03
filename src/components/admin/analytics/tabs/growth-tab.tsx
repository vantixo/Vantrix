import { DollarSign, CreditCard, UserMinus, Percent, TrendingUp, Repeat } from "lucide-react";
import { RevealGroup } from "@/components/admin/motion/reveal";
import { KpiCard } from "@/components/admin/analytics/kpi-card";
import { SectionCard } from "@/components/admin/analytics/section-card";
import { TrendChart } from "@/components/admin/analytics/trend-chart";
import { RankedBarList } from "@/components/admin/analytics/ranked-bar-list";
import { RetentionTable } from "@/components/admin/analytics/retention-table";
import { mergeSeriesByDay } from "@/lib/admin/merge-series";
import { trendFromSeries } from "@/lib/admin/trend";
import { formatUsd } from "@/lib/admin/format";
import type { AnalyticsSnapshot } from "@/lib/admin/analytics";

export function GrowthTab({ analytics }: { analytics: AnalyticsSnapshot }) {
  const revenueTrend = trendFromSeries(analytics.revenue.map((r) => r.revenue_usd));
  const churnTrend = trendFromSeries(analytics.churn.map((c) => c.cancellations));

  const subsFlow = mergeSeriesByDay(
    analytics.revenue.map((r) => ({ day: r.day, new_subs: r.new_subs })),
    { data: analytics.churn, keys: ["cancellations"] }
  );

  return (
    <div className="space-y-6">
      <RevealGroup className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard icon={DollarSign} label="MRR" value={formatUsd(analytics.mrrUsd)} trendPct={revenueTrend} accent />
        <KpiCard icon={CreditCard} label="Active USD subs" value={analytics.activeSubsUsd} />
        <KpiCard icon={Repeat} label="Active other-currency" value={analytics.activeSubsOther} />
        <KpiCard
          icon={UserMinus}
          label="Cancelled (30d)"
          value={analytics.cancelled30d}
          trendPct={churnTrend}
          trendGoodDirection="down"
        />
        <KpiCard icon={Percent} label="ARPU" value={formatUsd(analytics.derived.arpuUsd)} sublabel="Per USD subscriber" />
        <KpiCard
          icon={TrendingUp}
          label="Avg week-1 retention"
          value={analytics.derived.avgWeek1RetentionPct !== null ? `${analytics.derived.avgWeek1RetentionPct}%` : "—"}
        />
      </RevealGroup>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Revenue" subtitle="USD-denominated subscription revenue, by day">
          <TrendChart
            data={analytics.revenue}
            series={[{ key: "revenue_usd", label: "Revenue (USD)", variant: "primary" }]}
          />
        </SectionCard>
        <SectionCard title="Subscriber flow" subtitle="New subscriptions vs. cancellations">
          <TrendChart
            data={subsFlow}
            series={[
              { key: "new_subs", label: "New subs", variant: "primary" },
              { key: "cancellations", label: "Cancellations", variant: "danger" },
            ]}
          />
        </SectionCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Tier breakdown" subtitle="Users by subscription tier">
          <RankedBarList
            items={analytics.tierBreakdown.map((t) => ({ key: t.tier, label: t.tier, value: t.users }))}
          />
        </SectionCard>
        <SectionCard title="Retention cohorts" subtitle="% of each signup cohort still active by week">
          <RetentionTable cohorts={analytics.retention} />
        </SectionCard>
      </div>
    </div>
  );
}
