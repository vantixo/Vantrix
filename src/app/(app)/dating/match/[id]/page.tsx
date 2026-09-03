import { SafeImage as Image } from "@/components/ui/safe-image";
import { notFound } from "next/navigation";
import { Flame, Heart, Wand2, Trophy, CalendarClock } from "lucide-react";
import { resolveImageSrc } from "@/lib/utils";
import {
  getDatingMatch,
  getGiftShop,
  getChemistry,
  getForecast,
  getCompatibility,
  getPrestigeStatus,
  getActiveDateSession,
} from "@/lib/frontend/dating";
import { getShellSession } from "@/lib/frontend/session";
import { DATING_TIER_LABELS, type DatingMatchTier } from "@/lib/dating/constants";
import { StartChatButton } from "@/components/characters/start-chat-button";
import { GiftPicker } from "@/components/dating/gift-picker";
import { ChemistryCard } from "@/components/dating/chemistry-card";
import { ForecastCard } from "@/components/dating/forecast-card";
import { MoodScenePicker } from "@/components/dating/mood-scene-picker";
import { ShareCardButton } from "@/components/dating/share-card-button";
import { AllMilestonesDrawer } from "@/components/dating/all-milestones-drawer";
import { DatePicker } from "@/components/dating/date-picker";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { MILESTONE_LABEL, MILESTONE_EMOJI } from "@/lib/dating/milestone-labels";

