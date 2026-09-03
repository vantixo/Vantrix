import { ShieldAlert, AlertTriangle, Bot, LifeBuoy } from "lucide-react";
import { RevealGroup } from "@/components/admin/motion/reveal";
import { KpiCard } from "@/components/admin/analytics/kpi-card";
import { SectionCard } from "@/components/admin/analytics/section-card";
import { TrendChart } from "@/components/admin/analytics/trend-chart";
import { RankedBarList } from "@/components/admin/analytics/ranked-bar-list";
import { trendFromSeries } from "@/lib/admin/trend";
import type { AnalyticsSnapshot } from "@/lib/admin/analytics";

export function SafetyTab({ analytics }: { analytics: AnalyticsSnapshot }) {
  const confirmedBots = analytics.abuseTrend.reduce((s, a) => s + a.confirmed_bot, 0);
  const signalsTrend = trendFromSeries(analytics.abuseTrend.map((a) => a.signals));

  return (
    <div className="space-y-6">
      <RevealGroup className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          icon={ShieldAlert}
          label="Abuse signals"
          value={analytics.derived.totalAbuseSignals}
          trendPct={signalsTrend}
          trendGoodDirection="down"
        />
        <KpiCard icon={Bot} label="Confirmed bots" value={confirmedBots} trendGoodDirection="down" />
        <KpiCard
          icon={AlertTriangle}
          label="User reports"
          value={analytics.reportCategories.reduce((s, r) => s + r.count, 0)}
          trendGoodDirection="down"
        />
        <KpiCard
          icon={LifeBuoy}
          label="Crisis events"
          value={analytics.derived.totalCrisisEvents}
          sublabel="Sensitive-conversation volume — counts only"
        />
      </RevealGroup>

      <SectionCard title="Abuse signal trend" subtitle="Flagged signals vs. confirmed bots" href="/admin/safety" hrefLabel="Open safety queue">
        <TrendChart
          data={analytics.abuseTrend}
          series={[
            { key: "signals", label: "Signals", variant: "danger" },
            { key: "confirmed_bot", label: "Confirmed bots", variant: "muted", dashed: true },
          ]}
        />
      </SectionCard>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Report categories" subtitle="This window" href="/admin/safety" hrefLabel="Open safety queue">
          <RankedBarList
            items={analytics.reportCategories.map((r) => ({ key: r.category, label: r.category, value: r.count }))}
            emptyLabel="No reports in this window."
          />
        </SectionCard>
        <SectionCard title="Crisis events" subtitle="By category — followed-up shown per row">
          <RankedBarList
            items={analytics.crisisSummary.map((c) => ({
              key: c.category,
              label: c.category,
              value: c.count,
              meta: `${c.followed_up} followed up`,
            }))}
            emptyLabel="No crisis events in this window."
          />
        </SectionCard>
      </div>
    </div>
  );
}
