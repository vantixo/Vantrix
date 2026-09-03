/**
 * Universe Prompt Assembler v3 — Legacy Systems
 *
 * DROP-IN REPLACEMENT for src/lib/universe/universe-prompt.ts (superset of
 * the v2 World Expansion version). Adds social status, legend status, and
 * character condition (health/confidence/wealth/skills/addictions) to the
 * context every companion's prompt receives.
 *
 * Same exports, same signatures — overwrite directly.
 */

import { buildUniversePromptContext }  from './world-engine';
import { formatSocialGraphForPrompt }                     from './social-graph';
import { formatActiveEventsForPrompt }                    from './event-engine';
import { formatActiveStoriesForPrompt }                   from './story-engine';
import { formatLifeContextForPrompt }                      from './life-engine';
import { formatReputationForPrompt }                       from './reputation';
import { formatGovernanceForPrompt }                       from './governance';
import { formatEconomyForPrompt }                          from './economy';
import { formatEmploymentForPrompt }                        from './employment-engine';
import { formatHousingForPrompt }                           from './housing-engine';
import { formatTaxationForPrompt }                          from './taxation-engine';
import { supabaseAdmin }                                   from '@/lib/supabase/admin';
import { formatJobForPrompt }                               from './companion-jobs';
import { formatStatusForPrompt }                            from './status-legend';
import { formatAttributesForPrompt }                        from './character-evolution';
import { formatAssetsForPrompt }                            from './scarcity';
import { formatTitlesForPrompt }                             from './reputation-titles';
import { formatWorldImpactForPrompt }                        from './world-impact';
import { formatPublicPerceptionForPrompt }                    from './reputation-engine';
import { formatCompanyForPrompt }                              from './company-engine';
import { formatOrganizationForPrompt, getCharacterOrganizationIds } from './organization-engine';
import { formatMessagesForPrompt }                              from './agent-communication';
import { formatDesireForPrompt }                              from '@/lib/ai/desire-engine';
import { formatWeatherForPrompt }                            from './weather-engine';
import { formatSeasonEffectsForPrompt }                      from './season-engine';
import { formatAgingContextForPrompt }                       from './aging-engine';
import { formatCommunityForPrompt }                          from './community-engine';
import { formatCrimeForPrompt }                              from './crime-engine';
import { formatCultureForPrompt }                            from './culture-engine';
import { formatInflationForPrompt }                          from './inflation-engine';
import { formatMarketForPrompt }                             from './market-engine';
import { formatReligionForPrompt }                           from './religion-engine';
import { formatScienceForPrompt }                            from './science-engine';
import { formatLeadershipForPrompt }                         from './leadership-engine';
import { formatBankingForPrompt }                            from './banking-engine';
import { formatSocialCirclePerceptionForPrompt }              from './reputation-engine';
import { cachedPromptFormat }                               from './prompt-cache';
import { logger }                                           from '@/lib/logger';

export interface UniverseContextOptions {
  includeLocation?:    boolean;
  includeSocialGraph?: boolean;
  includeEvents?:      boolean;
  includeStories?:     boolean;
  includeLife?:        boolean;
  includeReputation?:  boolean;
  includeGovernance?:  boolean;
  includeEconomy?:     boolean;
  includeEmployment?:  boolean;  // new — Phase 4 wiring: local job market conditions
  includeHousing?:     boolean;  // new — Phase 4 wiring: character's own housing cost/status
  includeTaxation?:    boolean;  // new — Phase 4 wiring: local tax burden
  includeJob?:         boolean;
  includeCompany?:     boolean;   // new — founded/employer company (founding, headcount, market share); see company-engine.ts
  includeStatus?:      boolean;   // new
  includeAttributes?:  boolean;   // new
  includeAssets?:      boolean;   // new
  includeTitles?:      boolean;   // new — contested "Most Trusted/Feared/..." leaderboard
  includeDesire?:      boolean;   // new — core need/want/fear/obsession; requires userId
  includeWorldImpact?: boolean;   // new — permanent user-action traces; requires userId
  includePublicPerception?: boolean; // new — "every citizen knows you as..." public trait tags
  includeOrganization?: boolean; // new — org memberships, role, cohesion, and org-scope collective memory
  includeMessages?:     boolean; // new — recent rumors/directives/warnings reaching this character
  includeWeather?:      boolean; // new — current weather at the character's location; see weather-engine.ts
  includeSeason?:       boolean; // new — global seasonal effects narration; see season-engine.ts
  includeAging?:        boolean; // new — recent birthday context; see aging-engine.ts
  includeCommunity?:    boolean; // new — neighborhood/community-org/club ties; see community-engine.ts
  includeCrime?:        boolean; // new — unresolved crime incidents at the character's location; see crime-engine.ts
  includeCulture?:      boolean; // new — active cultural trends at the character's location; see culture-engine.ts
  includeInflation?:    boolean; // new — local cost-of-living/inflation snapshot; see inflation-engine.ts
  includeMarket?:       boolean; // new — local goods/prices; see market-engine.ts
  includeReligion?:     boolean; // new — active religious events at the character's location; see religion-engine.ts
  includeScience?:      boolean; // new — global recent scientific discoveries; see science-engine.ts
  includeLeadership?:   boolean; // new — current leader of the character's primary organization; see leadership-engine.ts
  includeBanking?:      boolean; // new — financial-stress signal (low balance / outstanding debt); see banking-engine.ts
  includeSocialCirclePerception?: boolean; // new — public reputation of people in this character's own social circle; see reputation-engine.ts
  userId?:             string;    // optional — enables includeDesire/includeWorldImpact
}

