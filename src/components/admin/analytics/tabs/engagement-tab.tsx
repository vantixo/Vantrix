import { MessageSquare, Heart, Drama, Flame, ImageIcon } from "lucide-react";
import { RevealGroup } from "@/components/admin/motion/reveal";
import { KpiCard } from "@/components/admin/analytics/kpi-card";
import { SectionCard } from "@/components/admin/analytics/section-card";
import { TrendChart } from "@/components/admin/analytics/trend-chart";
import { RankedBarList } from "@/components/admin/analytics/ranked-bar-list";
import { trendFromSeries } from "@/lib/admin/trend";
import { formatCompact } from "@/lib/admin/format";
import type { EngagementSnapshot } from "@/lib/admin/analytics-engagement";
import type { AnalyticsSnapshot } from "@/lib/admin/analytics";

export function EngagementTab({
  analytics,
  engagement,
}: {
  analytics: AnalyticsSnapshot;
  engagement: EngagementSnapshot;
}) {
  const { summary, gamification, derived } = engagement;
  const messagesTrend = trendFromSeries(engagement.messageVolume.map((m) => m.messages));
  const matchesTrend = trendFromSeries(engagement.datingFunnel.map((d) => d.matches));

  return (
    <div className="space-y-6">
      <RevealGroup className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard icon={MessageSquare} label="Messages" value={formatCompact(summary.total_messages)} trendPct={messagesTrend} accent />
        <KpiCard
          icon={MessageSquare}
          label="Avg msgs / convo"
          value={String(summary.avg_messages_per_convo ?? 0)}
          sublabel={`${summary.total_conversations} conversations`}
        />
        <KpiCard
          icon={Heart}
          label="Swipe → match"
          value={derived.swipeToMatchPct !== null ? `${derived.swipeToMatchPct}%` : "—"}
          sublabel={`${summary.dating_swipes} swipes`}
          trendPct={matchesTrend}
        />
        <KpiCard icon={Drama} label="Roleplay sessions" value={summary.roleplay_sessions_started} sublabel={`${summary.roleplay_sessions_completed} completed`} />
        <KpiCard icon={Flame} label="Active streaks" value={gamification.active_streaks} sublabel={`Avg ${gamification.avg_streak_length ?? 0} days`} />
        <KpiCard icon={ImageIcon} label="Images generated" value={formatCompact(summary.images_generated)} />
      </RevealGroup>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Message volume" subtitle="Messages sent vs. conversations started">
          <TrendChart
            data={engagement.messageVolume}
            series={[
              { key: "messages", label: "Messages", variant: "primary" },
              { key: "conversations_started", label: "Conversations started", variant: "muted", dashed: true },
            ]}
          />
        </SectionCard>
        <SectionCard title="Dating funnel" subtitle="Swipes vs. matches vs. gifts sent">
          <TrendChart
            data={engagement.datingFunnel}
            series={[
              { key: "swipes", label: "Swipes", variant: "muted" },
              { key: "matches", label: "Matches", variant: "primary" },
              { key: "gifts", label: "Gifts", variant: "muted", dashed: true },
            ]}
          />
        </SectionCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Feature adoption" subtitle="Distinct users per surface, this window">
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
      </div>
    </div>
  );
}