export const dynamic = "force-dynamic";

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // UX AUDIT FIX (item 3): getDatingMatch() has no internal try/catch, so
  // a genuine fetch failure and "no such match" both previously hit the
  // same `if (!match) notFound()` line — a transient error showed the
  // user a 404 for a match that actually exists. Now they're told apart:
  // a thrown error gets its own message instead of masquerading as 404.
  let match: Awaited<ReturnType<typeof getDatingMatch>>;
  try {
    match = await getDatingMatch(id);
  } catch {
    return (
      <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
        <UnavailableState message="This match couldn't be loaded — try again in a moment." />
      </div>
    );
  }
  if (!match || !match.character) notFound();

  // Fan out — match must resolve first (character data feeds the other
  // calls' request bodies), but chemistry/forecast/gift-shop/session are
  // otherwise independent reads, so they run in parallel per the app's
  // Promise.all convention rather than a waterfall. getGiftShop() also
  // has no internal try/catch (unlike getChemistry/getForecast just
  // below it, which already fail soft to null) — a gift-shop-specific
  // failure shouldn't take down the whole match page, so it's caught
  // here and the Gift section degrades on its own instead.
  const [giftShop, chemistry, forecast, session, compatibility, prestige, activeDate] =
    await Promise.all([
      getGiftShop(id).catch(() => null),
      getChemistry(id),
      getForecast(id),
      getShellSession(),
      getCompatibility(id),
      getPrestigeStatus(id),
      getActiveDateSession(id),
    ]);
  const catalogue = giftShop?.catalogue ?? [];

  const character = match.character;
  const tier = (match.match_tier ?? "spark") as DatingMatchTier;
  const userTier = session?.profile.tier ?? "free";
  const daysKnown = Math.max(
    0,
    Math.floor((Date.now() - new Date(match.created_at).getTime()) / 86_400_000)
  );

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border-hairline">
          <Image
            src={resolveImageSrc(character.image_url)}
            alt={character.name}
            fill
            sizes="80px"
            className="object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl text-text-primary">{character.name}</h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            {DATING_TIER_LABELS[tier]} · Bond {match.bond_score}
            {(compatibility?.score ?? match.compatibility_pct) !== null && (
              <>
                {" · "}
                <span className="text-gold-400">
                  {compatibility?.score ?? match.compatibility_pct}% compatible
                </span>
              </>
            )}
          </p>
          {compatibility?.message && (
            <p className="mt-0.5 text-xs text-text-tertiary">{compatibility.message}</p>
          )}
          {match.streak_days !== null && match.streak_days > 0 && (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-gold-400">
              <Flame className="h-4 w-4" />
              {match.streak_days} day streak
            </p>
          )}
          <ShareCardButton
            className="mt-2"
            label="Share this connection"
            request={{
              type: "relationship",
              characterId: character.id,
              characterName: character.name,
              characterImage: resolveImageSrc(character.image_url),
              bondScore: match.bond_score,
              matchTier: tier,
              compatibility: match.compatibility_pct ?? 0,
              mood: match.character_mood ?? "happy",
              streakDays: match.streak_days ?? 0,
              daysKnown,
            }}
          />
        </div>
      </div>

      <div className="mt-4">
        <StartChatButton characterId={character.id} />
      </div>

      {(chemistry || forecast) && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {chemistry && <ChemistryCard dimensions={chemistry} />}
          {forecast && <ForecastCard forecast={forecast} />}
        </div>
      )}

      {match.milestones_log.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Milestones</h2>
            {/* WIRE-FIX (2026-08-20): this list was always capped at the 3
                most recent (see /api/dating/matches's .slice(0, 3)) with no
                way to see the rest. `match.milestones` is the real running
                total (same column, already fetched, previously unrendered)
                — only show "view all" when there's actually more to see. */}
            {match.milestones !== null && match.milestones > match.milestones_log.length && (
              <AllMilestonesDrawer matchId={match.id} totalCount={match.milestones} />
            )}
          </div>
          <div className="flex flex-col gap-2">
            {match.milestones_log.map((m, i) => (
              <div
                key={`${m.milestone_type}-${i}`}
                className="flex items-center gap-3 rounded-sm border border-border-hairline px-3 py-2 text-sm"
              >
                <Heart className="h-4 w-4 shrink-0 text-gold-400" />
                <span className="text-text-primary">
                  {MILESTONE_LABEL[m.milestone_type] ?? m.milestone_type}
                </span>
                <span className="ml-auto shrink-0 text-text-tertiary">
                  {new Date(m.created_at).toLocaleDateString()}
                </span>
                <ShareCardButton
                  label=""
                  request={{
                    type: "milestone",
                    characterId: character.id,
                    characterName: character.name,
                    characterImage: resolveImageSrc(character.image_url),
                    milestoneKey: m.milestone_type,
                    milestoneLabel: MILESTONE_LABEL[m.milestone_type] ?? m.milestone_type,
                    milestoneEmoji: MILESTONE_EMOJI[m.milestone_type] ?? "\u{1F49B}",
                    bondScore: match.bond_score,
                    streakDays: match.streak_days ?? 0,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-text-primary">Send a Gift</h2>
        {giftShop ? (
          <GiftPicker matchId={match.id} matchTier={tier} catalogue={catalogue} />
        ) : (
          <p className="text-sm text-text-tertiary">
            Gifts are temporarily unavailable — try refreshing the page.
          </p>
        )}
      </div>

      {prestige?.inPrestige && prestige.chapter && (
        <div className="mt-8 rounded-md border border-gold-500/30 bg-gold-500/5 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gold-400">
            <Trophy className="h-4 w-4" />
            Chapter {prestige.chapter.number}: {prestige.chapter.title}
          </h2>
          <p className="text-sm text-text-secondary">{prestige.chapter.description}</p>
          {prestige.currentBeat && (
            <p className="mt-3 border-t border-gold-500/20 pt-3 text-sm text-text-primary">
              <span className="text-text-tertiary">
                Day {prestige.currentBeat.day} · Beat {prestige.currentBeat.beatIndex + 1}/
                {prestige.chapter.totalBeats}
              </span>
              <br />
              <span className="font-medium">{prestige.currentBeat.title}</span> —{" "}
              {prestige.currentBeat.description}
            </p>
          )}
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <CalendarClock className="h-4 w-4 text-gold-400" />
          First Dates
        </h2>
        <DatePicker matchId={match.id} matchTier={tier} initialActiveSession={activeDate} />
      </div>

      <div className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Wand2 className="h-4 w-4 text-gold-400" />
          Mood Scene
        </h2>
        <MoodScenePicker matchId={match.id} userTier={userTier} />
      </div>
    </div>
  );
}
