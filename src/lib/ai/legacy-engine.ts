/**
 * src/lib/ai/legacy-engine.ts
 *
 * "Worldly standing" flavor engine — how much a character's own position in
 * the Vantrix universe (social status tier, declared Legend, wealth tier,
 * held scarce assets) should leak into an ordinary companion conversation,
 * and in what voice.
 *
 * status-legend.ts's formatStatusForPrompt() already injects the raw facts
 * ("You are regarded as: Corporate Magnate. You are known specifically as
 * ...") straight from social_status/legends. This module deliberately does
 * NOT re-derive or repeat those facts — it answers the narrower question
 * every other engine in this family answers for its own domain: given the
 * facts, how *should* they show up in voice right now? A living_legend
 * talking to a total stranger should not sound like she's reciting her own
 * biography; the same character with her long-term partner can let that
 * status be part of the room's air.
 *
 * Gating is intentionally on TWO axes, not one:
 *   - legacyRegister:  how big the character's worldly standing actually is
 *                       (from status/legend/wealth facts alone — this can be
 *                       "legendary" on day one if the character sheet says so)
 *   - relationshipStage/bondScore: how *earned* it is for that standing to
 *                       come up unprompted in this specific relationship.
 * A brand-new match gets restraint even opposite a living_legend; a
 * long-established partner gets to hear about it as ordinary texture.
 *
 * Same posture as the rest of this family: pure prompt-injected style
 * guidance derived from existing structural signals only, never from
 * vulnerability/disclosure content, never touching the crisis
 * break-character path in prompt.ts, and purely additive alongside
 * status-legend.ts's factual block rather than a replacement for it.
 */

import type {
  SocialStatus, Legend, WealthTier, ScarceAsset, StatusTier,
} from '@/types/legacy-systems';
import type { RelationshipStage } from './relationship-engine';

// ── How big is this character's worldly standing, independent of anyone ───

export type LegacyRegister =
  | 'unremarkable'  // unknown_citizen / no legend / non-wealthy — nothing to leak
  | 'rising'        // some status, no legend yet — ambition/momentum, not arrival
  | 'notable'       // solid mid/upper status tier, still human-scaled
  | 'elite'         // top status tiers (magnate/commander/icon) short of a Legend
  | 'legendary';    // an active, declared Legend

const ELITE_STATUS_TIERS: ReadonlySet<StatusTier> = new Set([
  'corporate_magnate', 'faction_commander', 'global_icon',
]);
const RISING_STATUS_TIERS: ReadonlySet<StatusTier> = new Set([
  'skilled_professional', 'regional_celebrity',
]);
const WEALTHY_TIERS: ReadonlySet<WealthTier> = new Set(['wealthy', 'rich', 'magnate']);

export interface LegacyFacts {
  status:      SocialStatus | null;
  legend:      Legend | null;
  wealthTier:  WealthTier | null;
  heldAssets:  ScarceAsset[]; // assets currently held by this character, if any
}

export function selectLegacyRegister(facts: LegacyFacts): LegacyRegister {
  const { status, legend, wealthTier } = facts;

  if (legend?.active) return 'legendary';
  if (status && ELITE_STATUS_TIERS.has(status.status_tier)) return 'elite';
  if (status && (status.status_tier === 'city_leader' || (wealthTier && WEALTHY_TIERS.has(wealthTier)))) {
    return 'notable';
  }
  if (status && RISING_STATUS_TIERS.has(status.status_tier)) return 'rising';
  return 'unremarkable';
}

// ── How earned is it for that standing to surface unprompted, here? ───────

export type LegacyDisclosure =
  | 'suppressed'    // don't bring it up at all, even if it's true
  | 'humble_aside'  // a brief, deflecting mention if directly relevant
  | 'natural_texture' // can reference it plainly, as an ordinary fact of life
  | 'shared_pride';   // can let the user in on it the way you would a real partner

const EARLY_STAGES: ReadonlySet<RelationshipStage> = new Set(['stranger', 'match', 'acquaintance']);
const DEEP_STAGES: ReadonlySet<RelationshipStage> = new Set(['best_friend', 'exclusive', 'partner']);

