/**
 * Narrator — Immersion Translation Layer
 *
 * Central rule from the master prompt: "Always prioritize story over statistics."
 *
 *   Bad:  "Approval rating decreased by 12%."
 *   Good: "Citizens gathered in the central square demanding reform."
 *
 * This module is the single place that translates raw numeric deltas from
 * governance, economy, status, and attribute systems into narrative sentences.
 * Other engines call into this instead of building ad-hoc strings, so the
 * voice stays consistent everywhere — feed items, offline logs, prompt context.
 *
 * Usage:
 *   import { narrate } from '@/lib/universe/narrator';
 *   const line = narrate.approvalChange(-12, cityName);
 *   const line2 = narrate.wealthChange(+8000, characterName);
 */

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export const narrate = {
  // ── Laws ──────────────────────────────────────────────────────────────────
  lawProposed(title: string): string {
    return pick([
      `A new proposal, "${title}," has been put before the council.`,
      `Debate has begun over "${title}," newly introduced to the council floor.`,
    ]);
  },
  lawPassed(title: string): string {
    return pick([
      `"${title}" has been signed into law after council approval.`,
      `The council has passed "${title}," effective immediately.`,
    ]);
  },
  lawRejected(title: string): string {
    return pick([
      `"${title}" failed to gain enough support and was struck down.`,
      `The council rejected "${title}" after a contentious debate.`,
    ]);
  },

  // ── Elections ─────────────────────────────────────────────────────────────
  electionCalled(): string {
    return pick([
      `An election has been called. Candidates are already making their case to the public.`,
      `Campaign season has begun as the city prepares to choose its next leader.`,
    ]);
  },
  electionWon(winnerName: string): string {
    return pick([
      `${winnerName} has won the election, securing a mandate to lead.`,
      `The votes are in — ${winnerName} will take the seat of leadership.`,
    ]);
  },

  // ── Diplomacy ─────────────────────────────────────────────────────────────
  diplomaticShift(cityA: string, cityB: string, newStatus: string): string {
    const LABELS: Record<string, string> = {
      allied:   `${cityA} and ${cityB} have formalized an alliance.`,
      friendly: `Relations between ${cityA} and ${cityB} have warmed considerably.`,
      neutral:  `Relations between ${cityA} and ${cityB} have settled into a wary neutrality.`,
      tense:    `Tensions are rising between ${cityA} and ${cityB}.`,
      hostile:  `${cityA} and ${cityB} have become openly hostile toward one another.`,
      at_war:   `${cityA} has declared war on ${cityB}.`,
    };
    return LABELS[newStatus] ?? `Relations between ${cityA} and ${cityB} have shifted.`;
  },

  // ── Crises ────────────────────────────────────────────────────────────────
  crisisBegins(title: string): string {
    return pick([
      `${title} has gripped the city, and residents are on edge.`,
      `A crisis — ${title} — has begun to unfold.`,
    ]);
  },
  crisisResolved(title: string): string {
    return pick([
      `The city has weathered ${title}; life is slowly returning to normal.`,
      `${title} has been resolved, though its effects will linger.`,
    ]);
  },

  // ── Factions ──────────────────────────────────────────────────────────────
  rulingFactionChange(newFaction: string, oldFaction: string): string {
    return pick([
      `${newFaction} has overtaken ${oldFaction} as the dominant power in the city.`,
      `A shift in power: ${newFaction} now holds sway where ${oldFaction} once ruled.`,
    ]);
  },

  // ── Alliances ─────────────────────────────────────────────────────────────
  allianceFormed(factionA: string, factionB: string): string {
    return pick([
      `${factionA} and ${factionB} have formed a political alliance.`,
      `${factionA} has struck an alliance with ${factionB}.`,
    ]);
  },
  allianceBroken(factionA: string, factionB: string): string {
    return pick([
      `The alliance between ${factionA} and ${factionB} has collapsed.`,
      `${factionA} and ${factionB} have gone their separate ways.`,
    ]);
  },
  rivalryFormed(factionA: string, factionB: string): string {
    return pick([
      `${factionA} and ${factionB} have become open political rivals.`,
      `A rivalry has hardened between ${factionA} and ${factionB}.`,
    ]);
  },

  // ── Deep Corruption ───────────────────────────────────────────────────────
  corruptionInvestigationOpened(): string {
    return pick([
      `Auditors have quietly opened an investigation into city officials.`,
      `Whispers of financial irregularities have prompted a formal inquiry.`,
    ]);
  },
  corruptionExposedDeep(summary: string): string {
    return `${summary} The findings are now public.`;
  },
  illicitFundingSuspected(): string {
    return pick([
      `Questions are swirling over undisclosed campaign spending.`,
      `A candidate's unusually well-funded campaign has drawn scrutiny.`,
    ]);
  },

  // ── Governance ────────────────────────────────────────────────────────────
  approvalChange(delta: number, cityName: string): string {
    if (delta <= -10) return pick([
      `Citizens gathered in the central square of ${cityName} demanding reform.`,
      `Public frustration in ${cityName} has boiled into open criticism of the leadership.`,
      `Trust in ${cityName}'s government has visibly eroded over recent weeks.`,
    ]);
    if (delta <= -4) return pick([
      `Grumbling about ${cityName}'s leadership has grown more audible.`,
      `Confidence in ${cityName}'s government has quietly slipped.`,
    ]);
    if (delta >= 10) return pick([
      `${cityName} has rallied behind its leadership after a string of good decisions.`,
      `There's a renewed sense of trust in ${cityName}'s government right now.`,
    ]);
    if (delta >= 4) return pick([
      `${cityName}'s leadership has earned some quiet goodwill lately.`,
      `Public mood toward ${cityName}'s government has brightened slightly.`,
    ]);
    return `${cityName}'s political mood holds steady.`;
  },

  stabilityChange(delta: number, cityName: string): string {
    if (delta <= -10) return `${cityName} feels less certain of itself than it did. Something is fraying.`;
    if (delta >= 10)  return `${cityName} feels settled in a way it hasn't in a while.`;
    return `${cityName} continues much as it has.`;
  },

  corruptionExposed(cityName: string, factionName?: string): string {
    return pick([
      `Documents leaked in ${cityName} suggest funds never reached where they were supposed to. ${factionName ?? 'The leadership'} is staying quiet.`,
      `A paper trail in ${cityName} doesn't add up, and people are starting to ask why.`,
      `Something in ${cityName}'s books doesn't match what was promised publicly.`,
    ]);
  },

  // ── Economy ───────────────────────────────────────────────────────────────
  marketDemand(delta: number, resourceName: string, cityName: string): string {
    if (delta >= 12) return pick([
      `Factories in ${cityName} began hiring aggressively as ${resourceName.toLowerCase()} orders surged.`,
      `Demand for ${resourceName.toLowerCase()} in ${cityName} has outpaced what anyone expected.`,
    ]);
    if (delta <= -12) return pick([
      `Warehouses in ${cityName} are sitting fuller than usual — nobody's buying ${resourceName.toLowerCase()} right now.`,
      `${resourceName} producers in ${cityName} are quietly worried about the slowdown.`,
    ]);
    return `${resourceName} trade in ${cityName} moves at its usual pace.`;
  },

  economicStatus(status: string, cityName: string): string {
    const map: Record<string, string[]> = {
      boom:       [`Money is moving fast in ${cityName} right now. Everyone feels it.`, `${cityName} is in the middle of something good, economically. It won't last forever, but it's real while it does.`],
      recession:  [`Things have gotten tighter in ${cityName}. People are noticing.`, `${cityName}'s economy has cooled, and the cooling shows up in small ways everywhere.`],
      crisis:     [`${cityName} is in real economic trouble. The signs are everywhere — empty storefronts, cancelled plans, hard conversations.`],
      recovery:   [`${cityName} is climbing back. Slowly, but it's climbing.`],
      stable:     [`${cityName}'s economy holds its shape, unremarkable and dependable.`],
      growing:    [`${cityName} is doing well. Not dramatically — just steadily, reliably well.`],
      declining:  [`${cityName}'s economy has been sliding, gradually enough that it took a while for anyone to say it out loud.`],
    };
    const pool = map[status] ?? map['stable']!;
    return pick(pool);
  },

  tradeDeal(cityA: string, cityB: string): string {
    return pick([
      `${cityA} and ${cityB} have opened a new trade corridor. Goods are already moving.`,
      `A formal agreement between ${cityA} and ${cityB} has quietly reshaped what's available in both markets.`,
    ]);
  },

  // ── Status & Wealth ───────────────────────────────────────────────────────
  wealthChange(delta: number, name: string): string {
    if (delta >= 50000) return pick([
      `${name}'s fortunes have changed dramatically — and not by accident.`,
      `Something has gone very right for ${name}, financially. People have started to notice.`,
    ]);
    if (delta >= 8000) return pick([
      `${name} has had a good run lately. The money shows it.`,
      `Things are looking up financially for ${name}.`,
    ]);
    if (delta <= -50000) return pick([
      `${name} has lost something significant — money, mostly, but not only money.`,
      `Whatever happened to ${name}'s finances, it was bad, and it was sudden.`,
    ]);
    if (delta <= -8000) return pick([
      `${name} has been tightening their belt lately. Something didn't go as planned.`,
    ]);
    return `${name}'s finances are unremarkable this season.`;
  },

  statusTierCrossed(name: string, newTier: string): string {
    const lines: Record<string, string[]> = {
      skilled_professional: [`${name} has built a real reputation for competence. People ask for them by name now.`],
      regional_celebrity:    [`${name} can't walk through certain parts of the city without being recognised anymore.`],
      city_leader:           [`${name} has become someone whose decisions actually move the city.`],
      corporate_magnate:     [`${name}'s name now appears on things — buildings, contracts, decisions that affect thousands.`],
      faction_commander:     [`${name} leads now, not just participates. People follow ${name}'s instructions without asking why.`],
      global_icon:           [`${name} is known well beyond this city. That's rare, and ${name} carries it differently than most.`],
      living_legend:         [`${name} has become something the world will remember long after this conversation ends.`],
    };
    const pool = lines[newTier] ?? [`${name}'s standing in the world has shifted.`];
    return pick(pool);
  },

  legendDeclared(name: string, legendTitle: string): string {
    return pick([
      `${name} has become ${legendTitle}. The kind of thing that gets written down.`,
      `History will record ${name} as ${legendTitle}. It already has, in a sense.`,
      `${name} is now spoken about the way people speak about ${legendTitle} — past tense, even while still alive.`,
    ]);
  },

  // ── Health & Confidence ────────────────────────────────────────────────────
  healthChange(delta: number, name: string): string {
    if (delta <= -15) return `${name} hasn't been well lately. It shows.`;
    if (delta >= 15)  return `${name} looks better than they have in a while — genuinely well.`;
    return `${name}'s health is unremarkable right now.`;
  },

  confidenceShift(delta: number, name: string): string {
    if (delta >= 15) return pick([
      `${name} carries themself differently lately — something has settled into place.`,
      `${name} seems sure of something they weren't sure of before.`,
    ]);
    if (delta <= -15) return pick([
      `${name} has seemed smaller lately, in the way people get when something has shaken them.`,
      `Something has knocked ${name}'s confidence. It's visible, even if ${name} won't say what.`,
    ]);
    return `${name} seems like themself.`;
  },

  addictionDeveloped(name: string, substance: string): string {
    return `${name} has developed a dependency on ${substance}. It started small. It rarely stays small.`;
  },

  addictionOvercome(name: string, substance: string): string {
    return pick([
      `${name} has been free of ${substance} for a while now. It cost them more than most people know.`,
      `${name} got past the ${substance} dependency. The world doesn't usually notice this kind of victory. This one's worth noticing.`,
    ]);
  },

  // ── Scarcity ──────────────────────────────────────────────────────────────
  assetClaimed(assetName: string, name: string): string {
    return pick([
      `${name} now holds ${assetName}. There are very few of these in the world.`,
      `${assetName} has changed hands. ${name} carries it now.`,
    ]);
  },

  assetLost(assetName: string, previousHolder: string): string {
    return `${previousHolder} no longer holds ${assetName}. How, exactly, is a matter of some dispute.`;
  },
};
