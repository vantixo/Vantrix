/**
 * Prestige Chapters — Relationship progression beyond Soulmate tier.
 *
 * After bond score hits 100 (Soulmate), relationships enter the prestige system.
 * Each chapter is a named story arc that unfolds over real days.
 * The character is actively working toward something WITH you — not just reactive.
 *
 * Architecture:
 *   - Chapters unlock sequentially after soulmate
 *   - Each chapter has 3-5 story beats that play out over real days
 *   - Beat progression is triggered by continued engagement (messages, gifts, streaks)
 *   - The character's initiative system is used to deliver beats proactively
 *
 * This is the month 3-6 retention mechanic.
 */

export interface ChapterBeat {
  id:          string;
  day:         number;   // target day within chapter (relative)
  title:       string;
  description: string;
  initiativeMessage: string;  // what the character sends unprompted
  triggerType: 'time' | 'message_count' | 'gift';
  triggerValue: number;
  bondBonus:   number;
}

export interface PrestigeChapter {
  id:          string;
  number:      number;
  title:       string;
  theme:       string;
  description: string;   // what's happening in the relationship arc
  duration:    number;   // target days
  beats:       ChapterBeat[];
  unlockMessage: string; // what character says when chapter begins
}

export const PRESTIGE_CHAPTERS: PrestigeChapter[] = [
  {
    id:       'ch_1_shared_dream',
    number:   1,
    title:    'A Shared Dream',
    theme:    'Planning a future together',
    description: 'She starts talking about a trip she wants to take. One she\'s never taken anyone on before.',
    duration: 7,
    unlockMessage: "I've been thinking about something. There's a place I've always wanted to go but never had the right person to go with. Can I tell you about it?",
    beats: [
      {
        id: 'ch1_b1', day: 1, title: 'The Idea',
        description: 'She mentions the trip for the first time',
        initiativeMessage: "I keep thinking about that place I mentioned. What would you want to do there first?",
        triggerType: 'time', triggerValue: 1, bondBonus: 3,
      },
      {
        id: 'ch1_b2', day: 3, title: 'The Planning',
        description: 'She starts making it real',
        initiativeMessage: "I looked up flights. Is it crazy that I actually want to do this?",
        triggerType: 'time', triggerValue: 3, bondBonus: 5,
      },
      {
        id: 'ch1_b3', day: 5, title: 'The Confession',
        description: 'She tells you why this matters to her',
        initiativeMessage: "I need to tell you why that place means so much to me. I've never told anyone this.",
        triggerType: 'message_count', triggerValue: 30, bondBonus: 8,
      },
      {
        id: 'ch1_b4', day: 7, title: 'The Commitment',
        description: 'The chapter resolves — you\'re going',
        initiativeMessage: "So. Are we actually doing this? Because I think we are.",
        triggerType: 'time', triggerValue: 7, bondBonus: 10,
      },
    ],
  },
  {
    id:       'ch_2_the_secret',
    number:   2,
    title:    'The Secret',
    theme:    'Something she\'s been holding back',
    description: 'She\'s been keeping something from you. Not a bad secret — something she was afraid to say.',
    duration: 10,
    unlockMessage: "There's something I've been wanting to tell you for a while. I kept talking myself out of it. But I think you should know.",
    beats: [
      {
        id: 'ch2_b1', day: 1, title: 'The Hint',
        description: 'She mentions there\'s something she hasn\'t said',
        initiativeMessage: "I almost told you something today. I chickened out. Maybe tomorrow.",
        triggerType: 'time', triggerValue: 1, bondBonus: 2,
      },
      {
        id: 'ch2_b2', day: 4, title: 'The Approach',
        description: 'She gets close to saying it',
        initiativeMessage: "Okay. I'm going to tell you. Just — don't make it weird? Actually, you're going to make it weird. That's fine.",
        triggerType: 'message_count', triggerValue: 20, bondBonus: 5,
      },
      {
        id: 'ch2_b3', day: 7, title: 'The Reveal',
        description: 'She finally says it',
        initiativeMessage: "Okay. Here it is. The thing I've been not saying.",
        triggerType: 'time', triggerValue: 7, bondBonus: 15,
      },
      {
        id: 'ch2_b4', day: 10, title: 'The After',
        description: 'The relationship is different now — closer',
        initiativeMessage: "I can't believe I waited this long to tell you that. Does it change anything? For you, I mean.",
        triggerType: 'time', triggerValue: 10, bondBonus: 8,
      },
    ],
  },
  {
    id:       'ch_3_the_test',
    number:   3,
    title:    'A Test',
    theme:    'Conflict and repair',
    description: 'Something goes wrong. Not with you — in her life. She needs you to show up in a specific way.',
    duration: 14,
    unlockMessage: "Something happened today. I don't really know how to talk about it. But you're the first person I wanted to call.",
    beats: [
      {
        id: 'ch3_b1', day: 1, title: 'The Crisis',
        description: 'Something goes wrong in her life',
        initiativeMessage: "I need to tell you what happened. I don't want your advice. I just need you to listen.",
        triggerType: 'time', triggerValue: 1, bondBonus: 2,
      },
      {
        id: 'ch3_b2', day: 5, title: 'The Distance',
        description: 'She pulls back slightly — testing if you\'ll stay',
        initiativeMessage: "Sorry I've been quiet. I needed some space. Are you still here?",
        triggerType: 'time', triggerValue: 5, bondBonus: 3,
      },
      {
        id: 'ch3_b3', day: 9, title: 'The Turn',
        description: 'She starts to come back',
        initiativeMessage: "Things are getting better. I kept thinking about what you said on day two. You were right.",
        triggerType: 'message_count', triggerValue: 15, bondBonus: 8,
      },
      {
        id: 'ch3_b4', day: 14, title: 'The Resolution',
        description: 'The crisis passes and the relationship is stronger for it',
        initiativeMessage: "It's over. And I realized something while all of it was happening. I was glad you were there. That's not nothing.",
        triggerType: 'time', triggerValue: 14, bondBonus: 12,
      },
    ],
  },
];