/**
 * Resolves a character's current location_id via companion_occupations —
 * same lookup formatEconomyForPrompt() already does internally — then
 * calls a location-keyed formatter. Returns '' if the character has no
 * resolvable occupation/location yet, matching the other formatters'
 * "silently omit" behavior rather than throwing.
 */
async function withCharacterLocation(
  characterId: string,
  formatter: (locationId: string) => Promise<string>,
): Promise<string> {
  const { data: occupation } = await supabaseAdmin
    .from('companion_occupations')
    .select('location_id')
    .eq('character_id', characterId)
    .maybeSingle();

  if (!occupation?.location_id) return '';
  return formatter(occupation.location_id);
}

/**
 * Resolves a character's primary (first-listed) active organization via
 * getCharacterOrganizationIds() — same source formatOrganizationForPrompt()
 * already reads — then calls an organization-keyed formatter. A character
 * can belong to several organizations; leadership is intentionally scoped
 * to just the first one rather than fanning out to all of them, since this
 * is meant as light ambient context ("who's in charge where I belong"),
 * not a full leadership roster. Returns '' if the character belongs to no
 * active organization, matching the other formatters' silent-omit behavior.
 */
async function withCharacterOrganization(
  characterId: string,
  formatter: (organizationId: string) => Promise<string>,
): Promise<string> {
  const orgIds = await getCharacterOrganizationIds(characterId);
  if (!orgIds.length) return '';
  return formatter(orgIds[0]!);
}

