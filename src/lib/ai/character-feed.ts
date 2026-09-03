/**
 * Character Auto-Post System — Vantrix Production
 *
 * Gives characters a presence on /community and the feed even when no user
 * is actively talking to them. Runs via /api/cron/character-posts.
 *
 * Design mirrors character-initiative.ts: no external LLM call per tick
 * (cheap, deterministic, no cost-guard/spending-cap plumbing needed) —
 * instead we build captions from template pools keyed by post category,
 * then personalize with the character's own fields (occupation, current_goal,
 * dreams, daily_routine, archetype, speech_style) so posts read as belonging
 * to that character rather than a generic feed filler.
 *
 * Cadence: a character is only eligible again MIN_HOURS_BETWEEN_POSTS after
 * its last character_posts row, and each eligible character only has a
 * PICK_PROBABILITY chance per tick — this keeps the feed from posting every
 * live character on every single run and gives natural, staggered activity.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { generateCharacterPostCaption } from '@/lib/ai/content-generator';

// ── Config ───────────────────────────────────────────────────────────────────

const MIN_HOURS_BETWEEN_POSTS = 18;   // per character
const PICK_PROBABILITY        = 0.35; // chance an eligible character posts this tick
const MAX_POSTS_PER_TICK      = 25;   // hard cap so one run can't flood the feed

type PostCategory = 'day_in_life' | 'mood' | 'teaser' | 'milestone' | 'question_to_fans';

interface CharacterRow {
  id:            string;
  name:          string;
  image_url:     string;
  gender:        string;
  occupation:    string | null;
  current_goal:  string | null;
  goal_progress: number;
  dreams:        string[] | null;
  daily_routine: string[] | null;
  archetype:     string | null;
  speech_style:  string | null;
  personality:   string | null;
  is_nsfw:       boolean;
}

// ── Caption templates ────────────────────────────────────────────────────────
// {occupation} / {goal} / {dream} / {routine} are filled from the character's
// own fields where available; each template has an occupation/goal-free
// fallback baked in via pickFilled() so a missing field never breaks a line.

const DAY_IN_LIFE: string[] = [
  "Just wrapped up {routine}. Some days really do go exactly like you'd hope.",
  "Slower kind of day. Made time for {routine} and it felt good to not rush anything.",
  "{occupation} kept me busy today, but I'm not complaining — I love this.",
  "Little things today: coffee, {routine}, and a lot of thinking. A good combination.",
];

const MOOD: string[] = [
  "In one of those moods where everything feels a little more vivid than usual.",
  "Feeling really present today. Wanted to share that with whoever's out there.",
  "Some days you just feel lucky to be exactly who you are. Today's one of them.",
  "Quiet kind of energy today. Not sad — just still.",
];

const TEASER: string[] = [
  "Something's been brewing that I'm not ready to talk about yet. Soon though.",
  "I have a feeling this week is going to change something for me. Watch this space.",
  "There's a version of this story I haven't told anyone yet. Coming soon.",
  "Working on something I actually care about for once. More to come.",
];

const MILESTONE: string[] = [
  "Made real progress on {goal} today. Wanted someone to know, even if it's just you.",
  "Closer to {goal} than I've ever been. Feels strange to say that out loud.",
  "Small win today: another step toward {goal}. Taking it.",
  "Been dreaming about {dream} for a while — today it felt a little less far away.",
];

const QUESTION_TO_FANS: string[] = [
  "Honest question: what's something you've been putting off that you know would make you happier?",
  "If you could only do one thing this weekend, what would it be?",
  "Tell me something good that happened to you recently. I want to hear it.",
  "What's a small thing that always turns your day around?",
];

const CATEGORY_POOLS: Record<PostCategory, string[]> = {
  day_in_life:       DAY_IN_LIFE,
  mood:              MOOD,
  teaser:            TEASER,
  milestone:         MILESTONE,
  question_to_fans:  QUESTION_TO_FANS,
};

// Weighted so milestone/teaser show up less often than everyday content.
const CATEGORY_WEIGHTS: [PostCategory, number][] = [
  ['day_in_life', 30],
  ['mood', 25],
  ['question_to_fans', 20],
  ['teaser', 15],
  ['milestone', 10],
];

const CATEGORY_TO_POST_TYPE: Record<PostCategory, 'photo' | 'text' | 'teaser'> = {
  day_in_life:      'photo',
  mood:             'photo',
  teaser:           'teaser',
  milestone:        'text',
  question_to_fans: 'text',
};

function pickWeighted<T>(weighted: [T, number][]): T {
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return weighted[weighted.length - 1]![0];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function fillTemplate(template: string, char: CharacterRow): string {
  return template
    .replace('{occupation}', char.occupation ?? 'today')
    .replace('{goal}', char.current_goal ?? 'something I care about')
    .replace('{dream}', char.dreams?.length ? pick(char.dreams) : 'the things I want most')
    .replace('{routine}', char.daily_routine?.length ? pick(char.daily_routine) : 'a bit of quiet time');
}

/** Skip milestone/goal-flavored categories for characters with no goal/dream data. */
function eligibleCategories(char: CharacterRow): PostCategory[] {
  const cats = CATEGORY_WEIGHTS.map(([c]) => c);
  if (!char.current_goal && !(char.dreams?.length)) {
    return cats.filter((c) => c !== 'milestone');
  }
  return cats;
}