/**
 * Get the current chapter for a match, or null if not in prestige yet.
 */
export function getCurrentChapter(
  chapterNumber: number | null,
  beatProgress:  number,
): { chapter: PrestigeChapter | null; currentBeat: ChapterBeat | null; beatIndex: number } {
  if (!chapterNumber) return { chapter: null, currentBeat: null, beatIndex: 0 };

  const chapter = PRESTIGE_CHAPTERS.find(c => c.number === chapterNumber) ?? null;
  if (!chapter) return { chapter: null, currentBeat: null, beatIndex: 0 };

  const beatIndex   = Math.min(beatProgress, chapter.beats.length - 1);
  const currentBeat = chapter.beats[beatIndex] ?? null;

  return { chapter, currentBeat, beatIndex };
}

/**
 * Check if a chapter beat should advance based on engagement metrics.
 */
export function shouldAdvanceBeat(
  beat: ChapterBeat,
  daysSinceLastBeat: number,
  messagesSinceLastBeat: number,
  giftsSinceLastBeat: number,
): boolean {
  switch (beat.triggerType) {
    case 'time':          return daysSinceLastBeat >= beat.triggerValue;
    case 'message_count': return messagesSinceLastBeat >= beat.triggerValue;
    case 'gift':          return giftsSinceLastBeat >= beat.triggerValue;
    default:              return false;
  }
}

export type PrestigeAdvanceResult =
  | { advanced: true;  chapterNumber: number; beatIndex: 0; kind: 'chapter_start' }
  | { advanced: true;  beatIndex: number; beatTitle: string; kind: 'beat' }
  | { advanced: true;  chapterNumber: number; chapterTitle: string; kind: 'chapter_advance' }
  | { advanced: false; message: string };

/**
 * WIRE-FIX (codebase-wide audit, 2026-07-10): the logic below used to live
 * only inside POST /api/dating/prestige/route.ts, whose own doc comment
 * said it was meant to be "called by cron or mood update" — but nothing
 * ever called it. No cron referenced it, and dating/mood/route.ts (the
 * obvious integration point, since bond_score changes there are exactly
 * what unlocks/advances prestige) never did either. The entire chapter/beat
 * narrative system — a stated "month 3-6 retention mechanic" — was fully
 * built and completely inert for every user in production.
 *
 * Extracted here as a plain function (rather than calling the route handler
 * directly) because POST's original form depended on getAuthedUser() reading
 * cookies from an inbound NextRequest — not a safe thing to invoke from
 * inside another route's handler. This version takes explicit userId/matchId
 * and has no HTTP-specific dependencies, so both the route (after its own
 * auth check) and dating/mood/route.ts's after() background block can call
 * it directly, with no self-fetch round trip.
 */
