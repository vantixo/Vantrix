import {
  Home,
  MessageCircle,
  MessagesSquare,
  Users,
  Image as ImageIcon,
  Globe2,
  Heart,
  Sparkles,
  Crown,
  ShieldAlert,
  Bot,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Gold crown treatment even when inactive — premium is always visible. */
  premium?: boolean;
}

/**
 * FRONTEND_DIRECTIVE §2, Open Question 1 — resolved: shipping the
 * proposed unified list as-is (Home · Chats · Characters · World · Dating
 * · Studio · Premium). One list, shared by the desktop rail, the mobile
 * drawer, and the mobile bottom-nav shortcut bar (bottom-nav.tsx, which
 * filters this down to 5 items), so there is exactly one place that
 * defines primary IA even though there are now three surfaces reading it.
 *
 * AMENDMENT (frontend-gap pass): Community added between Characters and
 * World. /api/community/* (list, posts, replies, likes) shipped with a
 * full moderation/rate-limit/notification stack and zero consuming page —
 * unreachable from any nav surface. Re-litigating §2's "as-is" resolution
 * here rather than burying a real feature under World or a profile menu;
 * flag for review if the 7-item list was meant to stay closed.
 *
 * AMENDMENT 2 (mood-sync-fix pass): Feed added between Community and
 * World, same rationale and same fix pattern as Community above —
 * /api/feed/posts (+ /like, /comments) shipped with a full Redis-cached,
 * rate-limited, moderated stack and zero consuming page. Grouped next to
 * Community since both are social/content-browsing surfaces, ahead of
 * World/Dating/Studio which are each a single dedicated feature area.
 *
 * SIDEBAR-REORG PASS (candy-reference IA restructure): reordered into a
 * discovery → conversation → social → world → creation → upsell arc
 * instead of the prior ad-hoc order. No renamed labels — every item here
 * keeps its actual in-app name rather than borrowing a reference
 * product's terminology for a differently-shaped feature (e.g. Studio
 * stays "Studio," not a generic "Collection," since it's also where
 * character training/import/market live, not just a media gallery).
 *
 * DISCOVER / CREATE-CHARACTER REMOVED (per direct request — both had no
 * function behind them): Discover (/discover) and Create Character
 * (/studio/create) are gone from this shared array entirely, which pulls
 * them from every surface that reads it in one place — desktop rail
 * (sidebar.tsx), mobile drawer (mobile-drawer.tsx), and bottom-nav's
 * filtered 5-item bar — rather than hiding them per-surface. Studio
 * itself (/studio) is untouched and keeps its own in-page "Create" CTA.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/feed", label: "Feed", icon: ImageIcon },
  { href: "/chats", label: "Chats", icon: MessageCircle },
  { href: "/community", label: "Community", icon: MessagesSquare },
  { href: "/characters", label: "Characters", icon: Users },
  // TOP-NAV-DIGITAL-TWIN FIX: previously only reachable from the
  // sidebar/drawer *footer* (grouped with Vantrix Coin/Referrals/Sign
  // out), not from the primary nav list itself — moved up here, per
  // direct request. Sidebar.tsx's own footer row for this was dropped
  // so it isn't listed twice.
  { href: "/digital-twin", label: "Digital Twin", icon: Bot },
  { href: "/world", label: "World", icon: Globe2 },
  { href: "/dating", label: "Dating", icon: Heart },
  { href: "/studio", label: "Studio", icon: Sparkles },
  { href: "/premium", label: "Premium", icon: Crown, premium: true },
];

/**
 * Deliberately NOT part of NAV_ITEMS above. That array is shared by the
 * desktop rail, the mobile drawer, and the bottom-nav shortcut bar (which
 * filters it to 5 items) — folding an admin-only entry into it would mean
 * every one of those three surfaces needs its own admin filter to avoid
 * leaking the item to non-admins. Sidebar.tsx renders this on its own,
 * gated by an `isAdmin` prop sourced server-side from ShellProfile.isAdmin
 * (see lib/frontend/session.ts) — never trust a client-only check for
 * this, since the whole point of /admin's own 404-not-403 gate is to not
 * confirm the section exists to non-admins in the first place.
 */
export const ADMIN_NAV_ITEM: NavItem = {
  href: "/admin",
  label: "Admin",
  icon: ShieldAlert,
};
