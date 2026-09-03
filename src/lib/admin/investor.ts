// src/lib/admin/investor.ts
// ─────────────────────────────────────────────────────────────────────────
// Data layer for /admin/investor — an aggregate-only "what's happening in
// the app" board. Deliberately sources "what users are saying" only from
// data that already exists in this schema (user_reports, character_posts
// engagement, abuse_signals, crisis_events counts, subscription churn).
// There is no reviews/NPS/testimonial table in this codebase — if you want
// a real voice-of-customer feed, the honest path is adding an in-app
// feedback capture surface, which this file does not fabricate a
// substitute for.
// ─────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAnalyticsSnapshot } from "./analytics";
import type {
  ReportCategory, AbuseTrendPoint, CrisisSummary, TopPost, ChurnPoint,
} from "./analytics";

export type { ReportCategory, AbuseTrendPoint, CrisisSummary, TopPost, ChurnPoint };

export interface InvestorSnapshot {
  headline: {
    totalUsers: number;
    mau: number;
    mrrUsd: number;
    cancelled30d: number;
    growthNote: string;
  };
  reportCategories: ReportCategory[];
  abuseTrend: AbuseTrendPoint[];
  crisisSummary: CrisisSummary[];
  topPosts: TopPost[];
  churn: ChurnPoint[];
}

// ADVANCED-ANALYTICS-UPGRADE: this used to fire its own parallel set of
// admin_report_category_breakdown / admin_abuse_signal_trend /
// admin_crisis_event_summary / admin_top_community_posts / admin_churn_trend
// RPC calls on top of the identical ones getAnalyticsSnapshot() already
// made — same data, two round-trips. Now sources all of it from the single
// consolidated snapshot and only makes the one call this page uniquely
// needs (total registered users).
export async function getInvestorSnapshot(days = 30): Promise<InvestorSnapshot> {
  const [analytics, { count: totalUsers }] = await Promise.all([
    getAnalyticsSnapshot(days),
    supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
  ]);

  const cancellations = analytics.churn.reduce((sum, c) => sum + c.cancellations, 0);
  const signups = analytics.activity.reduce((sum, a) => sum + a.new_signups, 0);
  const growthNote =
    signups === 0
      ? "No new signups in this window."
      : `${signups} new signups vs ${cancellations} cancellations over the last ${days} days.`;

  return {
    headline: {
      totalUsers: totalUsers ?? 0,
      mau: analytics.mau,
      mrrUsd: analytics.mrrUsd,
      cancelled30d: analytics.cancelled30d,
      growthNote,
    },
    reportCategories: analytics.reportCategories,
    abuseTrend: analytics.abuseTrend,
    crisisSummary: analytics.crisisSummary,
    topPosts: analytics.topPosts,
    churn: analytics.churn,
  };
}