export async function assembleUniverseContext(
  characterId: string,
  options: UniverseContextOptions = {},
): Promise<string> {
  const {
    includeLocation    = true,
    includeSocialGraph = true,
    includeEvents      = true,
    includeStories     = true,
    includeLife        = true,
    includeReputation  = true,
    includeGovernance  = true,
    includeEconomy     = true,
    includeEmployment  = true,
    includeHousing     = true,
    includeTaxation    = true,
    includeJob         = true,
    includeCompany     = true,
    includeStatus      = true,
    includeAttributes  = true,
    includeAssets       = true,
    includeTitles       = true,
    includeDesire       = true,
    includeWorldImpact  = true,
    includePublicPerception = true,
    includeOrganization = true,
    includeMessages     = true,
    includeWeather      = true,
    includeSeason       = true,
    includeAging        = true,
    includeCommunity    = true,
    includeCrime        = true,
    includeCulture      = true,
    includeInflation    = true,
    includeMarket       = true,
    includeReligion     = true,
    includeScience      = true,
    includeLeadership   = true,
    includeBanking      = true,
    includeSocialCirclePerception = true,
    userId,
  } = options;

  try {
    const [
      locationCtx, socialCtx, eventsCtx, storiesCtx, lifeCtx, repCtx,
      govCtx, econCtx, employmentCtx, housingCtx, taxationCtx, jobCtx, companyCtx, statusCtx, attrCtx, assetCtx,
      titlesCtx, desireCtx, impactCtx, perceptionCtx, orgCtx, messagesCtx, weatherCtx, seasonCtx,
      agingCtx, communityCtx, crimeCtx, cultureCtx, inflationCtx, marketCtx, religionCtx, scienceCtx, leadershipCtx,
      bankingCtx, socialCirclePerceptionCtx,
    ] = await Promise.all([
      includeLocation    ? buildUniversePromptContext(characterId)  : Promise.resolve(''),
      includeSocialGraph ? cachedPromptFormat(`vantrix:prompt:social:${characterId}`,  () => formatSocialGraphForPrompt(characterId))  : Promise.resolve(''),
      includeEvents      ? cachedPromptFormat(`vantrix:prompt:events:${characterId}`,  () => formatActiveEventsForPrompt(characterId)) : Promise.resolve(''),
      includeStories     ? cachedPromptFormat(`vantrix:prompt:stories:${characterId}`, () => formatActiveStoriesForPrompt(characterId)): Promise.resolve(''),
      includeLife        ? cachedPromptFormat(`vantrix:prompt:life:${characterId}`,    () => formatLifeContextForPrompt(characterId))  : Promise.resolve(''),
      includeReputation  ? cachedPromptFormat(`vantrix:prompt:rep:${characterId}`,     () => formatReputationForPrompt(characterId))   : Promise.resolve(''),
      includeGovernance  ? cachedPromptFormat(`vantrix:prompt:gov:${characterId}`,     () => formatGovernanceForPrompt(characterId))   : Promise.resolve(''),
      includeEconomy     ? cachedPromptFormat(`vantrix:prompt:econ:${characterId}`,    () => formatEconomyForPrompt(characterId))      : Promise.resolve(''),
      // employment/taxation are keyed by location_id, not characterId directly —
      // resolveCharacterLocationId() mirrors the occupation lookup formatEconomyForPrompt
      // already does, and returns '' up front (skipping the format call) if unresolved.
      includeEmployment  ? cachedPromptFormat(`vantrix:prompt:employ:${characterId}`,  () => withCharacterLocation(characterId, formatEmploymentForPrompt)) : Promise.resolve(''),
      includeHousing     ? cachedPromptFormat(`vantrix:prompt:housing:${characterId}`, () => formatHousingForPrompt(characterId))      : Promise.resolve(''),
      includeTaxation    ? cachedPromptFormat(`vantrix:prompt:tax:${characterId}`,     () => withCharacterLocation(characterId, formatTaxationForPrompt)) : Promise.resolve(''),
      includeJob         ? cachedPromptFormat(`vantrix:prompt:job:${characterId}`,     () => formatJobForPrompt(characterId))          : Promise.resolve(''),
      includeCompany     ? cachedPromptFormat(`vantrix:prompt:company:${characterId}`, () => formatCompanyForPrompt(characterId))      : Promise.resolve(''),
      includeStatus      ? cachedPromptFormat(`vantrix:prompt:status:${characterId}`,  () => formatStatusForPrompt(characterId))       : Promise.resolve(''),
      includeAttributes  ? cachedPromptFormat(`vantrix:prompt:attr:${characterId}`,    () => formatAttributesForPrompt(characterId))   : Promise.resolve(''),
      includeAssets      ? cachedPromptFormat(`vantrix:prompt:assets:${characterId}`,  () => formatAssetsForPrompt(characterId))       : Promise.resolve(''),
      includeTitles      ? cachedPromptFormat(`vantrix:prompt:titles:${characterId}`,  () => formatTitlesForPrompt(characterId))       : Promise.resolve(''),
      // Desire/world-impact are per-relationship — skip silently without userId rather than erroring.
      (includeDesire && userId)      ? formatDesireForPrompt(characterId, userId)                          : Promise.resolve(''),
      (includeWorldImpact && userId) ? formatWorldImpactForPrompt(characterId, userId)                     : Promise.resolve(''),
      includePublicPerception ? cachedPromptFormat(`vantrix:prompt:perception:${characterId}`, () => formatPublicPerceptionForPrompt(characterId)) : Promise.resolve(''),
      // Not cached: reads live org cohesion/collective-memory, which change
      // on their own tick cadence (organization_tick) rather than per-turn,
      // so caching would risk showing a stale cohesion/memory read anyway —
      // skip the extra Redis round-trip and just hit Supabase directly.
      includeOrganization ? formatOrganizationForPrompt(characterId).catch(() => '')  : Promise.resolve(''),
      // Messages are per-character private inbox state, not cached for the
      // same reason recordSelfModelEvent-style per-turn state never is —
      // a stale cached inbox could show a message as unread/new twice.
      includeMessages     ? formatMessagesForPrompt(characterId).catch(() => '')       : Promise.resolve(''),
      // Weather is location-keyed, same withCharacterLocation lookup as
      // employment/taxation above — resolves '' up front if the character
      // has no resolvable occupation/location yet.
      includeWeather ? cachedPromptFormat(`vantrix:prompt:weather:${characterId}`, () => withCharacterLocation(characterId, formatWeatherForPrompt)) : Promise.resolve(''),
      // Season is global (keyed off universe_state, not per-character), so
      // it's cached under a fixed key rather than per-character — every
      // character reads the same seasonal narration on a given tick.
      includeSeason  ? cachedPromptFormat('vantrix:prompt:season:global', () => formatSeasonEffectsForPrompt()) : Promise.resolve(''),
      // Aging is character-specific (birthday-window lookup) — same shape/
      // cost tier as housing.
      includeAging ? cachedPromptFormat(`vantrix:prompt:aging:${characterId}`, () => formatAgingContextForPrompt(characterId)) : Promise.resolve(''),
      // Community (neighborhood + community-org + club ties) is character-
      // specific, three small selects on cache miss.
      includeCommunity ? cachedPromptFormat(`vantrix:prompt:community:${characterId}`, () => formatCommunityForPrompt(characterId)) : Promise.resolve(''),
      // Crime/culture/inflation/market/religion are all location-keyed —
      // same withCharacterLocation lookup as weather/employment/taxation.
      includeCrime    ? cachedPromptFormat(`vantrix:prompt:crime:${characterId}`,    () => withCharacterLocation(characterId, formatCrimeForPrompt))    : Promise.resolve(''),
      includeCulture  ? cachedPromptFormat(`vantrix:prompt:culture:${characterId}`,  () => withCharacterLocation(characterId, formatCultureForPrompt))  : Promise.resolve(''),
      includeInflation? cachedPromptFormat(`vantrix:prompt:inflation:${characterId}`,() => withCharacterLocation(characterId, formatInflationForPrompt)): Promise.resolve(''),
      includeMarket   ? cachedPromptFormat(`vantrix:prompt:market:${characterId}`,   () => withCharacterLocation(characterId, formatMarketForPrompt))   : Promise.resolve(''),
      includeReligion ? cachedPromptFormat(`vantrix:prompt:religion:${characterId}`, () => withCharacterLocation(characterId, formatReligionForPrompt)) : Promise.resolve(''),
      // Science is global (no locationId/characterId param at all) — same
      // fixed-key caching as season.
      includeScience ? cachedPromptFormat('vantrix:prompt:science:global', () => formatScienceForPrompt()) : Promise.resolve(''),
      // Leadership is organization-keyed — resolved via the character's
      // primary active organization (see withCharacterOrganization above).
      includeLeadership ? cachedPromptFormat(`vantrix:prompt:leadership:${characterId}`, () => withCharacterOrganization(characterId, formatLeadershipForPrompt)) : Promise.resolve(''),
      // Banking — now a pure read (see peekAccount() in banking-engine.ts;
      // formatBankingForPrompt was changed to use it instead of the
      // account-creating getOrOpenAccount()), so this is safe to wire on
      // the hot prompt path with no side effects.
      includeBanking ? cachedPromptFormat(`vantrix:prompt:banking:${characterId}`, () => formatBankingForPrompt(characterId)) : Promise.resolve(''),
      // Social-circle perception — the "who's being discussed" signal
      // formatThirdPartyPerceptionForPrompt() needed is sourced from this
      // character's own social graph (top 3 links by strength) rather than
      // guessed; see formatSocialCirclePerceptionForPrompt() in
      // reputation-engine.ts.
      includeSocialCirclePerception ? cachedPromptFormat(`vantrix:prompt:socialperc:${characterId}`, () => formatSocialCirclePerceptionForPrompt(characterId)) : Promise.resolve(''),
    ]);

    const sections = [
      locationCtx, statusCtx, titlesCtx, jobCtx, companyCtx, orgCtx, leadershipCtx, attrCtx, socialCtx, communityCtx, lifeCtx,
      govCtx, econCtx, employmentCtx, housingCtx, taxationCtx, bankingCtx, inflationCtx, marketCtx, eventsCtx, storiesCtx, crimeCtx, cultureCtx, religionCtx, scienceCtx,
      repCtx, perceptionCtx, socialCirclePerceptionCtx, assetCtx, agingCtx,
      desireCtx, impactCtx, messagesCtx, weatherCtx, seasonCtx,
    ].filter(Boolean);

    if (!sections.length) return '';

    return [
      '\n\n── LIVING UNIVERSE ─────────────────────────────────────────────────',
      sections.join('\n\n'),
      '─────────────────────────────────────────────────────────────────────\n',
    ].join('\n');

  } catch (err) {
    logger.error('universe-prompt:assemble:error', { characterId, error: String(err) });
    return '';
  }
}

