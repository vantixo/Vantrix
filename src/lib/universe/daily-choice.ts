/**
 * Daily World Choice — "one meaningful, infrequent decision" mechanic.
 *
 * Design constraints (see 20260905_daily_world_choice.sql for the schema
 * rationale):
 *   - Exactly one active choice for the whole world per calendar day.
 *   - Users vote at most once; no editing, no re-voting, no visible tally
 *     until AFTER they vote (prevents bandwagon voting).
 *   - The world does not wait on votes. If nobody votes, the tick worker
 *     still runs — it just has no lean to apply. This keeps the mechanic
 *     truly optional, matching the "world evolves on its own" principle.
 *   - Generation is template-driven from real city_governance /
 *     location_economy rows, not an LLM call — cheap, fast, and always
 *     grounded in actual world state rather than inventing new lore.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { Json } from "@/types/supabase";

export interface DailyWorldChoice {
  id: string;
  locationId: string | null;
  locationName: string | null;
  prompt: string;
  context: string | null;
  optionALabel: string;
  optionBLabel: string;
  activeDate: string;
  resolved: boolean;
  resolvedOption: "a" | "b" | null;
}

export interface DailyChoiceTally {
  votesA: number;
  votesB: number;
  votesTotal: number;
}

/** Today's active choice, if one has been generated yet. Public read. */
export async function getActiveDailyChoice(): Promise<DailyWorldChoice | null> {
  const { data, error } = await supabaseAdmin
    .from("daily_world_choices")
    .select("id, location_id, prompt, context, option_a_label, option_b_label, active_date, resolved, resolved_option, world_locations(name)")
    .eq("active_date", new Date().toISOString().slice(0, 10))
    .maybeSingle();

  if (error) {
    logger.error("getActiveDailyChoice failed", { error: error.message });
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    locationId: data.location_id,
    locationName: (data.world_locations as { name: string } | null)?.name ?? null,
    prompt: data.prompt,
    context: data.context,
    optionALabel: data.option_a_label,
    optionBLabel: data.option_b_label,
    activeDate: data.active_date,
    resolved: data.resolved,
    resolvedOption: data.resolved_option as "a" | "b" | null,
  };
}

/** The user's own vote for a choice, if cast. */
export async function getUserVote(choiceId: string, userId: string): Promise<"a" | "b" | null> {
  const { data } = await supabaseAdmin
    .from("user_world_choice_votes")
    .select("option")
    .eq("choice_id", choiceId)
    .eq("user_id", userId)
    .maybeSingle();

  return (data?.option as "a" | "b" | undefined) ?? null;
}

/** Aggregate tally — safe to show only after the user has voted. */
export async function getTally(choiceId: string): Promise<DailyChoiceTally> {
  const { data } = await supabaseAdmin
    .from("daily_world_choice_tallies")
    .select("votes_a, votes_b, votes_total")
    .eq("choice_id", choiceId)
    .maybeSingle();

  return {
    votesA: data?.votes_a ?? 0,
    votesB: data?.votes_b ?? 0,
    votesTotal: data?.votes_total ?? 0,
  };
}

export type CastVoteResult =
  | { status: "recorded"; option: "a" | "b" }
  | { status: "already_voted"; option: "a" | "b" }
  | { status: "not_found" };

/** Casts a vote. Idempotent — a repeat call returns the user's existing vote rather than erroring. */
export async function castVote(choiceId: string, userId: string, option: "a" | "b"): Promise<CastVoteResult> {
  const existing = await getUserVote(choiceId, userId);
  if (existing) return { status: "already_voted", option: existing };

  const { error } = await supabaseAdmin
    .from("user_world_choice_votes")
    .insert({ choice_id: choiceId, user_id: userId, option });

  if (error) {
    // Unique-violation race (two rapid double-taps): re-read instead of failing the request.
    const current = await getUserVote(choiceId, userId);
    if (current) return { status: "already_voted", option: current };
    logger.error("castVote failed", { error: error.message, choiceId, userId });
    return { status: "not_found" };
  }

  return { status: "recorded", option };
}

/**
 * Resolves any unresolved daily choice for this location whose effect
 * belongs to the given engine, converting the vote result into a one-time
 * numeric bias the tick can add to its own drift calculation.
 *
 * Consumption is atomic and single-use: the UPDATE below only matches rows
 * where resolved = false, so if governance-tick and full_universe_tick both
 * call this for the same location in the same window (the same race the
 * last_ticked_at guards elsewhere in this codebase protect against), only
 * one of them wins the row and applies the lean — the other gets `null`.
 * A choice with zero votes still resolves (so it doesn't linger forever)
 * but returns `null` — no vote means no lean, not a default direction.
 *
 * `engine` filters to effects relevant to the calling tick, so a
 * governance-tick call never accidentally consumes an economy_pressure
 * effect (and vice versa) meant for the other engine's tick on the same
 * location.
 */
