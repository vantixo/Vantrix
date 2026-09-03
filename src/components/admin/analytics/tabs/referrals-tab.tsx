import { MousePointerClick, UserPlus, ShieldAlert, Banknote, Clock3, Globe } from "lucide-react";
import { RevealGroup } from "@/components/admin/motion/reveal";
import { KpiCard } from "@/components/admin/analytics/kpi-card";
import { SectionCard } from "@/components/admin/analytics/section-card";
import { RankedBarList } from "@/components/admin/analytics/ranked-bar-list";
import { formatNgn } from "@/lib/admin/format";
import type { EngagementSnapshot } from "@/lib/admin/analytics-engagement";

export function ReferralsTab({ engagement }: { engagement: EngagementSnapshot }) {
  const { referrals, geo } = engagement;
  const conversionPct = referrals.clicks > 0
    ? Math.round((referrals.conversions / referrals.clicks) * 1000) / 10
    : null;

  return (
    <div className="space-y-6">
      <RevealGroup className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard icon={MousePointerClick} label="Referral clicks" value={referrals.clicks} />
        <KpiCard
          icon={UserPlus}
          label="Conversions"
          value={referrals.conversions}
          sublabel={conversionPct !== null ? `${conversionPct}% of clicks` : undefined}
          accent
        />
        <KpiCard icon={ShieldAlert} label="Fraud flagged" value={referrals.fraud_flagged} trendGoodDirection="down" />
        <KpiCard icon={Banknote} label="Payouts sent" value={formatNgn(referrals.payouts_sent_ngn)} />
        <KpiCard icon={Clock3} label="Payouts pending" value={formatNgn(referrals.payouts_pending_ngn)} />
        <KpiCard icon={Globe} label="Countries represented" value={geo.filter((g) => g.country !== "Unknown").length} />
      </RevealGroup>

      <SectionCard title="Users by country" subtitle="Top 12, from profile country" href="/admin/referrals" hrefLabel="Manage referral partners">
        <RankedBarList items={geo.map((g) => ({ key: g.country, label: g.country, value: g.users }))} />
      </SectionCard>
    </div>
  );
}