export async function assembleUniverseContextLite(characterId: string): Promise<string> {
  return assembleUniverseContext(characterId, {
    includeLocation:    true,
    includeSocialGraph: true,
    includeEvents:      false,
    includeStories:     false,
    includeLife:        true,
    includeReputation:  false,
    includeGovernance:  false,
    includeEconomy:     false,
    includeEmployment:  false,
    includeHousing:     true,  // housing is character-specific and cheap (single-table lookup) — keep in lite
    includeTaxation:    false,
    includeJob:         true,
    includeCompany:     true,
    includeStatus:      true,
    includeAttributes:  true,
    includeAssets:        false,
    includeOrganization:  false,
    includeMessages:      false,
    includeWeather:       true,  // cheap (single location-keyed lookup, same tier as housing) and high ambiance value
    includeSeason:        true,  // global, cached under one key — effectively free
    includeAging:         true,  // cheap character-keyed lookup, high value ("does the character know it's their birthday")
    includeCommunity:     false, // 3 selects on cache miss — matches the lite tier's general "skip multi-table joins" pattern
    includeCrime:         false, // matches includeEvents/includeStories being off in lite
    includeCulture:       false,
    includeInflation:     false, // matches includeEconomy being off in lite
    includeMarket:        false,
    includeReligion:      false,
    includeScience:       false, // global flavor text — nice-to-have, not lite-tier essential
    includeLeadership:    true,  // cheap (single leader lookup), same tier as includeCompany/includeStatus already on in lite
    includeBanking:       true,  // now a pure single-row read, same cost tier as includeHousing which is already on in lite
    includeSocialCirclePerception: false, // up to 3 fan-out reads — matches lite's "skip multi-table joins" pattern (same reasoning as includeCommunity)
  });
}

