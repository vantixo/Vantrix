/**
 * GET /api/characters/:id/story — "Our Story": this user's relationship
 * timeline with this character.
 *
 * FEATURE 8 (Our Story) GAP FILL: the actual engine for this already
 * existed and was solid — memory-consolidation.ts → timeline-engine.ts →
 * life-story.ts, fronted by autobiography-engine.ts's generateAutobiography()
 * — but it was only ever called internally (chat/stream/route.ts) to build
 * prompt context for the character. Nothing exposed it to the user. This
 * route is the only new piece: fetch the same three inputs the engine
 * already documents needing (MemoryNode[], RelationshipHistoryEntry[],
 * KnowledgeEntry[] canon) and hand them to generateAutobiography() —
 * exactly the "best path for a caller wiring this up" its own header
 * describes. No new consolidation/timeline/chapter logic here.
 *
 * Privacy: scoped to req.user.id + characterId pulled from the URL — a user
 * can only ever see their own relationship timeline, never another user's
 * (matches the isolation rule every other per-user relationship route in
 * this app already follows, e.g. /api/dating/milestones).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getMemoryGraph } from '@/lib/ai/memory-graph';
import { buildRelationshipHistoryTimeline, logHistoryReadFailure } from '@/lib/ai/relationship-history-engine';
import { generateAutobiography } from '@/lib/ai/autobiography-engine';
import type { KnowledgeEntry } from '@/lib/ai/knowledge-library';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: characterId } = await params;
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: character } = await supabaseAdmin
    .from('characters')
    .select('id,name')
    .eq('id', characterId)
    .single();
  if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

  // A dating_matches row may or may not exist for this user+character — Our
  // Story works for any chat relationship, not only ones that went through
  // the swipe/dating flow. Same optional-matchId pattern
  // buildRelationshipHistoryTimeline() already documents.
  const { data: match } = await supabaseAdmin
    .from('dating_matches')
    .select('id')
    .eq('user_id', user.id)
    .eq('character_id', characterId)
    .maybeSingle();

  let relationshipHistory: Awaited<ReturnType<typeof buildRelationshipHistoryTimeline>> = [];
  try {
    relationshipHistory = await buildRelationshipHistoryTimeline(user.id, characterId, {
      matchId: match?.id,
    });
  } catch (err) {
    await logHistoryReadFailure(user.id, characterId, err).catch(() => {});
  }

  const [memoryNodes, canonRows] = await Promise.all([
    // Wider pool than the live-chat prompt fetch — consolidateMemories()
    // needs the fuller picture to group repeats correctly, not just the
    // top-N-by-emotion slice a single chat turn needs.
    getMemoryGraph(user.id, characterId, 200),
    supabaseAdmin
      .from('character_knowledge')
      .select('id,category,title,content,tags,weight')
      .eq('character_id', characterId)
      .eq('category', 'backstory_detail')
      .then(
        r => (r.data ?? []) as unknown as KnowledgeEntry[],
        () => [] as KnowledgeEntry[],
      ),
  ]);

  if (memoryNodes.length === 0 && relationshipHistory.length === 0) {
    // Nothing to tell yet — a brand-new relationship. Not an error.
    return NextResponse.json({
      characterName: character.name,
      headline: '',
      timeline: [],
      chapters: [],
    });
  }

  const autobiography = generateAutobiography(user.id, characterId, {
    memoryNodes,
    relationshipHistory,
    canon: canonRows,
  });

  logger.debug('[characters/story] generated', {
    userId: user.id, characterId, entries: autobiography.timeline.length,
  });

  return NextResponse.json({
    characterName: character.name,
    headline: autobiography.headline,
    timeline: autobiography.timeline,
    chapters: autobiography.chapters,
  });
}
