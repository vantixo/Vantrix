import type { HomeContextInitiative } from "@/lib/frontend/home-context";
import { cn } from "@/lib/utils";

function dayPart(hour: number): "morning" | "afternoon" | "evening" | "night" {
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return hour < 21 ? "evening" : "night";
}

const DAY_PART_LABEL: Record<ReturnType<typeof dayPart>, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

/**
 * Reference-image parity: the greeting header above the status rail
 * ("Good evening, Covenant. Someone's been thinking about you.").
 *
 * Every clause here is backed by a real signal Home already fetched —
 * there's no fabricated "a new scenario just unlocked"-style filler.
 * The emphasised second line only appears when there's an actual pending
 * initiative or recent conversation to point at; a brand-new user with
 * neither gets a plain, honest discovery prompt instead of an invented
 * one.
 *
 * SERVER-CLOCK NOTE: the day-part ("Good evening") and the eyebrow date
 * are computed from the server's clock (this is a Server Component, and
 * the page is `force-dynamic` so it re-renders per request) rather than
 * the visitor's local timezone. That's the right performance trade for
 * a greeting — a client component here would cost a hydration boundary
 * and a layout-shifting client-only render for a cosmetic string. Worth
 * revisiting only if Vantrix's user base skews heavily toward timezones
 * far from the deployment region.
 */
export function Greeting({
  name,
  pendingInitiative,
  recentChatsCount,
}: {
  name: string | null;
  pendingInitiative: HomeContextInitiative | null;
  recentChatsCount: number;
}) {
  const now = new Date();
  const part = dayPart(now.getHours());

  const eyebrow = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);

  const emphasis = pendingInitiative
    ? `${pendingInitiative.character.name} is still waiting on an answer.`
    : recentChatsCount > 0
      ? "Pick up right where you left off."
      : "Your world is waiting.";

  // HERO-DUPLICATION FIX (polish pass): a genuinely fresh account (no
  // initiative, zero recent chats) used to always get a sub-line here —
  // "New companions, scenarios, and stories are ready whenever you are"
  // — immediately followed by HeroSplit's own empty-state banner one
  // section down, which now makes essentially the same pitch ("Welcome
  // to Vantrix... Your first companion is waiting"). Two consecutive
  // "everything here is new, go explore" lines competed for the same
  // attention instead of building toward one clear first move. This sub
  // paragraph now only renders when there's a real signal to report
  // (a pending initiative or an actual chat count) — the fresh-account
  // case lets the hero banner make that pitch once, not twice.
  const isFreshAccount = !pendingInitiative && recentChatsCount === 0;
  const subParts: string[] = [];
  if (recentChatsCount > 0) {
    subParts.push(
      `${recentChatsCount} conversation${recentChatsCount === 1 ? "" : "s"} picked up where you left ${
        recentChatsCount === 1 ? "it" : "them"
      }`
    );
  }
  if (pendingInitiative) {
    subParts.push(`${pendingInitiative.character.name} is still waiting on an answer`);
  }
  const sub =
    subParts.length > 0 ? `${subParts.join(", and ")}.` : null;

  return (
    <section className={cn("px-4 md:px-8", isFreshAccount ? "pt-6 md:pt-8" : "pt-8 md:pt-12")}>
      <div className="max-w-7xl mx-auto">
        <p className="text-xs font-bold tracking-[0.12em] uppercase text-text-tertiary mb-2.5">
          {eyebrow} &middot; {DAY_PART_LABEL[part]}
        </p>
        <h1 className="font-display text-3xl md:text-[42px] leading-[1.1] tracking-tight text-text-primary max-w-2xl">
          Good {part}
          {name ? `, ${name}` : ""}.<br />
          <em className="italic font-normal text-gold-400">{emphasis}</em>
        </h1>
        {sub && (
          <p className="text-text-secondary text-[15px] leading-relaxed max-w-lg mt-2.5">{sub}</p>
        )}
      </div>
    </section>
  );
}
