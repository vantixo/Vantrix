/**
 * POST /api/dating/date/[id]/complete
 *
 * Marks a First Date session complete, applies its bond bonus atomically
 * via complete_date_session(), and — the part that actually makes the date
 * matter beyond the single conversation turn — records it as a real memory
 * (memory_graph) so future conversations can reference it naturally, and
 * awards the one-time 'first_date' milestone if this is the user's first
 * completed date with this match. Mirrors the milestone-award pattern
 * already used in /api/dating/gifts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { MILESTONE_FLAGS, checkMilestones, DATE_CATALOGUE } from '@/lib/dating/engine';
import { addMemory } from '@/lib/ai/memory-graph';
import { logger, bg } from '@/lib/logger';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { emitNotification } from '@/lib/notifications/emit';
import { recordSurprise } from '@/lib/ai/surprise-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  // A short, honest user-facing recap of how the date actually went —
  // optional; if omitted we fall back to the opening scene for the memory
  // description rather than inventing what happened.
  recap: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) return NextResponse.json({ error: 'Invalid session id' }, { status: 400 });
    const { id: sessionId } = parsedParams.data;

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => ({})));
    const recap = parsedBody.success ? parsedBody.data.recap : undefined;

    const { data: session } = await supabaseAdmin
      .from('date_sessions')
      .select('id,match_id,user_id,character_id,date_type,opening_scene,status')
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .single();
    if (!session) return NextResponse.json({ error: 'Date session not found' }, { status: 404 });
    if (session.status !== 'active') {
      return NextResponse.json({ error: 'This date has already ended', code: 'DATE_NOT_ACTIVE' }, { status: 409 });
    }

    const { data: newBond, error: completeErr } = await supabaseAdmin.rpc('complete_date_session', {
      p_session_id: sessionId,
      p_user_id:    user.id,
    });
    if (completeErr) {
      logger.error('dating-date:complete-failed', { userId: user.id, sessionId, error: completeErr.message });
      return NextResponse.json({ error: 'Could not complete date', details: completeErr.message }, { status: 500 });
    }

    const dateDef = DATE_CATALOGUE.find(d => d.type === session.date_type);
    const dateName = dateDef?.name ?? session.date_type;

    // ── Record the Moment (memory_graph) ─────────────────────────────────
    // Grounded in the actual scene + optional user recap, never fabricated
    // beyond what happened in this session.
    const memory = await addMemory(user.id, session.character_id, {
      event_type:  'milestone',
      title:       `First date: ${dateName}`,
      description: recap?.trim() || session.opening_scene,
      emotional_weight: 7,
      tags: ['date', session.date_type],
    });

    // ── first_date milestone (one-time, per match) ─────────────────────
    const { data: match } = await supabaseAdmin
      .from('dating_matches')
      .select('milestones,bond_score,streak_days')
      .eq('id', session.match_id)
      .single();

    let milestoneAwarded: string | null = null;
    if (match) {
      const milestoneCheck = checkMilestones({
        currentMilestones: match.milestones,
        bondScore:         match.bond_score,
        streakDays:        match.streak_days,
        totalMessages:     999, // first_chat/deep_talk already resolved elsewhere; this call only exists to catch first_date-adjacent thresholds cleanly
        giftsGiven:        0,
      });
      const alreadyHasFirstDate = (match.milestones & MILESTONE_FLAGS.first_date) !== 0;
      if (!alreadyHasFirstDate) {
        milestoneAwarded = 'first_date';
        const newMilestones = match.milestones | MILESTONE_FLAGS.first_date;
        await supabaseAdmin.from('dating_matches').update({ milestones: newMilestones }).eq('id', session.match_id);
        await supabaseAdmin.from('dating_milestones').insert({
          match_id: session.match_id, user_id: user.id,
          milestone: 'first_date', bond_bonus: 0,
          description: `Completed your first date: ${dateName}`,
        });
        emitNotification({
          userId: user.id,
          type: 'milestone_unlocked',
          title: 'Milestone unlocked',
          body: `You unlocked "first_date" — completed ${dateName}.`,
          // ROUTE-FIX: page lives at /dating/match/[id], not /dating/[id]
          // (see dating/swipe/route.ts for the same fix) — was 404'ing.
          ctaUrl: `/dating/match/${session.match_id}`,
          urgency: 'medium',
          metadata: { matchId: session.match_id, milestone: 'first_date' },
        }).catch(bg('emitNotification.milestoneUnlocked'));
        // MILESTONE-CHAT-FIX: see gifts/route.ts's identical fix — this
        // route only ever notified the global bell, never the in-chat
        // MilestoneToastStack (which subscribes to recordSurprise(), not
        // emitNotification()).
        const { data: dateCharacter } = await supabaseAdmin
          .from('characters').select('name').eq('id', session.character_id).single();
        recordSurprise(
          user.id, session.character_id, 'milestone_unlocked',
          `You just hit a milestone with ${dateCharacter?.name ?? 'her'}: completed ${dateName}.`,
        ).catch(bg('recordSurprise.dateMilestone'));
      }
      void milestoneCheck; // reserved for future thresholds tied to date count; not applied here to avoid double-awarding bond
    }

    logger.info('dating-date:completed', { userId: user.id, sessionId, matchId: session.match_id, milestoneAwarded });

    return NextResponse.json({
      completed: true,
      newBond,
      memoryId: memory?.id ?? null,
      milestoneAwarded,
    });
  } catch (err) {
    logger.error('dating-date:complete-error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
