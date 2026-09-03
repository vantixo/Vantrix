/**
 * Society Engine — Companion Life Cycle
 *
 * "Every AI in the world works, sleeps, travels, socialises, learns,
 * competes, and forms relationships — whether or not anyone is watching."
 *
 * This is the single orchestrator for a character's day. Each tick it
 * picks ONE weighted activity per active character (matching the existing
 * one-entry-per-tick cadence from life-engine.ts) and dispatches to a
 * per-activity handler. Handlers write flavor to companion_offline_log
 * (read generically by life-engine.ts's formatLifeContextForPrompt — no
 * prompt-assembly changes needed) and, where it's cheap and meaningful,
 * make a small real state change by delegating to the engine that already
 * owns that state:
 *
 *   works        → occupation-flavored narrative (kept local; fixes the
 *                  she/her-only pronoun bug present in life-engine's
 *                  pickDailyActivity by resolving from characters.gender)
 *   sleeps        → time-of-day weighted only, occasional small health regen
 *                  via character-evolution.applyHealthChange
 *   travels       → narrative location_change referencing a real, different
 *                  world_locations row. Deliberately does NOT mutate
 *                  companion_occupations.location_id — that column is a
 *                  character's home/work base, owned by companion-jobs.ts,
 *                  and permanently relocating it on a flavor tick would
 *                  silently break governance/economy context for that
 *                  character. Travel here is "away for the day," not
 *                  "moved."
 *   socializes    → strengthens an existing social-graph link via
 *                  social-graph.upsertSocialLink, or logs a general night
 *                  out if the character has none yet
 *   learns        → character-evolution.gainSkill against a small skill
 *                  pool (kept local; character-evolution's own SKILL_POOL
 *                  isn't exported)
 *   competes      → narrative rivalry/contest beat; nudges fame or
 *                  notoriety via reputation.applyFameEvent and can spawn a
 *                  'rival' social-graph link
 *   forms         → creates a brand-new social-graph link to another
 *   relationships   active character with no existing link, weighted
 *                  toward characters sharing a location
 *
 * Supersedes life-engine.ts's tickCompanionLives() in the job dispatch
 * (see api/workers/run/route.ts) — that function and its exports
 * (logOfflineEntry, formatLifeContextForPrompt) remain in place and are
 * used here, since other engines still depend on them.
 */

import { supabaseAdmin }        from '@/lib/supabase/admin';
import { logger }               from '@/lib/logger';
import { logOfflineEntry }      from './life-engine';
import { getSocialLinks, upsertSocialLink } from './social-graph';
import { gainSkill }            from './character-evolution';
import { applyFameEvent }       from './reputation';
import { tryFoundGroup, trySpreadRumor, tryOrganizeEvent } from './character-social-engine';
import type { SocialLinkType }  from '@/types/world-expansion';

const BATCH_LIMIT = 200;

type SocietyActivity = 'sleep' | 'work' | 'travel' | 'socialize' | 'learn' | 'compete' | 'relationship' | 'group' | 'rumor' | 'event';

const SKILL_POOL = ['negotiation', 'combat', 'rhetoric', 'research', 'craftsmanship', 'leadership', 'deception', 'empathy', 'strategy', 'endurance', 'a second language', 'sleight of hand'];

interface SocietyCharacter {
  id:         string;
  name:       string;
  gender:     string | null;
  occupation: string | null;
  location:   { id: string; name: string } | null;
}

// ── Public: Tick ─────────────────────────────────────────────────────────────

/**
 * Run the daily society tick for all active characters.
 * Called by the world worker on 'companion_life' jobs.
 */
