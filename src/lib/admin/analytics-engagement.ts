// src/lib/admin/analytics-engagement.ts
// ─────────────────────────────────────────────────────────────────────────
// Second half of the /admin/analytics data layer — everything analytics.ts
// (growth/revenue/retention/churn) doesn't cover: what people actually *do*
// once they're in the app. Backed by the RPCs added in
// 20261036_admin_analytics_deep_dashboard.sql. Same conventions as
// analytics.ts: every field comes from safeRpc, so one broken metric can't
// take the whole dashboard down.
// ─────────────────────────────────────────────────────────────────────────

import { safeRpc } from "@/lib/admin/safe-rpc";

// `[key: string]: string | number` lets these pass directly into
// TrendChart's generic `Record<string, string | number>[]` data prop —
// see the identical comment on analytics.ts's point interfaces.
export interface MessageVolumePoint { day: string; messages: number; conversations_started: number; [key: string]: string | number }
export interface DatingFunnelPoint { day: string; swipes: number; matches: number; gifts: number; [key: string]: string | number }

export interface EngagementSummary {
  total_conversations: number;
  total_messages: number;
  avg_messages_per_convo: number | null;
  dating_mode_conversations: number;
  roleplay_mode_conversations: number;
  roleplay_sessions_started: number;
  roleplay_sessions_completed: number;
  dating_swipes: number;
  dating_matches: number;
  dating_gifts: number;
  community_posts: number;
  community_replies: number;
  digital_twin_messages: number;
  xp_events: number;
  images_generated: number;
}

export interface ReferralFunnelSummary {
  clicks: number;
  conversions: number;
  fraud_flagged: number;
  payouts_sent_ngn: number;
  payouts_pending_ngn: number;
}

export interface GeoRow { country: string; users: number }

export interface ContentPipelineSummary {
  pending_characters: number;
  live_characters: number;
  pending_lora_jobs: number;
  pending_content_queue: number;
  images_generated_24h: number;
}

export interface FeatureAdoption {
  chat_users: number;
  dating_users: number;
  roleplay_users: number;
  community_users: number;
  twin_users: number;
}

export interface GamificationSummary {
  active_streaks: number;
  avg_streak_length: number | null;
  longest_streak: number;
  xp_events_today: number;
}

export interface EngagementSnapshot {
  messageVolume: MessageVolumePoint[];
  datingFunnel: DatingFunnelPoint[];
  summary: EngagementSummary;
  referrals: ReferralFunnelSummary;
  geo: GeoRow[];
  contentPipeline: ContentPipelineSummary;
  featureAdoption: FeatureAdoption;
  gamification: GamificationSummary;
  derived: {
    /** Of the window's total conversations, the % that were dating or roleplay mode. */
    specialModeSharePct: number;
    /** Swipe → match conversion rate, this window. */
    swipeToMatchPct: number | null;
    /** Of active feature users, chat is always the floor — this is the next-widest surface. */
    topSecondaryFeature: { name: string; users: number } | null;
  };
}

const EMPTY_SUMMARY: EngagementSummary = {
  total_conversations: 0, total_messages: 0, avg_messages_per_convo: null,
  dating_mode_conversations: 0, roleplay_mode_conversations: 0,
  roleplay_sessions_started: 0, roleplay_sessions_completed: 0,
  dating_swipes: 0, dating_matches: 0, dating_gifts: 0,
  community_posts: 0, community_replies: 0,
  digital_twin_messages: 0, xp_events: 0, images_generated: 0,
};

const EMPTY_REFERRALS: ReferralFunnelSummary = {
  clicks: 0, conversions: 0, fraud_flagged: 0, payouts_sent_ngn: 0, payouts_pending_ngn: 0,
};

const EMPTY_PIPELINE: ContentPipelineSummary = {
  pending_characters: 0, live_characters: 0, pending_lora_jobs: 0,
  pending_content_queue: 0, images_generated_24h: 0,
};

const EMPTY_ADOPTION: FeatureAdoption = {
  chat_users: 0, dating_users: 0, roleplay_users: 0, community_users: 0, twin_users: 0,
};

const EMPTY_GAMIFICATION: GamificationSummary = {
  active_streaks: 0, avg_streak_length: null, longest_streak: 0, xp_events_today: 0,
};

export async function getEngagementSnapshot(days = 30): Promise<EngagementSnapshot> {
  const [
    messageVolume, datingFunnel, summaryRows, referralRows, geo,
    pipelineRows, adoptionRows, gamificationRows,
  ] = await Promise.all([
    safeRpc<MessageVolumePoint[]>("admin_message_volume_series", { p_days: days }, []),
    safeRpc<DatingFunnelPoint[]>("admin_dating_funnel_series", { p_days: days }, []),
    safeRpc<EngagementSummary[]>("admin_engagement_summary", { p_days: days }, [EMPTY_SUMMARY]),
    safeRpc<ReferralFunnelSummary[]>("admin_referral_funnel_summary", { p_days: days }, [EMPTY_REFERRALS]),
    safeRpc<GeoRow[]>("admin_geo_breakdown", { p_limit: 12 }, []),
    safeRpc<ContentPipelineSummary[]>("admin_content_pipeline_summary", {}, [EMPTY_PIPELINE]),
    safeRpc<FeatureAdoption[]>("admin_feature_adoption", { p_days: days }, [EMPTY_ADOPTION]),
    safeRpc<GamificationSummary[]>("admin_gamification_summary", {}, [EMPTY_GAMIFICATION]),
  ]);

  const summary = summaryRows[0] ?? EMPTY_SUMMARY;
  const referrals = referralRows[0] ?? EMPTY_REFERRALS;
  const contentPipeline = pipelineRows[0] ?? EMPTY_PIPELINE;
  const featureAdoption = adoptionRows[0] ?? EMPTY_ADOPTION;
  const gamification = gamificationRows[0] ?? EMPTY_GAMIFICATION;

  const specialModeConvos = summary.dating_mode_conversations + summary.roleplay_mode_conversations;
  const specialModeSharePct = summary.total_conversations > 0
    ? Math.round((specialModeConvos / summary.total_conversations) * 1000) / 10
    : 0;

  const swipeToMatchPct = summary.dating_swipes > 0
    ? Math.round((summary.dating_matches / summary.dating_swipes) * 1000) / 10
    : null;

  const secondaryCandidates: { name: string; users: number }[] = [
    { name: "Dating", users: featureAdoption.dating_users },
    { name: "Roleplay", users: featureAdoption.roleplay_users },
    { name: "Community", users: featureAdoption.community_users },
    { name: "Digital Twin", users: featureAdoption.twin_users },
  ];
  const topSecondaryFeature = secondaryCandidates.reduce<{ name: string; users: number } | null>(
    (top, c) => (c.users > 0 && (!top || c.users > top.users) ? c : top),
    null
  );

  return {
    messageVolume,
    datingFunnel,
    summary,
    referrals,
    geo,
    contentPipeline,
    featureAdoption,
    gamification,
    derived: { specialModeSharePct, swipeToMatchPct, topSecondaryFeature },
  };
}
