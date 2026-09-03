import { Users, DollarSign, Activity, TrendingUp, MessageSquare, Sparkles } from "lucide-react";
import { RevealGroup } from "@/components/admin/motion/reveal";
import { KpiCard } from "@/components/admin/analytics/kpi-card";
import { SectionCard } from "@/components/admin/analytics/section-card";
import { TrendChart } from "@/components/admin/analytics/trend-chart";
import { RankedBarList } from "@/components/admin/analytics/ranked-bar-list";
import { trendFromSeries } from "@/lib/admin/trend";
import { formatUsd, formatCompact } from "@/lib/admin/format";
import type { AnalyticsSnapshot } from "@/lib/admin/analytics";
import type { EngagementSnapshot } from "@/lib/admin/analytics-engagement";

export function OverviewTab({
  analytics,
  engagement,
  totalUsers,
}: {
  analytics: AnalyticsSnapshot;
  engagement: EngagementSnapshot;
  totalUsers: number;
}) {
  const signupsTrend = trendFromSeries(analytics.activity.map((a) => a.new_signups));
  const dauTrend = trendFromSeries(analytics.activity.map((a) => a.dau));
  const revenueTrend = trendFromSeries(analytics.revenue.map((r) => r.revenue_usd));
  const messagesTrend = trendFromSeries(engagement.messageVolume.map((m) => m.messages));

  const topSecondary = engagement.derived.topSecondaryFeature;

  return (
    <div className="space-y-6">
      <RevealGroup className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard icon={Users} label="Total users" value={totalUsers} trendPct={signupsTrend} />
        <KpiCard
          icon={DollarSign}
          label="MRR (USD subs)"
          value={formatUsd(analytics.mrrUsd)}
          sublabel={`${analytics.activeSubsUsd} active · ${analytics.activeSubsOther} other ccy`}
          trendPct={revenueTrend}
          accent
        />
        <KpiCard icon={Activity} label="Monthly active" value={analytics.mau} sublabel={`${analytics.wau} weekly`} trendPct={dauTrend} />
        <KpiCard
          icon={TrendingUp}
          label="Net growth"
          value={analytics.derived.netGrowth}
          sublabel="Signups minus cancellations"
          trendPct={signupsTrend}
        />
        <KpiCard
          icon={MessageSquare}
          label="Messages sent"
          value={formatCompact(engagement.summary.total_messages)}
          sublabel={`${engagement.summary.total_conversations} conversations`}
          trendPct={messagesTrend}
        />
        <KpiCard
          icon={Sparkles}
          label="Top secondary feature"
          value={topSecondary ? formatCompact(topSecondary.users) : "—"}
          sublabel={topSecondary ? `${topSecondary.name} users` : "No adoption yet"}
        />
      </RevealGroup>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Daily active users" subtitle="DAU vs. new signups">
          <TrendChart
            data={analytics.activity}
            series={[
              { key: "dau", label: "Active users", variant: "primary" },
              { key: "new_signups", label: "New signups", variant: "muted", dashed: true },
            ]}
          />
        </SectionCard>
        <SectionCard title="Message volume" subtitle="Messages sent vs. conversations started">
          <TrendChart
            data={engagement.messageVolume}
            series={[
              { key: "messages", label: "Messages", variant: "primary" },
              { key: "conversations_started", label: "Conversations started", variant: "muted", dashed: true },
            ]}
          />
        </SectionCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Top characters" subtitle="By conversation volume" href="/admin/characters" hrefLabel="Manage characters">
          <RankedBarList
            items={analytics.topCharacters.map((c) => ({
              key: c.character_id,
              label: c.name,
              value: c.conversations,
              meta: `${formatCompact(c.messages)} messages · ${formatCompact(c.likes)} likes`,
            }))}
          />
        </SectionCard>
        <SectionCard title="Feature adoption" subtitle={`Distinct users in the window, by surface`}>
          <RankedBarList
            items={[
              { key: "chat", label: "Chat", value: engagement.featureAdoption.chat_users },
              { key: "dating", label: "Dating", value: engagement.featureAdoption.dating_users },
              { key: "roleplay", label: "Roleplay", value: engagement.featureAdoption.roleplay_users },
              { key: "community", label: "Community", value: engagement.featureAdoption.community_users },
              { key: "twin", label: "Digital Twin", value: engagement.featureAdoption.twin_users },
            ]}
          />
        </SectionCard>
      </div>
    </div>
  );
}