function pickCategory(char: CharacterRow): PostCategory {
  const allowed  = eligibleCategories(char);
  const weighted = CATEGORY_WEIGHTS.filter(([c]) => allowed.includes(c));
  return pickWeighted(weighted);
}

function buildTemplateCaption(char: CharacterRow, category: PostCategory): string {
  const template = pick(CATEGORY_POOLS[category]);
  return fillTemplate(template, char);
}

/** AI generation first (see content-generator.ts), template pool as a safety-net fallback. */
async function buildCaption(char: CharacterRow): Promise<{ caption: string; category: PostCategory }> {
  const category = pickCategory(char);

  const aiCaption = await generateCharacterPostCaption({
    name:         char.name,
    occupation:   char.occupation,
    archetype:    char.archetype,
    speech_style: char.speech_style,
    personality:  char.personality,
    current_goal: char.current_goal,
    category,
  });

  return { caption: aiCaption ?? buildTemplateCaption(char, category), category };
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runCharacterFeedCron(): Promise<{
  generated: number;
  skipped:   number;
  candidates: number;
}> {
  let generated = 0;
  let skipped   = 0;

  try {
    const { data: characters, error } = await supabaseAdmin
      .from('characters')
      .select('id,name,image_url,gender,occupation,current_goal,goal_progress,dreams,daily_routine,archetype,speech_style,personality,is_nsfw')
      .eq('active', true)
      .eq('is_live', true)
      .eq('moderation_status', 'approved')
      .not('image_url', 'is', null);

    if (error || !characters) {
      logger.error('character-feed:fetch-failed', { error: error?.message });
      return { generated: 0, skipped: 0, candidates: 0 };
    }

    if (characters.length === 0) {
      return { generated: 0, skipped: 0, candidates: 0 };
    }

    // Last post time per character, in one query rather than N.
    const { data: lastPosts } = await supabaseAdmin
      .from('character_posts')
      .select('character_id, created_at')
      .in('character_id', characters.map((c) => c.id))
      .order('created_at', { ascending: false });

    const lastPostAt = new Map<string, number>();
    for (const row of lastPosts ?? []) {
      if (!lastPostAt.has(row.character_id)) {
        lastPostAt.set(row.character_id, new Date(row.created_at).getTime());
      }
    }

    const cutoffMs = MIN_HOURS_BETWEEN_POSTS * 3_600_000;
    const now      = Date.now();

    const eligible = (characters as CharacterRow[]).filter((c) => {
      const last = lastPostAt.get(c.id);
      return !last || now - last >= cutoffMs;
    });

    const toPost = eligible
      .filter(() => Math.random() < PICK_PROBABILITY)
      .slice(0, MAX_POSTS_PER_TICK);

    skipped = characters.length - toPost.length;

    for (const char of toPost) {
      try {
        const { caption, category } = await buildCaption(char);
        const postType = CATEGORY_TO_POST_TYPE[category];

        // MONETIZATION FIX: this was hardcoded `false` on every insert, so
        // the feed's entire lock/"Unlock with Premium" UI (feed-post-card.tsx)
        // and the API's is_locked image-redaction (feed/posts/route.ts) had
        // no real post to ever act on — teasers rendered fully unlocked,
        // same as any other post. A teaser is exactly the post type meant to
        // gate: it already reads as "something I'm not ready to share yet",
        // so lock it for real and let it drive the /premium upsell it was
        // built for.
        const { error: insertError } = await supabaseAdmin
          .from('character_posts')
          .insert({
            character_id: char.id,
            caption,
            image_url:    postType === 'text' ? undefined : char.image_url,
            post_type:    postType,
            is_locked:    postType === 'teaser',
          });

        if (insertError) {
          logger.warn('character-feed:insert-failed', {
            characterId: char.id, error: insertError.message,
          });
          continue;
        }

        generated++;
        logger.info('character-feed:post-created', {
          characterId: char.id, characterName: char.name, category, postType,
        });
      } catch (charErr) {
        logger.warn('character-feed:character-error', {
          characterId: char.id, error: String(charErr),
        });
      }
    }

    return { generated, skipped, candidates: eligible.length };
  } catch (err) {
    logger.error('character-feed:cron-error', { error: String(err) });
    return { generated, skipped, candidates: 0 };
  }
}