export async function resolveLocationChoiceLean(
  locationId: string,
  engine: "governance_pressure" | "economy_pressure",
): Promise<{ field: string; direction: 1 | -1 } | null> {
  const { data: candidate } = await supabaseAdmin
    .from("daily_world_choices")
    .select("id, option_a_effect, option_b_effect")
    .eq("location_id", locationId)
    .eq("resolved", false)
    // Only pick up choices that have had at least one tick cycle to
    // collect votes — i.e. not the same choice that was just generated
    // moments ago in today's cron run.
    .lt("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .order("active_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!candidate) return null;

  const tally = await getTally(candidate.id);
  const optionAEffect = candidate.option_a_effect as { type: string; field: string; direction: "up" | "down" } | null;
  const optionBEffect = candidate.option_b_effect as { type: string; field: string; direction: "up" | "down" } | null;

  let winningOption: "a" | "b" | null = null;
  if (tally.votesTotal > 0) {
    winningOption = tally.votesA > tally.votesB ? "a" : tally.votesB > tally.votesA ? "b" : null; // tie → no lean
  }

  const winningEffect = winningOption === "a" ? optionAEffect : winningOption === "b" ? optionBEffect : null;
  const relevant = winningEffect && winningEffect.type === engine;

  // BUG FIX (verified via cron schedule: economy-tick runs hourly, governance-
  // tick every 4h — see vercel.json): claiming used to happen unconditionally,
  // on the theory that "a choice with an effect for the OTHER engine still
  // gets marked resolved once, whichever engine's tick runs first." In
  // practice that meant economy_tick — ticking 4x more often — nearly always
  // won the claim race and silently discarded governance_pressure effects
  // before governance_tick ever got a chance to see them. This wasn't a rare
  // race; it was the structurally common case.
  //
  // Fix: only claim when there's nothing to lose by claiming now — i.e. a
  // tie/no-votes (winningEffect is null, nothing for ANY engine to apply) or
  // the effect genuinely belongs to this engine. Otherwise leave the row
  // unresolved so the correct engine's own next tick can claim and apply it.
  // getActiveDailyChoice's underlying query orders by active_date ascending
  // with no "today only" filter, so a choice left unresolved across a
  // governance_tick's longer cadence — or even a day boundary — is still
  // found and applied on that engine's next run, not lost.
  if (winningEffect && !relevant) return null;

  // Atomically claim this row so a concurrent call can't double-apply it —
  // same idiom as the last_ticked_at guards on the tick tables themselves.
  const { data: claimed } = await supabaseAdmin
    .from("daily_world_choices")
    .update({
      resolved: true,
      resolved_option: winningOption,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", candidate.id)
    .eq("resolved", false)
    .select("id")
    .maybeSingle();

  if (!claimed || !relevant || !winningEffect) return null;

  return { field: winningEffect.field, direction: winningEffect.direction === "up" ? 1 : -1 };
}

// ── Generation ────────────────────────────────────────────────────────────────

interface ChoiceTemplate {
  prompt: (locationName: string) => string;
  context: (locationName: string, extra: string) => string;
  optionALabel: string;
  optionBLabel: string;
  optionAEffect: Record<string, unknown>;
  optionBEffect: Record<string, unknown>;
  // Which governance/economy condition makes this template relevant.
  applies: (g: { approval_rating: number; stability: number; corruption: number } | null,
            e: { unemployment: number; gdp: number } | null) => boolean;
  extra: (g: { approval_rating: number; stability: number; corruption: number } | null,
          e: { unemployment: number; gdp: number } | null) => string;
}

const TEMPLATES: ChoiceTemplate[] = [
  {
    applies: (g) => !!g && g.corruption > 55,
    extra: (g) => `corruption sits at ${g!.corruption}/100`,
    prompt: (n) => `${n}'s council has been accused of corruption. Should the people demand an investigation?`,
    context: (n, extra) => `Whispers in ${n} say the local government is rotten — ${extra}.`,
    optionALabel: "Demand an investigation",
    optionBLabel: "Let it go for now",
    optionAEffect: { type: "governance_pressure", field: "corruption", direction: "down" },
    optionBEffect: { type: "governance_pressure", field: "stability", direction: "up" },
  },
  {
    applies: (g) => !!g && g.approval_rating < 40,
    extra: (g) => `approval has fallen to ${g!.approval_rating}/100`,
    prompt: (n) => `Support for ${n}'s leadership is collapsing. Should the people rally behind them or push for change?`,
    context: (n, extra) => `${n}'s leader is struggling — ${extra}.`,
    optionALabel: "Rally behind the leader",
    optionBLabel: "Push for new leadership",
    optionAEffect: { type: "governance_pressure", field: "approval_rating", direction: "up" },
    // No election engine exists yet to actually seat a challenger — pushing
    // for change is modeled as short-term instability, which is honest
    // about what this can currently affect (see resolveLocationChoiceLean).
    optionBEffect: { type: "governance_pressure", field: "stability", direction: "down" },
  },
  {
    applies: (_g, e) => !!e && e.unemployment > 45,
    extra: (_g, e) => `unemployment stands at ${e!.unemployment}%`,
    prompt: (n) => `Jobs are scarce in ${n}. Should the city invest in public works or cut spending to stabilize the treasury?`,
    context: (n, extra) => `${n}'s economy is under strain — ${extra}.`,
    optionALabel: "Invest in public works",
    optionBLabel: "Cut spending",
    optionAEffect: { type: "economy_pressure", field: "unemployment", direction: "down" },
    optionBEffect: { type: "economy_pressure", field: "gdp", direction: "up" },
  },
  {
    // Fallback — always applies, used when no city is under acute strain.
    applies: () => true,
    extra: () => "the city is stable for now",
    prompt: (n) => `${n} is enjoying a rare calm. Should the city celebrate with a festival or save the treasury for harder times?`,
    context: (n, extra) => `A quiet season in ${n} — ${extra}.`,
    optionALabel: "Hold a festival",
    optionBLabel: "Save the treasury",
    // Festival buys goodwill (approval); saving grows the treasury (gdp).
    // Both map to fields the tick engines already move — no dependency on
    // an unbuilt culture-mood system.
    optionAEffect: { type: "governance_pressure", field: "approval_rating", direction: "up" },
    optionBEffect: { type: "economy_pressure", field: "gdp", direction: "up" },
  },
];

/**
 * Generates today's choice if one doesn't already exist. Idempotent —
 * safe to call from a cron job that might retry or overlap.
 */
export async function ensureTodaysChoice(): Promise<DailyWorldChoice | null> {
  const today = new Date().toISOString().slice(0, 10);

  const existing = await getActiveDailyChoice();
  if (existing) return existing;

  // Pick a location deterministically-ish (most-populous non-capital gets
  // priority so the same capital doesn't dominate every day).
  const { data: locations } = await supabaseAdmin
    .from("world_locations")
    .select("id, name, city_governance(approval_rating, stability, corruption), location_economy(unemployment, gdp)")
    .order("population", { ascending: false })
    .limit(10);

  if (!locations || locations.length === 0) {
    logger.warn("ensureTodaysChoice: no world_locations to generate from");
    return null;
  }

  // Rotate through candidates deterministically by day-of-year so it's not
  // always the same city, without needing a random seed table.
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000
  );
  const location = locations[dayOfYear % locations.length];
  const governance = (location.city_governance as unknown as { approval_rating: number; stability: number; corruption: number } | null);
  const economy = (location.location_economy as unknown as { unemployment: number; gdp: number } | null);

  const template = TEMPLATES.find((t) => t.applies(governance, economy)) ?? TEMPLATES[TEMPLATES.length - 1];
  const extra = template.extra(governance, economy);

  const { data: inserted, error } = await supabaseAdmin
    .from("daily_world_choices")
    .insert({
      location_id: location.id,
      prompt: template.prompt(location.name),
      context: template.context(location.name, extra),
      option_a_label: template.optionALabel,
      option_b_label: template.optionBLabel,
      option_a_effect: template.optionAEffect as unknown as Json,
      option_b_effect: template.optionBEffect as unknown as Json,
      active_date: today,
    })
    // Race-safe: if another invocation already inserted today's row, the
    // UNIQUE(active_date) constraint fires and we just fetch it instead.
    .select("id")
    .maybeSingle();

  if (error) {
    logger.warn("ensureTodaysChoice insert conflict or failure, re-reading", { error: error.message });
    return getActiveDailyChoice();
  }
  if (!inserted) return getActiveDailyChoice();

  return getActiveDailyChoice();
}
