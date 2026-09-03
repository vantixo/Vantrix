import {
  MessageCircle,
  Sparkles,
  Heart,
  ThumbsUp,
  UserPlus,
  MessageSquare,
  Gift,
  Trophy,
  Globe,
  Cake,
  CreditCard,
  Coins,
  Users,
  ShieldAlert,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import type { NotificationType } from "@/lib/notifications/types";

/**
 * One icon per inbox type so the bell dropdown / toast stack / full list
 * are scannable at a glance instead of every row showing the same generic
 * bell (the flat-list version of this page rendered every row identically
 * regardless of type). Kept in its own file since it's the one piece of
 * per-type UI metadata shared across all three surfaces.
 */
const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  message: MessageCircle,
  character_initiative: Sparkles,
  dating_match: Heart,
  character_liked: ThumbsUp,
  character_followed: UserPlus,
  community_reply: MessageSquare,
  gift_received: Gift,
  milestone_unlocked: Trophy,
  world_event: Globe,
  character_birthday: Cake,
  subscription_renewal: CreditCard,
  token_purchase: Coins,
  referral_reward: Users,
  security_alert: ShieldAlert,
  story_cliffhanger: BookOpen,
};

export function getNotificationIcon(type: string): LucideIcon {
  return TYPE_ICON[type as NotificationType] ?? MessageCircle;
}

/** Icon tint. security_alert stays visually distinct (danger) regardless
 *  of read state so it doesn't fade into the pack once read — it's an
 *  account-safety signal, not routine activity. */
export function getNotificationIconClass(type: string, unread: boolean): string {
  if (type === "security_alert") return "text-danger";
  return unread ? "text-gold-500" : "text-text-tertiary";
}
