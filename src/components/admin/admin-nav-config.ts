import {
  LayoutDashboard,
  Users,
  ShieldAlert,
  Gift,
  Megaphone,
  GalleryHorizontal,
  Activity,
  History,
  KeyRound,
  BarChart3,
  Sparkles,
  Landmark,
  Clapperboard,
  type LucideIcon,
} from "lucide-react";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/characters", label: "Characters", icon: Users },
  { href: "/admin/content-engine", label: "Content Engine", icon: Sparkles },
  { href: "/admin/safety", label: "Trust & Safety", icon: ShieldAlert },
  { href: "/admin/referrals", label: "Referrals", icon: Gift },
  { href: "/admin/ads", label: "Ads", icon: Megaphone },
  { href: "/admin/login-portraits", label: "Login Page", icon: GalleryHorizontal },
  { href: "/admin/world", label: "World", icon: Landmark },
  { href: "/admin/scenarios", label: "Scenarios", icon: Clapperboard },
  { href: "/admin/ops", label: "Ops", icon: Activity },
  { href: "/admin/audit", label: "Audit Log", icon: History },
  { href: "/admin/permissions", label: "Permissions", icon: KeyRound },
];
