import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { Settings, Coins } from "lucide-react";
import { getProfileSettings } from "@/lib/frontend/profile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DailyProgressCard } from "@/components/profile/daily-progress-card";
import { resolveImageSrc, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * §11 Profile/Account cluster -> account menu's Profile row (previously
 * a 404 — see account-menu.tsx, already linking `/profile`). Read-only
 * overview; editing happens on /profile/settings, matching the account
 * menu's own separation between the two rows.
 *
 * AMENDMENT: added DailyProgressCard below the tokens/messages grid.
 * GET /api/user/usage's xp/streak/quests fields (tokens/messages are
 * already covered by getProfileSettings above) had no consumer anywhere
 * in the app — see that component's own docstring.
 */
export default async function ProfilePage() {
  const profile = await getProfileSettings();

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl px-4 md:px-8 py-16 text-center text-text-secondary">
        Couldn&rsquo;t load your profile. Try refreshing.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-8">
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-20 rounded-full overflow-hidden border border-border-hairline shrink-0">
          <Image
            src={resolveImageSrc(profile.avatar_url)}
            alt=""
            fill
            sizes="80px"
            className="object-cover"
          />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-xl text-text-primary truncate">
            {profile.display_name ?? profile.username ?? "Your account"}
          </h1>
          {profile.username && (
            <p className="text-text-secondary text-sm">@{profile.username}</p>
          )}
          <span className="inline-block mt-1 text-xs text-gold-400 uppercase tracking-wide font-semibold">
            {profile.tier} tier
          </span>
        </div>
      </div>

      {profile.bio && (
        <p className="text-[15px] text-text-primary leading-relaxed mt-5">
          {profile.bio}
        </p>
      )}

      <div className="mt-6">
        <Card interactive={false} className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Vantrix Coin</span>
            <Coins className="h-4 w-4 text-gold-500" />
          </div>
          <div className="font-display text-2xl text-text-primary mt-1 tabular-nums">
            {profile.tokens.toLocaleString()}
          </div>
          <Link
            href="/profile/tokens"
            className="text-xs text-gold-400 hover:text-gold-300 font-semibold"
          >
            Buy more
          </Link>
        </Card>
      </div>

      <DailyProgressCard />

      <p className="text-xs text-text-tertiary mt-4">
        Member since {formatDate(profile.created_at)}
      </p>

      <div className="flex gap-3 mt-6">
        <Button asChild variant="secondary">
          <Link href="/profile/settings">
            <Settings className="h-4 w-4" /> Edit Profile
          </Link>
        </Button>
        {profile.tier === "free" && (
          <Button asChild variant="primary">
            <Link href="/premium">Upgrade</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
