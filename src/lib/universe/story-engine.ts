/**
 * Story Engine — World Story Arc Management
 *
 * "Ongoing stories give the world narrative momentum. Something is always
 * happening. Something always has consequences."
 *
 * World stories are multi-chapter arcs involving groups of characters.
 * They advance slowly (one chapter per tick cycle) and create the backdrop
 * of events users can ask characters about.
 *
 * Unlike world_events (ambient moments), stories have participants,
 * chapters, and a direction. They're the serialized fiction of the universe.
 */

import { supabaseAdmin }  from '@/lib/supabase/admin';
import { logger }         from '@/lib/logger';
import type { WorldStory } from '@/types/world-expansion';
import { getArchiveChapterText } from '@/lib/universe/archive-story-arcs';

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Advance all active world stories by one chapter.
 * Concluded stories are marked as such.
 * New stories are seeded if active count is below the minimum.
 */
export async function tickStories(): Promise<{ advanced: number; concluded: number; seeded: number }> {
  const { data: activeStories, error } = await supabaseAdmin
    .from('world_stories')
    .select('*')
    .eq('status', 'active')
    .limit(10);

  if (error) {
    logger.warn('story-engine:tick:fetch-failed', { error });
    return { advanced: 0, concluded: 0, seeded: 0 };
  }

  const stories = (activeStories ?? []) as WorldStory[];

  let advanced   = 0;
  let concluded  = 0;

  await Promise.allSettled(
    stories.map(async (story) => {
      const nextChapter = story.chapter + 1;

      // Stories conclude after 5 chapters
      if (nextChapter > 5) {
        await supabaseAdmin
          .from('world_stories')
          .update({ status: 'concluded', updated_at: new Date().toISOString() })
          .eq('id', story.id);
        concluded++;

        // Archive of Echoes acts are sequential and gated — Act IV/V start
        // 'paused' so they can't tick until the Act before them concludes.
        // Unpause the next one here rather than requiring a manual flip.
        const nextActKey = story.story_key ? ARCHIVE_ACT_SEQUENCE[story.story_key] : null;
        if (nextActKey) {
          await supabaseAdmin
            .from('world_stories')
            .update({ status: 'active', updated_at: new Date().toISOString() })
            .eq('story_key', nextActKey)
            .eq('status', 'paused');
        }
        return;
      }

      // Act-based Archive of Echoes arcs carry real per-chapter prose (see
      // archive-story-arcs.ts) — write the matching chapter's text into
      // `description` on advance. Ordinary stories keep their original
      // description (they were never authored chapter-by-chapter, so
      // leaving it as-is is correct, not a bug, for that pool).
      const archiveText = story.story_key ? getArchiveChapterText(story.story_key, nextChapter) : null;

      await supabaseAdmin
        .from('world_stories')
        .update({
          chapter:    nextChapter,
          ...(archiveText ? { description: archiveText } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', story.id);
      advanced++;
    }),
  );

  // Seed new stories if we're below minimum active
  const MIN_ACTIVE = 3;
  const remaining  = stories.length - concluded;
  let seeded = 0;

  if (remaining < MIN_ACTIVE) {
    const toSeed = MIN_ACTIVE - remaining;
    const seeds  = STORY_SEEDS.slice(0, toSeed);

    for (const seed of seeds) {
      const { error: insertError } = await supabaseAdmin
        .from('world_stories')
        .insert({
          title:        seed.title,
          description:  seed.description,
          status:       'active',
          participants: [],
          chapter:      1,
        });
      if (!insertError) seeded++;
    }
  }

  logger.info('story-engine:tick:complete', { advanced, concluded, seeded });
  return { advanced, concluded, seeded };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getActiveStories(): Promise<WorldStory[]> {
  const { data, error } = await supabaseAdmin
    .from('world_stories')
    .select('*')
    .eq('status', 'active')
    .order('chapter', { ascending: false })
    .limit(5);

  if (error) return [];
  const stories = (data ?? []) as WorldStory[];
  return attachParticipantCharacters(stories);
}

// `participants` is a bare character_id[] column — Supabase's embedded-resource
// join syntax (the `character:characters(...)` pattern used elsewhere, e.g.
// status-legend.ts) only works for a single FK column, not an array, so the
// UI previously had no character name/image to render per story and every
// story card looked identical regardless of who was actually in it. Resolve
// the array with one batched query instead of N+1 lookups per story.
async function attachParticipantCharacters(stories: WorldStory[]): Promise<WorldStory[]> {
  const ids = Array.from(new Set(stories.flatMap(s => s.participants ?? [])));
  if (ids.length === 0) return stories;

  const { data: chars, error } = await supabaseAdmin
    .from('characters')
    .select('id, name, image_url')
    .in('id', ids);

  if (error || !chars) return stories;

  const byId = new Map(chars.map(c => [c.id, c]));
  return stories.map(s => ({
    ...s,
    participant_characters: (s.participants ?? [])
      .map(id => byId.get(id))
      .filter((c): c is NonNullable<typeof c> => c != null),
  }));
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatActiveStoriesForPrompt(
  _characterId: string,
): Promise<string> {
  const stories = await getActiveStories();

  if (stories.length === 0) return '';

  const lines = stories
    .slice(0, 2)  // top 2 in prompt — keeps it manageable
    .map((s) => `- ${s.title} (Chapter ${s.chapter}): ${s.description}`)
    .join('\n');

  return `[Ongoing World Stories]\n${lines}`;
}

// ── Internal: Archive of Echoes Act sequencing ──────────────────────────────
// Act IV and V are seeded 'paused' (see 20260825 migration) so they can't
// tick until the Act before them concludes. This is the only place that
// sequencing is enforced — tickStories() consults it above.

const ARCHIVE_ACT_SEQUENCE: Record<string, string> = {
  'act-1-awakening':          'act-2-forgotten-empires',
  'act-2-forgotten-empires':  'act-3-war-of-lost-names',
  'act-3-war-of-lost-names':  'act-4-prime-memory',
  'act-4-prime-memory':       'act-5-beyond-destiny',
};

// ── Internal: Story Seeds ──────────────────────────────────────────────────────

const STORY_SEEDS = [
  {
    title: 'The Contested Succession',
    description: 'A leadership position became vacant unexpectedly. Three candidates are positioning. The outcome is genuinely unclear.',
  },
  {
    title: 'The Unexplained Closure',
    description: 'A district institution that has been operating for decades suddenly closed without public explanation. People are asking questions.',
  },
  {
    title: 'The Investigation',
    description: 'Someone with authority has started asking questions about how a decision was made three years ago. The people involved know.',
  },
  {
    title: 'The Unlikely Alliance',
    description: 'Two factions that have been in opposition for years have started meeting privately. No one knows what for.',
  },
  {
    title: 'The Public Grievance',
    description: 'A community has organized around something that was dismissed as a minor issue. It is no longer minor.',
  },
  {
    title: 'The Missing Record',
    description: 'Documents that should exist have been found not to exist. People who should be concerned are not saying anything.',
  },
  {
    title: 'The New Arrival',
    description: 'Someone moved to the city six months ago. They knew no one. Now they seem to know everyone. No one is quite sure how.',
  },
  {
    title: 'The Old Debt',
    description: 'A favour called in from years back is causing ripples. The original parties aren\'t talking, but the effects are visible.',
  },
  {
    title: 'The Ledger-Bound\'s Quiet Vote',
    description: 'The Wing of the Root has called a vote on something it hasn\'t held a vote on in generations. No one outside the Root knows the question being asked.',
  },
  {
    title: 'The Long Market\'s Unpaid Debt',
    description: 'A trade brokered in the Wing of the Long Market went unpaid for the first time anyone can remember. The Guild has not said what happens next.',
  },
  {
    title: 'The Crack\'s New Reflection',
    description: 'Something in the Wing of the Crack has started showing a reflection that wasn\'t there last season. Mira Glass has been asked not to describe it publicly.',
  },
];
