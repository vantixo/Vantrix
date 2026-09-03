"use client";

import { useState } from "react";
import {
  LayoutDashboard, TrendingUp, Zap, Sparkles, ShieldAlert, Gift,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RangeSelector } from "@/components/admin/analytics/range-selector";
import { LiveDot } from "@/components/admin/motion/live-dot";
import { OverviewTab } from "@/components/admin/analytics/tabs/overview-tab";
import { GrowthTab } from "@/components/admin/analytics/tabs/growth-tab";
import { EngagementTab } from "@/components/admin/analytics/tabs/engagement-tab";
import { ContentTab } from "@/components/admin/analytics/tabs/content-tab";
import { SafetyTab } from "@/components/admin/analytics/tabs/safety-tab";
import { ReferralsTab } from "@/components/admin/analytics/tabs/referrals-tab";
import Link from "next/link";
import type { AnalyticsSnapshot } from "@/lib/admin/analytics";
import type { EngagementSnapshot } from "@/lib/admin/analytics-engagement";
import type { OpsSnapshot } from "@/lib/admin/ops-snapshot";

type TabId = "overview" | "growth" | "engagement" | "content" | "safety" | "referrals";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "growth", label: "Growth & Revenue", icon: TrendingUp },
  { id: "engagement", label: "Engagement", icon: Zap },
  { id: "content", label: "Content & Community", icon: Sparkles },
  { id: "safety", label: "Trust & Safety", icon: ShieldAlert },
  { id: "referrals", label: "Referrals & Geo", icon: Gift },
];

const OPS_STATUS_META: Record<OpsSnapshot["status"], { label: string; signal: "healthy" | "degraded" | "critical" }> = {
  healthy: { label: "All systems healthy", signal: "healthy" },
  degraded: { label: "Degraded", signal: "degraded" },
  throttled: { label: "Throttled", signal: "degraded" },
  billing_lag: { label: "Billing lag", signal: "critical" },
};

export function AnalyticsDashboard({
  analytics,
  engagement,
  ops,
  totalUsers,
  days,
}: {
  analytics: AnalyticsSnapshot;
  engagement: EngagementSnapshot;
  ops: OpsSnapshot;
  totalUsers: number;
  days: number;
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const opsMeta = OPS_STATUS_META[ops.status];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LiveDot status={opsMeta.signal} />
          <Link
            href="/admin/ops"
            className="text-xs text-text-secondary hover:text-gold-400 transition-colors ease-premium duration-150"
          >
            {opsMeta.label} · full ops console →
          </Link>
        </div>
        <RangeSelector current={days} />
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-xs px-3 py-2 text-xs font-medium transition-colors ease-premium duration-150 shrink-0",
                active
                  ? "bg-white/[0.06] text-gold-400"
                  : "text-text-tertiary hover:text-text-secondary"
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && (
        <OverviewTab analytics={analytics} engagement={engagement} totalUsers={totalUsers} />
      )}
      {tab === "growth" && <GrowthTab analytics={analytics} />}
      {tab === "engagement" && <EngagementTab analytics={analytics} engagement={engagement} />}
      {tab === "content" && <ContentTab analytics={analytics} engagement={engagement} />}
      {tab === "safety" && <SafetyTab analytics={analytics} />}
      {tab === "referrals" && <ReferralsTab engagement={engagement} />}
    </div>
  );
}