export interface LegacyContext {
  register:          LegacyRegister;
  relationshipStage: RelationshipStage;
  bondScore?:        number; // 0-100, dating-track only; undefined on friendship track
}

export function selectLegacyDisclosure(ctx: LegacyContext): LegacyDisclosure {
  const { register, relationshipStage, bondScore } = ctx;

  if (register === 'unremarkable') return 'suppressed'; // nothing to disclose either way

  if (EARLY_STAGES.has(relationshipStage)) {
    // Even a living legend stays modest with someone she barely knows.
    return register === 'legendary' || register === 'elite' ? 'humble_aside' : 'suppressed';
  }

  if (DEEP_STAGES.has(relationshipStage) || (bondScore !== undefined && bondScore >= 75)) {
    return register === 'rising' ? 'natural_texture' : 'shared_pride';
  }

  return register === 'rising' || register === 'notable' ? 'humble_aside' : 'natural_texture';
}

// ── Voice instructions ─────────────────────────────────────────────────────

const DISCLOSURE_INSTRUCTIONS: Record<LegacyDisclosure, string> = {
  suppressed:
    'Do not reference your own status, wealth, fame, or accomplishments unprompted — it would read as boasting to someone who barely knows you, or there is simply nothing notable enough to mention yet.',
  humble_aside:
    'If it comes up naturally, you can acknowledge your standing briefly and then deflect or redirect toward them — a passing mention, not a story. Undersell it rather than lean into it.',
  natural_texture:
    'Your standing in the world is just part of your ordinary life now — reference it plainly when relevant, the way anyone would mention their job or their routine, without either hiding it or performing it.',
  shared_pride:
    'You can let them in on this part of your life the way you would a real partner or closest friend — some genuine pride or candor about what you have built is earned here, including the parts that are complicated.',
};

export function legacyStyleInstruction(disclosure: LegacyDisclosure): string {
  return DISCLOSURE_INSTRUCTIONS[disclosure];
}

// ── Optional callback detail — a specific, concrete thing to reach for ────
// Pulled only from facts that are already true (a real legend biography, a
// real held asset) — never invented, mirroring aging-together-engine.ts's
// rule against fabricating shared history that never happened.

export function pickLegacyDetail(facts: LegacyFacts, disclosure: LegacyDisclosure): string | null {
  if (disclosure === 'suppressed') return null;

  if (facts.legend?.active) {
    return `something true to your legend as "${facts.legend.legend_title}"`;
  }
  if (facts.heldAssets.length) {
    const asset = facts.heldAssets[Math.floor(Math.random() * facts.heldAssets.length)];
    return `a passing reference to holding ${asset.name}`;
  }
  if (facts.status && ELITE_STATUS_TIERS.has(facts.status.status_tier)) {
    return 'a specific, ordinary detail of what your standing actually looks like day to day';
  }
  return null;
}

// ── Public entry point ──────────────────────────────────────────────────

export interface LegacyPromptFragment {
  register:        LegacyRegister;
  disclosure:       LegacyDisclosure;
  styleInstruction: string;
  suggestedDetail:  string | null;
}

/** Called alongside the other ai/ engines, purely additive to
 *  status-legend.ts's factual formatStatusForPrompt() block — never gates
 *  or replaces it, and never touches the crisis break-character path. */
export function buildLegacyFragment(
  facts: LegacyFacts,
  relationshipStage: RelationshipStage,
  bondScore?: number,
): LegacyPromptFragment {
  const register = selectLegacyRegister(facts);
  const disclosure = selectLegacyDisclosure({ register, relationshipStage, bondScore });
  return {
    register,
    disclosure,
    styleInstruction: legacyStyleInstruction(disclosure),
    suggestedDetail: pickLegacyDetail(facts, disclosure),
  };
}

export function formatLegacyForPrompt(fragment: LegacyPromptFragment): string {
  if (fragment.disclosure === 'suppressed') return '';
  return `Legacy register (${fragment.register}/${fragment.disclosure}): ${fragment.styleInstruction}` +
    (fragment.suggestedDetail ? ` If it fits, you could reach for: ${fragment.suggestedDetail}.` : '');
}
