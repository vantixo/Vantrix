/**
 * Social Graph — Companion Relationship Network
 *
 * Characters in Vantrix have relationships with each other that exist
 * independently of user interactions. These social links — alliances,
 * rivalries, mentorships, friendships — surface in prompt context so
 * characters can reference their world naturally.
 *
 * "The city is a network of relationships, not just a list of people."
 */

import { supabaseAdmin }  from '@/lib/supabase/admin';
import { logger }         from '@/lib/logger';
import type { CompanionSocialLink, SocialLinkType } from '@/types/world-expansion';

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getSocialLinks(characterId: string): Promise<CompanionSocialLink[]> {
  const { data, error } = await supabaseAdmin
    .from('companion_social_links')
    .select(`
      *,
      linked_character:characters!companion_social_links_linked_character_id_fkey(
        id, name, image_url
      )
    `)
    .eq('character_id', characterId)
    .order('strength', { ascending: false })
    .limit(10);

  if (error) return [];
  return (data ?? []) as CompanionSocialLink[];
}

export async function getMutualLinks(
  characterIdA: string,
  characterIdB: string,
): Promise<CompanionSocialLink | null> {
  const { data, error } = await supabaseAdmin
    .from('companion_social_links')
    .select('*')
    .eq('character_id', characterIdA)
    .eq('linked_character_id', characterIdB)
    .maybeSingle();

  if (error || !data) return null;
  return data as CompanionSocialLink;
}

// ── Public: Write ──────────────────────────────────────────────────────────────

export async function upsertSocialLink(
  characterId:         string,
  linkedCharacterId:   string,
  linkType:            SocialLinkType,
  strength:            number,
  isMutual:            boolean = false,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('companion_social_links')
    .upsert(
      {
        character_id:          characterId,
        linked_character_id:   linkedCharacterId,
        link_type:             linkType,
        strength:              Math.max(0, Math.min(100, strength)),
        is_mutual:             isMutual,
      },
      { onConflict: 'character_id,linked_character_id' },
    );

  if (error) {
    logger.warn('social-graph:upsert:failed', { characterId, linkedCharacterId, error });
  }
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatSocialGraphForPrompt(characterId: string): Promise<string> {
  const links = await getSocialLinks(characterId);

  if (links.length === 0) return '';

  const grouped: Partial<Record<SocialLinkType, string[]>> = {};

  for (const link of links) {
    const name = link.linked_character?.name;
    if (!name) continue;
    const bucket = (grouped[link.link_type] ??= []);
    bucket.push(name);
  }

  const lines: string[] = [];

  const TYPE_LABELS: Record<SocialLinkType, string> = {
    friend:    'Friends',
    rival:     'Rivals',
    ally:      'Allies',
    enemy:     'Enemies',
    mentor:    'Mentor',
    'protégé': 'Protégé',
    lover:     'Involved with',
    family:    'Family',
  };

  for (const [type, names] of Object.entries(grouped)) {
    const label = TYPE_LABELS[type as SocialLinkType] ?? type;
    lines.push(`${label}: ${names.join(', ')}`);
  }

  return `[Social Connections]\n${lines.join('\n')}`;
}
