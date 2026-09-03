/**
 * Notification inbox — shared types + per-type defaults.
 *
 * Single source of truth for the 14 inbox categories from the product
 * spec. `NOTIFICATION_DEFAULTS` is what notification_preferences.prefs
 * overrides layer on top of (see /api/notifications/preferences) — a type
 * with no override row is fully "on" for both channels.
 */

export const NOTIFICATION_TYPES = [
  "message",
  "character_initiative",
  "dating_match",
  "character_liked",
  "character_followed",
  "community_reply",
  "gift_received",
  "milestone_unlocked",
  "world_event",
  "character_birthday",
  "subscription_renewal",
  "token_purchase",
  "referral_reward",
  "security_alert",
  "story_cliffhanger",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationUrgency = "low" | "medium" | "high";

export interface NotificationChannelPrefs {
  inApp: boolean;
  push: boolean;
}

export type NotificationPrefsMap = Record<NotificationType, NotificationChannelPrefs>;

/** Human-readable label + description shown in Notification preferences. */
export const NOTIFICATION_LABELS: Record<NotificationType, { label: string; description: string }> = {
  message:                { label: "New message",                description: "Someone sends you a message" },
  character_initiative:   { label: "Character initiated conversation", description: "A character reaches out first" },
  dating_match:           { label: "Dating match",                description: "You match with a character" },
  character_liked:        { label: "Someone liked your character",description: "Your created character gets a like" },
  character_followed:     { label: "Someone followed you",        description: "Your created character gets a follower" },
  community_reply:        { label: "Community reply",             description: "A reply to your post or comment" },
  gift_received:          { label: "Gift received",               description: "A character sends you a gift" },
  milestone_unlocked:     { label: "Milestone unlocked",          description: "You hit a relationship milestone" },
  world_event:            { label: "World event",                 description: "Something happens in the shared universe" },
  character_birthday:     { label: "Character birthday/event",    description: "A character's birthday or special event" },
  subscription_renewal:   { label: "Subscription renewal",        description: "Your subscription renews or is about to" },
  token_purchase:         { label: "Token purchase",               description: "A token purchase completes" },
  referral_reward:        { label: "Referral reward",              description: "You earn a referral reward" },
  security_alert:         { label: "Security alert",               description: "New sign-in or account security event" },
  story_cliffhanger:      { label: "Story Mode",                   description: "A roleplay chapter ends or a story wraps up" },
};

// Every type defaults to both in-app and push on. Security alerts and
// subscription/token events are financial/account-safety in nature, so
// they're intentionally NOT user-mutable to "off" in the preferences UI
// (see route handler) even though they share this same default shape.
export const NOTIFICATION_DEFAULTS: NotificationPrefsMap = NOTIFICATION_TYPES.reduce((acc, type) => {
  acc[type] = { inApp: true, push: true };
  return acc;
}, {} as NotificationPrefsMap);

/** Types the user is never allowed to silence (account safety / billing). */
export const NON_MUTABLE_TYPES: readonly NotificationType[] = ["security_alert"];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/**
 * UI-facing grouping of the 14 types into 4 filterable categories, used by
 * the notifications page's filter row and the preferences screen's
 * sectioning. Pure data (no React) so it's safe to import from both server
 * (preferences route) and client (notifications list/settings) code.
 */
export const NOTIFICATION_CATEGORIES = ["messages", "social", "world", "account"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  messages: "Messages",
  social: "Social",
  world: "World",
  account: "Account",
};

export const CATEGORY_TYPES: Record<NotificationCategory, readonly NotificationType[]> = {
  messages: ["message", "character_initiative", "story_cliffhanger"],
  social: ["dating_match", "character_liked", "character_followed", "community_reply", "gift_received"],
  world: ["milestone_unlocked", "world_event", "character_birthday"],
  account: ["subscription_renewal", "token_purchase", "referral_reward", "security_alert"],
};

const TYPE_TO_CATEGORY: Record<NotificationType, NotificationCategory> = NOTIFICATION_CATEGORIES.reduce(
  (acc, category) => {
    for (const type of CATEGORY_TYPES[category]) acc[type] = category;
    return acc;
  },
  {} as Record<NotificationType, NotificationCategory>
);

export function getNotificationCategory(type: NotificationType): NotificationCategory {
  return TYPE_TO_CATEGORY[type];
}