export async function tickSociety(): Promise<{ processed: number; logged: number; byActivity: Record<SocietyActivity, number> }> {
  const byActivity: Record<SocietyActivity, number> = {
    sleep: 0, work: 0, travel: 0, socialize: 0, learn: 0, compete: 0, relationship: 0, group: 0, rumor: 0, event: 0,
  };

  const { data: characters, error } = await supabaseAdmin
    .from('characters')
    .select(`
      id, name, gender, occupation,
      location:companion_occupations(location:world_locations(id, name))
    `)
    .eq('active', true)
    .limit(BATCH_LIMIT);

  if (error || !characters) {
    logger.warn('society-engine:tick:fetch-failed', { error });
    return { processed: 0, logged: 0, byActivity };
  }

  type EmbedOne<T> = T | T[] | null | undefined;
  function firstOf<T>(v: EmbedOne<T>): T | null {
    if (v == null) return null;
    return Array.isArray(v) ? (v[0] ?? null) : v;
  }

  type CompanionOccupationLocation = { location: EmbedOne<{ id: string; name: string }> };
  type SocietyCharacterRow = {
    id: string;
    name: string;
    gender: string | null;
    occupation: string | null;
    location: EmbedOne<CompanionOccupationLocation>;
  };

  const roster: SocietyCharacter[] = (characters as SocietyCharacterRow[]).map((c) => {
    const occJoin = firstOf(c.location); // Supabase nested-select shape isn't guaranteed array vs object
    const locJoin = firstOf(occJoin?.location);
    return {
      id:         c.id,
      name:       c.name,
      gender:     c.gender ?? null,
      occupation: c.occupation ?? null,
      location:   locJoin,
    };
  });

  // Preload world locations once for travel (avoid N queries).
  const { data: allLocations } = await supabaseAdmin.from('world_locations').select('id, name').limit(50);
  const locationPool = allLocations ?? [];

  const hour = new Date().getUTCHours(); // no per-character timezone in schema; global clock
  let logged = 0;

  await Promise.allSettled(
    roster.map(async (char) => {
      try {
        const activity = pickActivity(hour);
        await dispatch(activity, char, roster, locationPool);
        byActivity[activity]++;
        logged++;
      } catch (err) {
        logger.warn('society-engine:tick:character-failed', { characterId: char.id, error: err instanceof Error ? err.message : String(err) });
      }
    }),
  );

  logger.info('society-engine:tick:complete', { processed: roster.length, logged, byActivity });
  return { processed: roster.length, logged, byActivity };
}

// ── Internal: Activity Selection ────────────────────────────────────────────

/**
 * Weighted pick, time-of-day aware. Sleep dominates late night / early
 * morning (UTC); the rest hold roughly steady proportions the other hours.
 * Weights are relative, not percentages — pick() normalizes.
 */
