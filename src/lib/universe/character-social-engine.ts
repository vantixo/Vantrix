/**
 * Character Social Engine — Groups, Rumors, Events
 *
 * society-engine.ts already drives friendship formation ('socializes' /
 * 'relationship' beats) and rivalry formation ('competes' beat) as part of
 * its per-character daily activity pick — those two items from the brief
 * were already live. This engine covers the three that weren't:
 *
 *   - START GROUPS: organization-engine.ts's foundOrganization() existed
 *     and worked, but nothing ever called it — runOrganizationTick() only
 *     maintains orgs that already exist (cohesion drift, dissolution).
 *     tryFoundGroup() is the missing "characters spontaneously decide to
 *     start something" half.
 *   - SPREAD RUMORS: agent-communication.ts's propagateRumor() existed
 *     with zero callers anywhere in the codebase — fully dead. 
 *     trySpreadRumor() originates rumors from real, recent world state
 *     (world_events/political_events) and is the first thing that ever
 *     calls it.
 *   - ORGANIZE EVENTS: didn't exist at all. tryOrganizeEvent() is new —
 *     an organizer character invites a handful of their social links,
 *     narrates it to every attendee's companion_offline_log, and (for
 *     well-attended events) writes a 'social_event' world_event so it's
 *     visible in ambient prompt context the way any other local happening
 *     is.
 *
 * Wired into society-engine.ts as three additional weighted daily
 * activities ('group', 'rumor', 'event') rather than run as its own tick —
 * these are character-initiated actions, so they belong on the same
 * one-activity-per-character-per-day cadence as socialize/compete/etc.,
 * not a separate global sweep.
 */

import { supabaseAdmin }      from '@/lib/supabase/admin';
import { logger }             from '@/lib/logger';
import { getSocialLinks }     from './social-graph';
import { foundOrganization, getCharacterOrganizationIds, type OrgType } from './organization-engine';
import { propagateRumor }     from './agent-communication';
import { logOfflineEntry }    from './life-engine';
import { recordMemory }       from './collective-memory';

export interface SocialCharacter {
  id:         string;
  name:       string;
  occupation: string | null;
  location:   { id: string; name: string } | null;
}

const GROUP_MIN_FRIEND_LINKS   = 3;
const EVENT_MIN_INVITEES       = 2;
const EVENT_NOTABLE_THRESHOLD  = 4; // attendee count that makes an event world-visible, not just personal log

// ── Public: Start a Group ───────────────────────────────────────────────────

/**
 * A character with enough of an existing friend circle and no group of
 * their own yet may found one. Org type and purpose are drawn from
 * whatever the founder and their friends have in common (shared
 * occupation first, shared location otherwise) so the group reads as
 * "these people, for this reason" rather than a random label.
 */
