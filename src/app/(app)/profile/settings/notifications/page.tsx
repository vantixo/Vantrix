import { SettingsSubpageHeader } from "@/components/profile/settings-subpage-header";
import { PushOptIn } from "@/components/profile/push-opt-in";
import { NotificationPreferences } from "@/components/profile/notification-preferences";

export const dynamic = "force-dynamic";

/**
 * SETTINGS-NOTIFICATIONS-SPLIT: PushOptIn + NotificationPreferences
 * (14 categories x 2 channels each) previously rendered inline on the
 * main Settings page, making that page's list read as one long
 * undifferentiated scroll. Split into its own screen, linked from
 * Settings via a single SettingsNavRow — same pattern now used for
 * Security (profile/settings/security/page.tsx).
 */
export default function NotificationSettingsPage() {
  return (
    <div className="mx-auto max-w-lg px-4 md:px-8 py-8">
      <SettingsSubpageHeader title="Notifications" />
      <PushOptIn />
      <div className="border-t border-border-hairline pt-2 mt-2">
        <NotificationPreferences />
      </div>
    </div>
  );
}
