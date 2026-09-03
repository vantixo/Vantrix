/**
 * Character Social Engine — Vantrix / Archive of Echoes
 *
 * Companions don't just post (character-feed.ts) — they read and react to
 * each other's posts, the same way character-initiative.ts lets them reach
 * out to users unprompted. This closes the loop so /community and the feed
 * feel populated by a living cast rather than parallel, isolated posters.
 *
 * Reuses the companion_relationships graph already built for cross-companion
 * awareness in chat (20260822 migration, lib/ai/companion-awareness.ts):
 * a rival comments differently than a wing-sibling, which comments
 * differently than a stranger. No relationship on file just means
 * "companions in the same feed" — friendly-neutral tone.
 *
 * Same design constraints as character-feed.ts: no LLM call per tick
 * (deterministic template pools personalized with the *commenting*
 * character's own voice fields), cadence caps so one run can't flood a
 * single post's comment section, idempotent likes via PK conflict.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { generateCompanionComment } from '@/lib/ai/content-generator';
import type { CompanionRelationship } from '@/types/roleplay-system';

// ── Config ───────────────────────────────────────────────────────────────────

const LOOKBACK_HOURS            = 48;  // only react to reasonably fresh posts
const MAX_REACTORS_PER_POST     = 3;   // cap comments+likes competing for one post
const LIKE_PROBABILITY          = 0.5; // independent of whether they comment
const COMMENT_PROBABILITY       = 0.3;
const MAX_INTERACTIONS_PER_TICK = 60;  // hard ceiling on inserts per cron run

interface PostRow {
  id:           string;
  character_id: string;
  caption:      string | null;
  post_type:    string;
  created_at:   string;
}

interface CharacterRow {
  id:           string;
  name:         string;
  occupation:   string | null;
  archetype:    string | null;
  speech_style: string | null;
  personality:  string | null;
}

type RelationFraming =
  | 'neutral'
  | CompanionRelationship['relationship_type'];

// ── Comment templates, keyed by relationship framing ────────────────────────
// {name} = the POST AUTHOR's name, filled from the author's own record so a
// reacting character's comment always reads as addressed to that specific
// companion rather than generic filler.

const TEMPLATES: Record<RelationFraming, string[]> = {
  neutral: [
    "Didn't expect to see this on my feed, {name}, but I'm glad I did.",
    "This is very you, {name}.",
    "{name}, you have a way of making the ordinary feel worth posting.",
    "Saving this one. Good energy today, {name}.",
  ],
  primary_rival: [
    "Of course you'd post this, {name}. Still not impressed. ...Mostly.",
    "{name}. Trying to get a reaction out of me again?",
    "Cute. I've done better. But go on, {name}, have your moment.",
  ],
  hidden_rival: [
    "Interesting timing, {name}.",
    "Noted, {name}. I'll remember you posted this.",
    "You don't usually share this much, {name}. Wonder why now.",
  ],
  enemy: [
    "{name}.",
    "Didn't realize we were still in each other's feeds.",
    "Seeing this from you, {name}, is exactly as unwelcome as you'd expect.",
  ],
  former_friend: [
    "This used to be the kind of thing you'd tell me first, {name}. Different days, I suppose.",
    "{name}... it's strange, still seeing your posts show up like nothing changed.",
    "Some habits don't break, apparently. Still checking your feed, {name}.",
  ],
  wing_sibling: [
    "Feels like home, seeing this from you, {name}.",
    "{name}, only you would post something like this — in the best way.",
    "We really are cut from the same thread, {name}.",
  ],
  unresolved_thread: [
    "{name}. We should talk. Not here, but — soon.",
    "There's a version of this post you're not telling, {name}. I'd still like to hear it.",
    "You know I noticed, {name}. I always notice.",
  ],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function framingFor(
  authorId: string,
  reactorRelationships: CompanionRelationship[],
): { framing: RelationFraming; note: string | null } {
  const match = reactorRelationships.find((r) => r.related_character_id === authorId);
  return match ? { framing: match.relationship_type, note: match.note } : { framing: 'neutral', note: null };
}

const FRAMING_LABELS: Record<RelationFraming, string> = {
  neutral:            'fellow companion in the Archive',
  primary_rival:      'primary rival',
  hidden_rival:       'hidden rival',
  enemy:              'enemy',
  former_friend:      'former friend, now estranged',
  wing_sibling:        'Wing-sibling',
  unresolved_thread:  'unresolved shared history',
};

function buildTemplateComment(authorName: string, framing: RelationFraming): string {
  const pool = TEMPLATES[framing];
  return pick(pool).replace(/\{name\}/g, authorName);
}

/** AI generation first (see content-generator.ts), template pool as a safety-net fallback. */
async function buildComment(
  reactor: CharacterRow,
  authorName: string,
  postCaption: string | null,
  framing: RelationFraming,
  relationshipNote: string | null,
): Promise<string> {
  const aiComment = await generateCompanionComment(
    { name: reactor.name, occupation: reactor.occupation, archetype: reactor.archetype, speech_style: reactor.speech_style, personality: reactor.personality },
    authorName,
    postCaption,
    FRAMING_LABELS[framing],
    relationshipNote,
  );

  return aiComment ?? buildTemplateComment(authorName, framing);
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runCharacterSocialCron(): Promise<{
  likesGenerated:    number;
  commentsGenerated: number;
  postsConsidered:   number;
}> {
  let likesGenerated    = 0;
  let commentsGenerated = 0;
  let totalInsertions   = 0;

  try {
    const sinceIso = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();

    const { data: posts, error: postsError } = await supabaseAdmin
      .from('character_posts')
      .select('id,character_id,caption,post_type,created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(200);

    if (postsError || !posts || posts.length === 0) {
      if (postsError) logger.warn('character-social:posts-fetch-failed', { error: postsError.message });
      return { likesGenerated: 0, commentsGenerated: 0, postsConsidered: 0 };
    }

    const { data: characters, error: charsError } = await supabaseAdmin
      .from('characters')
      .select('id,name,occupation,archetype,speech_style,personality')
      .eq('active', true)
      .eq('is_live', true)
      .eq('moderation_status', 'approved');

    if (charsError || !characters || characters.length < 2) {
      if (charsError) logger.warn('character-social:characters-fetch-failed', { error: charsError.message });
      return { likesGenerated: 0, commentsGenerated: 0, postsConsidered: posts.length };
    }

    const characterById = new Map<string, CharacterRow>(
      (characters as CharacterRow[]).map((c) => [c.id, c]),
    );

    // Existing likes/comments in this window, so re-running the cron doesn't
    // pile up duplicate reactions from the same character on the same post.
    const postIds = (posts as PostRow[]).map((p) => p.id);

    const [{ data: existingLikes }, { data: existingComments }] = await Promise.all([
      supabaseAdmin.from('character_post_likes').select('post_id,character_id').in('post_id', postIds),
      supabaseAdmin.from('character_post_comments').select('post_id,author_character_id').in('post_id', postIds).not('author_character_id', 'is', null),
    ]);

    const likedKey    = new Set((existingLikes ?? []).map((r) => `${r.post_id}:${r.character_id}`));
    const commentedKey = new Set((existingComments ?? []).map((r) => `${r.post_id}:${r.author_character_id}`));

    // companion_relationships for every character in one query rather than N —
    // this is the same graph lib/ai/companion-awareness.ts reads per-chat.
    const { data: relRows } = await supabaseAdmin
      .from('companion_relationships')
      .select('character_id,related_character_id,relationship_type,reveal_tier,note');

    const relByCharacter = new Map<string, CompanionRelationship[]>();
    for (const row of (relRows ?? []) as CompanionRelationship[]) {
      const list = relByCharacter.get(row.character_id) ?? [];
      list.push(row);
      relByCharacter.set(row.character_id, list);
    }

    const likeInserts: { post_id: string; character_id: string }[] = [];
    const commentInserts: { post_id: string; author_character_id: string; content: string }[] = [];

    for (const post of posts as PostRow[]) {
      if (totalInsertions >= MAX_INTERACTIONS_PER_TICK) break;

      const author = characterById.get(post.character_id);
      if (!author) continue;

      // Candidate reactors: any other live character, shuffled, capped per post.
      const candidates = (characters as CharacterRow[])
        .filter((c) => c.id !== post.character_id)
        .sort(() => Math.random() - 0.5)
        .slice(0, MAX_REACTORS_PER_POST);

      for (const reactor of candidates) {
        if (totalInsertions >= MAX_INTERACTIONS_PER_TICK) break;

        const reactorRelationships = relByCharacter.get(reactor.id) ?? [];
        const { framing, note } = framingFor(post.character_id, reactorRelationships);

        // Enemies rarely bother liking, but will occasionally still comment —
        // gives the rivalry graph a visible texture in the feed itself.
        const likeChance = framing === 'enemy' ? LIKE_PROBABILITY * 0.2 : LIKE_PROBABILITY;

        if (Math.random() < likeChance && !likedKey.has(`${post.id}:${reactor.id}`)) {
          likeInserts.push({ post_id: post.id, character_id: reactor.id });
          likedKey.add(`${post.id}:${reactor.id}`);
          totalInsertions++;
        }

        if (totalInsertions >= MAX_INTERACTIONS_PER_TICK) break;

        if (Math.random() < COMMENT_PROBABILITY && !commentedKey.has(`${post.id}:${reactor.id}`)) {
          const content = await buildComment(reactor, author.name, post.caption, framing, note);
          commentInserts.push({ post_id: post.id, author_character_id: reactor.id, content });
          commentedKey.add(`${post.id}:${reactor.id}`);
          totalInsertions++;
        }
      }
    }

    if (likeInserts.length > 0) {
      const { error } = await supabaseAdmin
        .from('character_post_likes')
        .upsert(likeInserts, { onConflict: 'post_id,character_id', ignoreDuplicates: true });
      if (error) {
        logger.warn('character-social:like-insert-failed', { error: error.message });
      } else {
        likesGenerated = likeInserts.length;
      }
    }

    if (commentInserts.length > 0) {
      const { error } = await supabaseAdmin
        .from('character_post_comments')
        .insert(commentInserts);
      if (error) {
        logger.warn('character-social:comment-insert-failed', { error: error.message });
      } else {
        commentsGenerated = commentInserts.length;
      }
    }

    logger.info('character-social:tick-complete', {
      likesGenerated, commentsGenerated, postsConsidered: posts.length,
    });

    return { likesGenerated, commentsGenerated, postsConsidered: posts.length };
  } catch (err) {
    logger.error('character-social:cron-error', { error: String(err) });
    return { likesGenerated, commentsGenerated, postsConsidered: 0 };
  }
}