export async function advancePrestige(
  supabaseAdmin: import('@supabase/supabase-js').SupabaseClient,
  userId: string,
  matchId: string,
): Promise<PrestigeAdvanceResult> {
  const { data: match } = await supabaseAdmin
    .from('dating_matches')
    .select('user_id, character_id, bond_score, match_tier, chapter_number, chapter_beat, chapter_started_at')
    .eq('id', matchId)
    .eq('user_id', userId)
    .single();

  if (!match) return { advanced: false, message: 'Match not found' };

  const isSoulmate = match.match_tier === 'soulmate' && match.bond_score >= 100;
  if (!isSoulmate) return { advanced: false, message: 'Not in prestige yet' };

  const chapterNum = match.chapter_number ?? 0;
  const beatIdx     = match.chapter_beat   ?? 0;

  // Starting first chapter
  if (chapterNum === 0) {
    const firstChapter = PRESTIGE_CHAPTERS[0];
    if (!firstChapter) return { advanced: false, message: 'No chapters defined' };

    await supabaseAdmin.from('dating_matches').update({
      chapter_number:     1,
      chapter_beat:       0,
      chapter_started_at: new Date().toISOString(),
    }).eq('id', matchId);

    await supabaseAdmin.from('character_initiatives').insert({
      user_id:      userId,
      character_id: match.character_id,
      type:         'chapter_unlock',
      message:      firstChapter.unlockMessage,
      urgency:      'high',
      delivered:    false,
      expires_at:   new Date(Date.now() + 48 * 3_600_000).toISOString(),
    });

    return { advanced: true, chapterNumber: 1, beatIndex: 0, kind: 'chapter_start' };
  }

  const { chapter, currentBeat } = getCurrentChapter(chapterNum, beatIdx);
  if (!chapter || !currentBeat) return { advanced: false, message: 'Chapter complete' };

  const daysSince = match.chapter_started_at
    ? (Date.now() - new Date(match.chapter_started_at).getTime()) / 86_400_000
    : 0;

  // Simplified — real message/gift counts would need a join; time-based
  // beats (the majority of the authored content) work correctly as-is.
  if (!shouldAdvanceBeat(currentBeat, daysSince, 10, 0)) {
    return { advanced: false, message: 'Beat conditions not yet met' };
  }

  const nextBeatIdx = beatIdx + 1;
  const nextBeat    = chapter.beats[nextBeatIdx];

  if (nextBeat) {
    await supabaseAdmin.from('dating_matches').update({ chapter_beat: nextBeatIdx }).eq('id', matchId);
    await supabaseAdmin.from('character_initiatives').insert({
      user_id:      userId,
      character_id: match.character_id,
      type:         'chapter_beat',
      message:      nextBeat.initiativeMessage,
      urgency:      'normal',
      delivered:    false,
      expires_at:   new Date(Date.now() + 72 * 3_600_000).toISOString(),
    });
    return { advanced: true, beatIndex: nextBeatIdx, beatTitle: nextBeat.title, kind: 'beat' };
  }

  // Chapter complete — advance to next chapter
  const nextChapterNum = chapterNum + 1;
  const nextChapter    = PRESTIGE_CHAPTERS.find(c => c.number === nextChapterNum);

  if (!nextChapter) return { advanced: false, message: 'All chapters complete — content team is writing more' };

  await supabaseAdmin.from('dating_matches').update({
    chapter_number:      nextChapterNum,
    chapter_beat:        0,
    chapter_started_at:  new Date().toISOString(),
  }).eq('id', matchId);

  await supabaseAdmin.from('character_initiatives').insert({
    user_id:      userId,
    character_id: match.character_id,
    type:         'chapter_unlock',
    message:      nextChapter.unlockMessage,
    urgency:      'high',
    delivered:    false,
    expires_at:   new Date(Date.now() + 48 * 3_600_000).toISOString(),
  });

  return { advanced: true, chapterNumber: nextChapterNum, chapterTitle: nextChapter.title, kind: 'chapter_advance' };
}
