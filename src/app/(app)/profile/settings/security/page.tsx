import { SettingsSubpageHeader } from "@/components/profile/settings-subpage-header";
import { TwoFactorSettings } from "@/components/profile/two-factor-settings";

export const dynamic = "force-dynamic";

/**
 * SETTINGS-SECURITY-SPLIT: two-factor authentication (feature build —
 * see components/profile/two-factor-settings.tsx and lib/auth/mfa.ts)
 * gets its own screen off the main Settings page rather than an inline
 * block, matching the same reasoning as the Notifications split
 * (profile/settings/notifications/page.tsx) — this is a real sub-UI
 * (device list, QR enrollment, per-device removal), not a single toggle.
 */
export default function SecuritySettingsPage() {
  return (
    <div className="mx-auto max-w-lg px-4 md:px-8 py-8">
      <SettingsSubpageHeader title="Security" />
      <TwoFactorSettings />
    </div>
  );
}
