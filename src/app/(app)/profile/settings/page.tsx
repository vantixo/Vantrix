import { getProfileSettings, getSubscriptionInfo } from "@/lib/frontend/profile";
import { getVerifiedTotpFactorCount } from "@/lib/auth/mfa";
import { SettingsForm } from "@/components/profile/settings-form";
import { AvatarUpload } from "@/components/profile/avatar-upload";
import { SubscriptionManagement } from "@/components/profile/subscription-management";
import { DateOfBirthField } from "@/components/profile/date-of-birth-field";
import { SettingsNavRow } from "@/components/profile/settings-nav-row";
import { StreakShieldPanel } from "@/components/profile/streak-shield-panel";
import { DataPrivacyPanel } from "@/components/profile/data-privacy-panel";
import { ThemePicker } from "@/components/theme/theme-picker";
import { Bell, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profile = await getProfileSettings();

  if (!profile) {
    return (
      <div className="mx-auto max-w-lg px-4 md:px-8 py-16 text-center text-text-secondary">
        Couldn&rsquo;t load your settings. Try refreshing.
      </div>
    );
  }

  const [subscription, verifiedFactorCount] = await Promise.all([
    getSubscriptionInfo(profile.id),
    getVerifiedTotpFactorCount(),
  ]);

  return (
    <div className="mx-auto max-w-lg px-4 md:px-8 py-8 space-y-8">
      <div>
        <h1 className="font-display text-xl text-text-primary mb-6">Settings</h1>

        <AvatarUpload
          currentUrl={profile.avatar_url}
          displayName={profile.display_name ?? profile.username ?? "Your account"}
        />

        <div className="mt-6">
          <SettingsForm initial={profile} />
        </div>
      </div>

      <div className="border-t border-border-hairline pt-6">
        <h2 className="text-sm font-semibold text-text-primary mb-1">Theme</h2>
        <p className="text-xs text-text-secondary mb-3">
          Changes apply instantly, everywhere in the app.
        </p>
        <ThemePicker />
      </div>

      <div id="subscription" className="border-t border-border-hairline pt-6 scroll-mt-20">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Subscription</h2>
        <SubscriptionManagement subscription={subscription} />
      </div>

      {/*
        SETTINGS-NOTIFICATIONS-SPLIT / SETTINGS-SECURITY-SPLIT: both used
        to render their full sub-UI inline here (PushOptIn +
        NotificationPreferences's 14 categories x 2 channels; Security is
        a new feature build, see components/profile/two-factor-settings.tsx).
        Neither is a single toggle, so both get their own screen behind a
        nav row instead of growing this page into one long undifferentiated
        list — see settings/notifications/page.tsx and settings/security/page.tsx.
      */}
      <div className="border-t border-border-hairline pt-6 space-y-3">
        <h2 className="text-sm font-semibold text-text-primary mb-1">Account</h2>
        <SettingsNavRow
          href="/profile/settings/security"
          icon={ShieldCheck}
          label="Security"
          description="Two-factor authentication"
          badge={{
            text: verifiedFactorCount > 0 ? "On" : "Off",
            tone: verifiedFactorCount > 0 ? "on" : "off",
          }}
        />
        <SettingsNavRow
          href="/profile/settings/notifications"
          icon={Bell}
          label="Notifications"
          description="Push alerts and per-category preferences"
        />
      </div>

      <div className="border-t border-border-hairline pt-6">
        <DateOfBirthField />
      </div>

      <div className="border-t border-border-hairline pt-6">
        <h2 className="text-sm font-semibold text-text-primary mb-1">Streak shield</h2>
        <StreakShieldPanel />
      </div>

      <div className="border-t border-border-hairline pt-6">
        <h2 className="text-sm font-semibold text-text-primary mb-1">Privacy &amp; data</h2>
        <DataPrivacyPanel />
      </div>
    </div>
  );
}