function pickActivity(hour: number): SocietyActivity {
  const isNight = hour >= 23 || hour < 6;

  const weights: Record<SocietyActivity, number> = isNight
    ? { sleep: 65, work: 5,  travel: 4,  socialize: 10, learn: 5,  compete: 3,  relationship: 8, group: 1, rumor: 2, event: 1 }
    : { sleep: 5,  work: 35, travel: 12, socialize: 20, learn: 12, compete: 8,  relationship: 8, group: 2, rumor: 4, event: 3 };

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;

  for (const [activity, weight] of Object.entries(weights) as [SocietyActivity, number][]) {
    roll -= weight;
    if (roll <= 0) return activity;
  }
  return 'work'; // unreachable in practice; satisfies the type checker
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** he/him, she/her, or they/them — resolved from characters.gender, defaulting to they/them. */
function pronouns(gender: string | null): { subj: string; poss: string } {
  if (gender === 'female') return { subj: 'she', poss: 'her' };
  if (gender === 'male')   return { subj: 'he',  poss: 'his' };
  return { subj: 'they', poss: 'their' };
}

// ── Internal: Dispatch ───────────────────────────────────────────────────────

async function dispatch(
  activity:     SocietyActivity,
  char:         SocietyCharacter,
  roster:       SocietyCharacter[],
  locationPool: { id: string; name: string }[],
): Promise<void> {
  switch (activity) {
    case 'sleep':      return handleSleep(char);
    case 'work':        return handleWork(char);
    case 'travel':       return handleTravel(char, locationPool);
    case 'socialize':     return handleSocialize(char, roster);
    case 'learn':           return handleLearn(char);
    case 'compete':           return handleCompete(char, roster);
    case 'relationship':        return handleRelationship(char, roster);
    case 'group':                 return handleGroup(char);
    case 'rumor':                  return handleRumor(char);
    case 'event':                   return handleEvent(char);
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleSleep(char: SocietyCharacter): Promise<void> {
  const { subj } = pronouns(char.gender);
  const line = pick([
    `${char.name} turned in early. ${cap(subj)} needed it.`,
    `${char.name} couldn't sleep for a while, then finally did.`,
    `${char.name} slept through ${subj === 'they' ? 'their' : subj === 'she' ? 'her' : 'his'} alarm and didn't seem to mind.`,
    `${char.name} had a strange dream ${subj} probably won't remember by noon.`,
  ]);
  await logOfflineEntry(char.id, 'activity', line, { activity: 'sleep' });

  // Rest occasionally nudges health back up — small and rare, not a lever to grind.
  if (Math.random() < 0.08) {
    const { applyHealthChange } = await import('./character-evolution');
    await applyHealthChange(char.id, 2);
  }
}

async function handleWork(char: SocietyCharacter): Promise<void> {
  const { subj, poss } = pronouns(char.gender);
  const occ = (char.occupation ?? 'freelancer').toLowerCase();
  const where = char.location ? ` at ${char.location.name}` : '';

  const bucket: string[] =
    occ.includes('doctor') || occ.includes('medic') || occ.includes('nurse') ? [
      `${char.name} worked a long shift${where}. A case ${subj}'ll be thinking about for days.`,
      `${char.name} covered for a colleague and stayed hours past the end of ${poss} shift.`,
    ] :
    occ.includes('lawyer') || occ.includes('counsel') || occ.includes('legal') ? [
      `${char.name} spent the afternoon in depositions${where}. Poker face intact.`,
      `${char.name} filed the brief ${subj}'d been building for weeks. Now ${subj} waits.`,
    ] :
    occ.includes('artist') || occ.includes('paint') || occ.includes('sculpt') ? [
      `${char.name} scrapped two weeks of work and started over. ${cap(subj)} feels better for it.`,
      `${char.name} sold a piece today${where}. The buyer cried.`,
    ] :
    occ.includes('chef') || occ.includes('cook') || occ.includes('baker') ? [
      `${char.name} tested a new dish on the kitchen staff${where}. Mixed reviews.`,
      `${char.name} ran service short-staffed and it went better than it should have.`,
    ] :
    occ.includes('engineer') || occ.includes('architect') || occ.includes('builder') ? [
      `${char.name} found a flaw in the design at hour eleven${where}. Fixed it at hour fourteen.`,
      `${char.name} presented to the client. The silence after was the good kind.`,
    ] :
    occ.includes('teacher') || occ.includes('professor') || occ.includes('instructor') ? [
      `${char.name} stayed after class with a student who finally asked the right question.`,
      `${char.name} graded until midnight. Most of it was better than expected.`,
    ] :
    occ.includes('researcher') || occ.includes('scientist') || occ.includes('analyst') ? [
      `${char.name} found a result that contradicted months of assumptions${where}. Excited, not discouraged.`,
      `${char.name} presented preliminary findings. The room was more interested than expected.`,
    ] : [
      `${char.name} had one of those days where the work felt like it was going somewhere${where}.`,
      `${char.name} finished something ${subj}'d been putting off. Feels different than expected.`,
    ];

  await logOfflineEntry(char.id, 'activity', pick(bucket), { activity: 'work' });
}

async function handleTravel(char: SocietyCharacter, locationPool: { id: string; name: string }[]): Promise<void> {
  const candidates = locationPool.filter((l) => l.id !== char.location?.id);
  if (candidates.length === 0) return;

  const dest = pick(candidates);
  const line = char.location
    ? `${char.name} left ${char.location.name} for ${dest.name} — no fixed date back.`
    : `${char.name} turned up in ${dest.name}, as ${char.name} does.`;

  await logOfflineEntry(char.id, 'location_change', line, { activity: 'travel', destination_id: dest.id, temporary: true });
}

async function handleSocialize(char: SocietyCharacter, roster: SocietyCharacter[]): Promise<void> {
  const links = await getSocialLinks(char.id);

  if (links.length > 0) {
    const link = pick(links);
    const name = link.linked_character?.name ?? 'someone';
    await logOfflineEntry(char.id, 'social', `${char.name} spent the evening with ${name}.`, { activity: 'socialize', linked_character_id: link.linked_character_id });
    await upsertSocialLink(char.id, link.linked_character_id, link.link_type, Math.min(100, link.strength + 2), link.is_mutual);
    return;
  }

  // No existing links yet — generic socializing, no state change.
  await logOfflineEntry(char.id, 'social', `${char.name} went out and talked to strangers longer than planned.`, { activity: 'socialize' });
  void roster; // reserved: candidate pool for future "met someone new while out" branch
}

async function handleLearn(char: SocietyCharacter): Promise<void> {
  const skill = pick(SKILL_POOL);
  await gainSkill(char.id, skill, 1 + Math.floor(Math.random() * 3));
  // gainSkill itself logs a milestone entry only when crossing the 50 threshold;
  // log a lightweight daily entry here so "learns" always shows up in the feed.
  await logOfflineEntry(char.id, 'activity', `${char.name} put in the hours practicing ${skill}.`, { activity: 'learn', skill });
}

async function handleCompete(char: SocietyCharacter, roster: SocietyCharacter[]): Promise<void> {
  const rivalLinks = (await getSocialLinks(char.id)).filter((l) => l.link_type === 'rival');
  const opponent = rivalLinks.length > 0
    ? rivalLinks[0]!.linked_character?.name ?? 'a rival'
    : pick(roster.filter((r) => r.id !== char.id))?.name;

  if (!opponent) return;

  const won = Math.random() < 0.5;
  const line = won
    ? `${char.name} came out ahead of ${opponent} today. Won't say ${char.gender === 'female' ? 'she' : char.gender === 'male' ? 'he' : 'they'} was keeping score, but ${char.gender === 'female' ? 'she' : char.gender === 'male' ? 'he' : 'they'} was.`
    : `${char.name} lost ground to ${opponent} today. Taking it better than expected.`;

  await logOfflineEntry(char.id, 'activity', line, { activity: 'compete', opponent, won });
  await applyFameEvent(char.id, won ? 3 : -1);

  // A repeated competitor becomes a real rival link if one doesn't exist yet.
  if (rivalLinks.length === 0 && Math.random() < 0.2) {
    const rival = roster.find((r) => r.name === opponent);
    if (rival) await upsertSocialLink(char.id, rival.id, 'rival' as SocialLinkType, 30);
  }
}

async function handleRelationship(char: SocietyCharacter, roster: SocietyCharacter[]): Promise<void> {
  const existing = await getSocialLinks(char.id);
  const existingIds = new Set(existing.map((l) => l.linked_character_id));

  // Prefer someone at the same location; fall back to anyone unlinked.
  const sameLocation = roster.filter((r) => r.id !== char.id && !existingIds.has(r.id) && r.location?.id && r.location.id === char.location?.id);
  const anyone = roster.filter((r) => r.id !== char.id && !existingIds.has(r.id));
  const candidate = pick(sameLocation.length > 0 ? sameLocation : anyone);

  if (!candidate) return;

  const linkType = pick<SocialLinkType>(['friend', 'friend', 'friend', 'ally', 'mentor', 'rival']);
  const verb: Record<SocialLinkType, string> = {
    friend: 'hit it off with', ally: 'formed an alliance with', mentor: 'started mentoring',
    'protégé': 'started learning from', rival: 'clashed with and can\'t stop thinking about',
    enemy: 'made an enemy of', lover: 'grew close to', family: 'discovered a tie to',
  };

  await logOfflineEntry(char.id, 'relationship_change', `${char.name} ${verb[linkType]} ${candidate.name}.`, { activity: 'relationship', linked_character_id: candidate.id, link_type: linkType });
  await upsertSocialLink(char.id, candidate.id, linkType, 20, true);
  await upsertSocialLink(candidate.id, char.id, linkType, 20, true);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// group/rumor/event delegate entirely to character-social-engine.ts, which
// owns the actual mechanics (org founding, rumor propagation, event
// attendance). Each is a graceful no-op when the character doesn't meet
// that action's prerequisites (e.g. no group without an existing friend
// circle) — same silent-skip convention as handleRelationship/handleCompete
// above when there's no viable candidate.

async function handleGroup(char: SocietyCharacter): Promise<void> {
  await tryFoundGroup(char);
}

async function handleRumor(char: SocietyCharacter): Promise<void> {
  await trySpreadRumor(char);
}

async function handleEvent(char: SocietyCharacter): Promise<void> {
  await tryOrganizeEvent(char);
}
