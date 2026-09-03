import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAnalyticsSnapshot } from "@/lib/admin/analytics";
import { getEngagementSnapshot } from "@/lib/admin/analytics-engagement";
import { getOpsSnapshot } from "@/lib/admin/ops-snapshot";
import { AnalyticsDashboard } from "@/components/admin/analytics/analytics-dashboard";

export const dynamic = "force-dynamic";

const VALID_RANGES = [7, 30, 90];

function parseDays(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return VALID_RANGES.includes(n) ? n : 30;
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const days = parseDays(params.days);

  // FRONTEND_DIRECTIVE §10 — Server Component calls data layers directly
  // (same pattern as getAdminOverview / getOpsSnapshot) rather than
  // round-tripping through /api/admin/* to fetch data this same app
  // already has direct DB access to.
  const [analytics, engagement, ops, { count: totalUsers }] = await Promise.all([
    getAnalyticsSnapshot(days),
    getEngagementSnapshot(days),
    getOpsSnapshot(),
    supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
  ]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div>
        <h2 className="font-display text-2xl mb-1">Analytics</h2>
        <p className="text-text-secondary text-sm">
          Everything happening in Vantrix — growth, revenue, engagement, content, safety, and referrals, live.
        </p>
      </div>

      <AnalyticsDashboard
        analytics={analytics}
        engagement={engagement}
        ops={ops}
        totalUsers={totalUsers ?? 0}
        days={days}
      />
    </div>
  );
}
