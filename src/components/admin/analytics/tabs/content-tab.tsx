import { Sparkles, Clock, ImageIcon, Wand2, MessagesSquare, UserCheck } from "lucide-react";
import { RevealGroup } from "@/components/admin/motion/reveal";
import { KpiCard } from "@/components/admin/analytics/kpi-card";
import { SectionCard } from "@/components/admin/analytics/section-card";
import { TopPostsList } from "@/components/admin/analytics/top-posts-list";
import { formatCompact } from "@/lib/admin/format";
import type { AnalyticsSnapshot } from "@/lib/admin/analytics";
import type { EngagementSnapshot } from "@/lib/admin/analytics-engagement";

export function ContentTab({
  analytics,
  engagement,
}: {
  analytics: AnalyticsSnapshot;
  engagement: EngagementSnapshot;
}) {
  const { contentPipeline, summary } = engagement;

  return (
    <div className="space-y-6">
      <RevealGroup className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard icon={Sparkles} label="Live characters" value={contentPipeline.live_characters} accent />
        <KpiCard
          icon={UserCheck}
          label="Pending review"
          value={contentPipeline.pending_characters}
          accent={contentPipeline.pending_characters > 0}
        />
        <KpiCard icon={Wand2} label="LoRA jobs in flight" value={contentPipeline.pending_lora_jobs} />
        <KpiCard icon={Clock} label="Content queue" value={contentPipeline.pending_content_queue} />
        <KpiCard icon={ImageIcon} label="Images (24h)" value={contentPipeline.images_generated_24h} sublabel={`${formatCompact(summary.images_generated)} this window`} />
        <KpiCard icon={MessagesSquare} label="Community posts" value={summary.community_posts} sublabel={`${summary.community_replies} replies`} />
      </RevealGroup>

      <SectionCard title="Most-liked community posts" subtitle="This window" href="/admin/characters" hrefLabel="Manage characters">
        <TopPostsList posts={analytics.topPosts} />
      </SectionCard>
    </div>
  );
}
