// src/lib/admin/analytics.ts
// ─────────────────────────────────────────────────────────────────────────
// Data layer for /admin/analytics. All queries go through the RPCs added in
// 20260811_analytics_investor_dashboards.sql via supabaseAdmin (service
// role), same pattern as ops-snapshot.ts. Every function fails soft to an
// empty/zeroed shape rather than throwing, so one broken metric can't take
// the whole dashboard down.
// ─────────────────────────────────────────────────────────────────────────

import { safeRpc } from "@/lib/admin/safe-rpc";

// `[key: string]: string | number` on the day-keyed series interfaces below
// lets them pass directly into TrendChart's generic
// `Record<string, string | number>[]` data prop (see
// components/admin/analytics/trend-chart.tsx) — TS requires an explicit
// index signature for that assignment even though every field already
// satisfies it structurally.
export interface ActivityPoint { day: string; dau: number; new_signups: number; [key: string]: string | number }
export interface RevenuePoint  { day: string; revenue_usd: number; new_subs: number; [key: string]: string | number }
export interface RetentionCohort {
  cohort_week: string; cohort_size: number;
  week_0: number | null; week_1: number | null; week_2: number | null; week_3: number | null;
}
export interface TopCharacter { character_id: string; name: string; conversations: number; messages: number; likes: number }
export interface TierCount { tier: string; users: number }
export interface ChurnPoint { day: string; cancellations: number; [key: string]: string | number }
export interface AbuseTrendPoint { day: string; signals: number; confirmed_bot: number; [key: string]: string | number }
export interface ReportCategory { category: string; count: number }
export interface CrisisSummary { category: string; count: number; followed_up: number }
export interface TopPost {
  post_id: string; character_id: string; character_name: string;
  caption: string | null; likes_count: number; created_at: string;
}

export interface AnalyticsSnapshot {
  activity: ActivityPoint[];
  wau: number;
  mau: number;
  revenue: RevenuePoint[];
  mrrUsd: number;
  activeSubsUsd: number;
  activeSubsOther: number;
  cancelled30d: number;
  tierBreakdown: TierCount[];
  retention: RetentionCohort[];
  topCharacters: TopCharacter[];
  // ADVANCED-ANALYTICS-UPGRADE: previously only surfaced on /admin/investor
  // via a second, parallel data layer (investor.ts) even though the same
  // RPCs already existed here — now part of the single analytics snapshot
  // so the main dashboard doesn't have to send a user to a second page for
  // trust & safety / churn context.
  churn: ChurnPoint[];
  abuseTrend: AbuseTrendPoint[];
  reportCategories: ReportCategory[];
  crisisSummary: CrisisSummary[];
  topPosts: TopPost[];
  // Derived KPIs — computed here once so every consumer (page + any future
  // widget) reads the same numbers instead of re-deriving them inline.
  derived: {
    /** Average revenue per paying USD subscriber, this snapshot. */
    arpuUsd: number;
    /** Net new users over the window: signups minus cancellations. */
    netGrowth: number;
    /** Average week-1 retention across cohorts that have reached week 1. */
    avgWeek1RetentionPct: number | null;
    /** Total abuse signals flagged in the window. */
    totalAbuseSignals: number;
    /** Total crisis (sensitive-conversation) events in the window. */
    totalCrisisEvents: number;
  };
}

export async function getAnalyticsSnapshot(days = 30): Promise<AnalyticsSnapshot> {
  const [
    activity, wauMau, revenue, mrr, tierBreakdown, retention, topCharacters,
    churn, abuseTrend, reportCategories, crisisSummary, topPosts,
  ] = await Promise.all([
    safeRpc<ActivityPoint[]>("admin_activity_series", { p_days: days }, []),
    safeRpc<{ wau: number; mau: number }[]>("admin_wau_mau", {}, [{ wau: 0, mau: 0 }]),
    safeRpc<RevenuePoint[]>("admin_revenue_series", { p_days: days }, []),
    safeRpc<{ mrr_usd: number; active_subs_usd: number; active_subs_other: number; cancelled_30d: number }[]>(
      "admin_mrr_snapshot", {}, [{ mrr_usd: 0, active_subs_usd: 0, active_subs_other: 0, cancelled_30d: 0 }]
    ),
    safeRpc<TierCount[]>("admin_tier_breakdown", {}, []),
    safeRpc<RetentionCohort[]>("admin_retention_cohorts", { p_weeks: 8 }, []),
    safeRpc<TopCharacter[]>("admin_top_characters", { p_limit: 10 }, []),
    safeRpc<ChurnPoint[]>("admin_churn_trend", { p_days: days }, []),
    safeRpc<AbuseTrendPoint[]>("admin_abuse_signal_trend", { p_days: days }, []),
    safeRpc<ReportCategory[]>("admin_report_category_breakdown", { p_days: days }, []),
    safeRpc<CrisisSummary[]>("admin_crisis_event_summary", { p_days: days }, []),
    safeRpc<TopPost[]>("admin_top_community_posts", { p_days: days, p_limit: 10 }, []),
  ]);

  const wm = wauMau[0] ?? { wau: 0, mau: 0 };
  const m  = mrr[0] ?? { mrr_usd: 0, active_subs_usd: 0, active_subs_other: 0, cancelled_30d: 0 };

  const signups = activity.reduce((sum, a) => sum + (a.new_signups ?? 0), 0);
  const cancellations = churn.reduce((sum, c) => sum + (c.cancellations ?? 0), 0);

  const week1Values = retention
    .map(c => c.week_1)
    .filter((v): v is number => v !== null && v !== undefined);
  const avgWeek1RetentionPct = week1Values.length > 0
    ? Math.round((week1Values.reduce((s, v) => s + v, 0) / week1Values.length) * 10) / 10
    : null;

  return {
    activity,
    wau: wm.wau,
    mau: wm.mau,
    revenue,
    mrrUsd: m.mrr_usd,
    activeSubsUsd: m.active_subs_usd,
    activeSubsOther: m.active_subs_other,
    cancelled30d: m.cancelled_30d,
    tierBreakdown,
    retention,
    topCharacters,
    churn,
    abuseTrend,
    reportCategories,
    crisisSummary,
    topPosts,
    derived: {
      arpuUsd: m.active_subs_usd > 0 ? Math.round((m.mrr_usd / m.active_subs_usd) * 100) / 100 : 0,
      netGrowth: signups - cancellations,
      avgWeek1RetentionPct,
      totalAbuseSignals: abuseTrend.reduce((s, a) => s + (a.signals ?? 0), 0),
      totalCrisisEvents: crisisSummary.reduce((s, c) => s + (c.count ?? 0), 0),
    },
  };
}