export async function tryFoundGroup(char: SocialCharacter): Promise<{ founded: boolean; organizationId?: string }> {
  const existingOrgs = await getCharacterOrganizationIds(char.id);
  if (existingOrgs.length > 0) {
    return { founded: false }; // already belongs to something; not every character needs to be a founder
  }

  const links = await getSocialLinks(char.id);
  const friends = links.filter((l) => l.link_type === 'friend' || l.link_type === 'ally');
  if (friends.length < GROUP_MIN_FRIEND_LINKS) {
    return { founded: false };
  }

  const friendIds = friends.map((f) => f.linked_character_id);
  const { data: friendRows } = await supabaseAdmin
    .from('characters')
    .select('id, occupation')
    .in('id', friendIds);

  const occupationCounts = new Map<string, number>();
  for (const f of friendRows ?? []) {
    if (!f.occupation) continue;
    occupationCounts.set(f.occupation, (occupationCounts.get(f.occupation) ?? 0) + 1);
  }
  const sharedOccupation = [...occupationCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const basis = sharedOccupation && sharedOccupation === char.occupation ? sharedOccupation : null;

  const { orgType, purpose, name } = pickGroupConcept(char, basis);

  const org = await foundOrganization({
    name,
    orgType,
    founderId:  char.id,
    locationId: char.location?.id,
    purpose,
  });

  if (!org) return { founded: false };

  await logOfflineEntry(char.id, 'activity', `${char.name} founded ${name}${char.location ? ` in ${char.location.name}` : ''}. ${friends.length} friends were the first to hear about it.`, {
    activity: 'found_group', organization_id: org.id,
  });

  logger.info('character-social-engine:group-founded', { characterId: char.id, organizationId: org.id, name });
  return { founded: true, organizationId: org.id };
}

function pickGroupConcept(char: SocialCharacter, sharedOccupation: string | null): { orgType: OrgType; purpose: string; name: string } {
  if (sharedOccupation) {
    return {
      orgType: 'guild',
      purpose: `A guild for people working as ${sharedOccupation.toLowerCase()}, started by ${char.name}.`,
      name:    `${capitalize(sharedOccupation)}s' Circle`,
    };
  }
  const fallback = pick([
    { orgType: 'circle' as OrgType, purpose: `A standing gathering ${char.name} started for friends to keep in touch.`, name: `${char.name}'s Circle` },
    { orgType: 'council' as OrgType, purpose: `A small council ${char.name} pulled together to look out for shared interests locally.`, name: `${char.location?.name ?? 'Local'} Council` },
    { orgType: 'order' as OrgType, purpose: `An order ${char.name} founded around a cause they wouldn't stop talking about.`, name: `Order of ${char.name}` },
  ]);
  return fallback;
}

// ── Public: Spread a Rumor ──────────────────────────────────────────────────

/**
 * Character originates a rumor about something real that recently
 * happened nearby, and it propagates outward through their social graph
 * via agent-communication.ts's propagateRumor(). A rumor that reaches
 * enough people is recorded as a location-scoped collective memory, since
 * a widely-relayed rumor is exactly the kind of thing that should
 * crystallize into "what people remember" rather than just a message log.
 */
export async function trySpreadRumor(char: SocialCharacter): Promise<{ spread: boolean; hops?: number }> {
  const links = await getSocialLinks(char.id);
  if (links.length === 0) return { spread: false };

  const seed = await pickRumorSeed(char.location?.id ?? null);
  if (!seed) return { spread: false };

  const rumorLine = phraseAsRumor(seed);
  const hops = await propagateRumor(char.id, rumorLine, seed.topic, 2);

  if (hops === 0) return { spread: false };

  await logOfflineEntry(char.id, 'social', `${char.name} couldn't help mentioning: "${rumorLine}"`, {
    activity: 'spread_rumor', hops,
  });

  if (hops >= EVENT_NOTABLE_THRESHOLD && char.location) {
    await recordMemory({
      scopeType: 'location',
      scopeId:   char.location.id,
      summary:   rumorLine,
      significance: 3,
      sourceCharacterId: char.id,
      tags: ['rumor'],
    });
  }

  logger.info('character-social-engine:rumor-spread', { characterId: char.id, hops });
  return { spread: true, hops };
}

interface RumorSeed { description: string; topic: string }

async function pickRumorSeed(locationId: string | null): Promise<RumorSeed | null> {
  const [worldEventsRes, politicalEventsRes] = await Promise.all([
    supabaseAdmin
      .from('world_events')
      .select('title, description, event_type')
      .eq('is_active', true)
      .order('emotional_weight', { ascending: false })
      .limit(8),
    supabaseAdmin
      .from('political_events')
      .select('title, description, event_type')
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  const pool: RumorSeed[] = [
    ...(worldEventsRes.data ?? []).map((e: { description: string; event_type: string }) => ({ description: e.description, topic: e.event_type })),
    ...(politicalEventsRes.data ?? []).map((e: { description: string; event_type: string }) => ({ description: e.description, topic: e.event_type })),
  ];

  void locationId; // world_events isn't reliably location-tagged across every event_type; rumor content quality matters more than strict locality here
  if (pool.length === 0) return null;
  return pick(pool);
}

function phraseAsRumor(seed: RumorSeed): string {
  const trimmed = seed.description.length > 160 ? `${seed.description.slice(0, 157)}...` : seed.description;
  const hedge = pick(['apparently,', 'so I heard,', 'word is,', 'someone told me,', "don't quote me, but"]);
  return `${hedge} ${lowerFirst(trimmed)}`;
}

// ── Public: Organize an Event ───────────────────────────────────────────────

/**
 * Character organizes a small social gathering, inviting from their
 * existing social links. Every invitee gets a personal offline-log entry;
 * well-attended events also get a 'social_event' world_event so they're
 * visible in general prompt context, not just to the people who went.
 */
export async function tryOrganizeEvent(char: SocialCharacter): Promise<{ organized: boolean; attendees?: number }> {
  const links = await getSocialLinks(char.id);
  if (links.length < EVENT_MIN_INVITEES) return { organized: false };

  const inviteCount = Math.min(links.length, 2 + Math.floor(Math.random() * 4));
  const invitees = shuffle(links).slice(0, inviteCount);

  const concept = pick(EVENT_CONCEPTS);
  const eventTitle = concept.title(char.name, char.location?.name ?? null);

  let attended = 0;
  for (const invitee of invitees) {
    // Not everyone invited shows up — attendance chance scales with link strength.
    const attends = Math.random() < clamp((invitee.strength ?? 50) / 100, 0.3, 0.9);
    if (!attends) continue;
    attended++;

    const { data: inviteeChar } = await supabaseAdmin.from('characters').select('name').eq('id', invitee.linked_character_id).maybeSingle();
    await logOfflineEntry(invitee.linked_character_id, 'social', `${inviteeChar?.name ?? 'They'} went to ${eventTitle}, hosted by ${char.name}.`, {
      activity: 'attended_event', host_id: char.id,
    });
  }

  await logOfflineEntry(char.id, 'activity', `${char.name} organized ${eventTitle}${char.location ? ` in ${char.location.name}` : ''}. ${attended} of ${invitees.length} invited showed up.`, {
    activity: 'organized_event', attendees: attended,
  });

  if (attended >= EVENT_NOTABLE_THRESHOLD) {
    await supabaseAdmin.from('world_events').insert({
      event_type:       'social_event',
      title:            eventTitle,
      description:      concept.description(char.name, attended),
      location_id:      char.location?.id ?? null,
      emotional_weight: 2,
      is_active:        true,
      expires_at:        new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    }).then(({ error }) => {
      if (error) logger.warn('character-social-engine:event-log-failed', { characterId: char.id, error });
    });
  }

  logger.info('character-social-engine:event-organized', { characterId: char.id, attendees: attended, invited: invitees.length });
  return { organized: true, attendees: attended };
}

const EVENT_CONCEPTS: { title: (host: string, locationName: string | null) => string; description: (host: string, attendees: number) => string }[] = [
  {
    title: (host) => `${host}'s Gathering`,
    description: (host, n) => `${host} put together a small get-together, and it turned out bigger than expected — ${n} people came through.`,
  },
  {
    title: (_host, loc) => `A Night Out${loc ? ` in ${loc}` : ''}`,
    description: (host, n) => `${host} organized a night out. ${n} people showed, and by most accounts it went well.`,
  },
  {
    title: (host) => `${host}'s Dinner`,
    description: (host, n) => `${host} hosted a dinner that ran long in the best way — ${n} guests stayed well past dessert.`,
  },
  {
    title: (_host, loc) => `A Local Meetup${loc ? ` in ${loc}` : ''}`,
    description: (host, n) => `A meetup organized by ${host} drew a solid turnout of ${n}, mostly people who'd never all been in the same room before.`,
  },
];

// ── Internal ─────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