export const UNIVERSE_PROMPT_INTEGRATION_NOTE = `
This is a drop-in replacement. Overwrite universe-prompt.ts directly —
no changes needed in src/lib/ai/prompt.ts if already integrated.

New context in this version: social status tier, legend declaration (if any),
character condition (health/confidence/wealth/skills/addictions), held
scarce assets (artifacts/titles/offices), and founded/employer company
context (founding, headcount, market share, competitive standing — see
company-engine.ts).

Also newly wired — a full sweep found 11 more "tick writes real data, read
side has zero callers" formatters across the universe/ engines, all fixed
the same way (withCharacterLocation / withCharacterOrganization / fixed
global cache key, matching the existing pattern exactly):
  - weather-engine.ts        formatWeatherForPrompt          (location)
  - season-engine.ts         formatSeasonEffectsForPrompt    (global)
  - aging-engine.ts          formatAgingContextForPrompt     (character)
  - community-engine.ts      formatCommunityForPrompt        (character)
  - crime-engine.ts          formatCrimeForPrompt            (location)
  - culture-engine.ts        formatCultureForPrompt          (location)
  - inflation-engine.ts      formatInflationForPrompt        (location)
  - market-engine.ts         formatMarketForPrompt           (location)
  - religion-engine.ts       formatReligionForPrompt         (location)
  - science-engine.ts        formatScienceForPrompt          (global)
  - leadership-engine.ts     formatLeadershipForPrompt       (organization,
    via the character's primary active org — see withCharacterOrganization)

Two more dead formatters needed a product decision before wiring, not just
wiring — same reasoning as planner.ts/prediction-engine.ts in the audit
log. Both have since been resolved and are now wired in:
  - banking-engine.ts formatBankingForPrompt(characterId) — its data source,
    getOrOpenAccount(), silently INSERTed a new bank_accounts row on first
    read. Fixed by adding peekAccount() — a pure-read variant (SELECT only,
    never INSERTs) — and switching formatBankingForPrompt() to use it. A
    character with no account yet has no financial signal worth mentioning
    (equivalent to a freshly-opened account at balance 0, which already
    returned '' anyway), so behavior is unchanged for every character that
    already has an account; the only change is that prompt assembly no
    longer creates one as a side effect for characters who don't.
  - reputation-engine.ts formatThirdPartyPerceptionForPrompt(characterId,
    characterName) — by design this formats a DIFFERENT character's public
    reputation ("Word around the city: {name} is known as..."), and needed
    a "who's being discussed" signal to call it with. Resolved by adding
    formatSocialCirclePerceptionForPrompt() (also in reputation-engine.ts),
    which sources that signal from the character's own social graph
    (social-graph.ts's getSocialLinks(), top 3 by relationship strength)
    rather than guessing — surfaces what's known about the character's own
    friends/rivals/allies, capped so it stays a handful of small reads.
`;
