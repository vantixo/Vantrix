import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Link row used by the main Settings page to point at a sub-settings
 * page instead of inlining that section's full UI in the long list.
 * First consumer: Notifications (previously PushOptIn +
 * NotificationPreferences rendered directly on this page — see
 * SETTINGS-NOTIFICATIONS-SPLIT in profile/settings/page.tsx). Security
 * (2FA) uses the same row for the same reason: both are meaningfully
 * sized sub-UIs, not a single toggle, so they get their own screen
 * rather than growing the main list.
 */
export function SettingsNavRow({
  href,
  icon: Icon,
  label,
  description,
  badge,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
  /** Optional short status pill, e.g. "On" for an enabled security feature. */
  badge?: { text: string; tone: "on" | "off" };
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-sm border border-border-hairline px-4 py-3.5 hover:border-interactive transition-colors ease-premium"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Icon className="h-4.5 w-4.5 text-text-tertiary shrink-0" />
        <div className="min-w-0">
          <div className="text-sm text-text-primary font-medium">{label}</div>
          <div className="text-xs text-text-secondary mt-0.5 truncate">{description}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {badge && (
          <span
            className={cn(
              "text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5",
              badge.tone === "on"
                ? "text-gold-400 bg-gold-500/10"
                : "text-text-tertiary bg-white/[0.04]"
            )}
          >
            {badge.text}
          </span>
        )}
        <ChevronRight className="h-4 w-4 text-text-tertiary" />
      </div>
    </Link>
  );
}
