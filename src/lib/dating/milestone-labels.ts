/**
 * Shared with the new AllMilestonesDrawer (see components/dating) — was
 * previously a local const inside match/[id]/page.tsx only. Pulled out so
 * the "view all milestones" drawer (which renders the fuller
 * /api/dating/milestones history, not just the matches route's capped
 * 3-item embed) uses identical labels/emoji instead of drifting.
 */
export const MILESTONE_LABEL: Record<string, string> = {
  first_chat: "First conversation",
  first_gift: "First gift",
  first_date: "First date",
  week_streak: "7-day streak",
  month_streak: "30-day streak",
};

export const MILESTONE_EMOJI: Record<string, string> = {
  first_chat: "\u{1F4AC}",
  first_gift: "\u{1F381}",
  first_date: "\u{1F319}",
  week_streak: "\u{1F525}",
  month_streak: "\u{1F31F}",
};
