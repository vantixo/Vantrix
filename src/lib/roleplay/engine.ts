import { randomUUID } from 'crypto';
import type { Json } from '@/types/supabase';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { sanitize } from '@/lib/sanitize';
import { orchestrator } from '@/lib/ai/orchestrator';
import { assembleCharacterPrompt, type CharacterData } from '@/lib/ai/prompt';
import type { ModelTier } from '@/lib/ai/model-router';
import { stripLeakedMeta } from '@/lib/moderation/reply-guard';
import { watchKeywords } from '@/lib/moderation/keyword-watch';
import { detectCrisisSignal, logCrisisEvent } from '@/lib/safety/crisis-detection';
import { buildCrisisReply } from '@/lib/safety/crisis-response';
import { checkChatLimit, checkDailyMessageCap, type Tier } from '@/lib/rate-limit';
import { checkMatureContentAccess } from '@/lib/access/character-gate';
import { emitNotification } from '@/lib/notifications/emit';
import { awardXp } from '@/lib/growth/streak-rewards-engine';
import {
  getScenario,
  isScenarioUnlockedForTier,
  getCharacterFactionSlugs,
  getCharacterLocationSlug,
} from '@/lib/roleplay/scenarios';
import {
  buildRoleplaySystemFragment,
  FINAL_CHAPTER_CLOSING_NOTE,
  formatUserAction,
} from '@/lib/roleplay/prompt';
import { parseRoleplayOutput, fallbackChapterChoices } from '@/lib/roleplay/choice-parser';
import type {
  RoleplayActionType,
  RoleplayScenario,
  RoleplaySceneState,
  RoleplaySession,
  RoleplaySessionStatus,
  RoleplayTurnResult,
} from '@/types/roleplay';

// Recent beats fed back to the model as conversation history — keeps the
// prompt bounded regardless of how long a session runs. Mirrors the spirit
// of token-budget.ts's trimHistoryForPlan without pulling in the full
// per-tier trimming logic (roleplay beats are already short, ~80-180 words).
const BEAT_HISTORY_LIMIT = 10;

// Safety net: if the model never emits [[CHAPTER_END]] (formatting misses
// happen), force a chapter break after this many beats so a chapter can
// never run away indefinitely and the story keeps moving toward retention
// beats (chapter-complete XP, "continue your story" nudge) on a bounded
// cadence.
const MAX_BEATS_PER_CHAPTER = 8;

const CHAPTER_COMPLETE_XP = 40;
const STORY_COMPLETE_XP   = 120;

export class RoleplayError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const CHARACTER_COLUMNS =
  'id,name,description,personality,scenario,backstory,gender,tags,age,origin,occupation,values_list,fears,dreams,flaws,speech_style,current_goal,daily_routine,friends_list,active,is_nsfw';

/**
 * Free plans are capped at the FAST model tier for ordinary chat (see
 * PLAN_MODEL_CAP in model-router.ts, enforced inside routeModel() /
 * costGuard — a path this module deliberately doesn't call into, see the
 * module docstring below). Mirrors that same cap locally so a free-tier
 * story never silently routes to a more expensive model than freeform chat
 * would allow at the same plan.
 */
function modelTierForPlan(tier: Tier): ModelTier {
  return tier === 'premium' ? 'SMART' : 'FAST';
}

/**
 * Why this module calls orchestrator.prepare/infer/finish directly instead
 * of going through costGuard.check() (the path chat/stream/route.ts uses):
 * costGuard's semantic cache and cost-aware model routing are tuned for
 * short conversational replies with high repeat-question rates — neither
 * assumption holds for narrative prose, where near-identical prompts are
 * rare and caching a scene beat would be actively wrong (the same choice
 * text later in a different scene state must never return a cached reply).
 * Spending-cap enforcement and billing (the part that actually protects
 * cost) still runs in full via orchestrator.prepare()'s own slow path and
 * orchestrator.finish() — this only skips the caching/routing machinery
 * built for a different workload shape.
 */

async function loadCharacter(characterId: string) {
  const { data, error } = await supabaseAdmin
    .from('characters')
    .select(CHARACTER_COLUMNS)
    .eq('id', characterId)
    .eq('active', true)
    .single();
  if (error || !data) throw new RoleplayError('Character not found', 'CHARACTER_NOT_FOUND', 404);
  return data as unknown as CharacterData & { id: string; name: string; is_nsfw?: boolean | null };
}

/**
 * Find-or-create the (user, character) conversation, same upsert-on-conflict
 * semantics as POST /api/conversations/ensure. Deliberately duplicated
 * rather than imported — that route is a client-facing HTTP endpoint, this
 * runs server-side inside another API route handler at the same layer, and
 * lib/frontend/chat.ts's own docstring is explicit that conversation
 * creation should have exactly one implementation per *layer*, not be
 * called out-of-process from here.
 */
async function ensureConversation(userId: string, characterId: string, characterName: string): Promise<string> {
  const { error: upsertErr } = await supabaseAdmin
    .from('conversations')
    .upsert(
      { user_id: userId, character_id: characterId, title: `Chat with ${characterName}` },
      { onConflict: 'user_id,character_id', ignoreDuplicates: true },
    );
  if (upsertErr) {
    logger.error('roleplay:ensure-conversation:upsert-failed', { error: upsertErr, userId, characterId });
    throw new RoleplayError('Could not start conversation', 'CONVERSATION_CREATE_FAILED', 500);
  }

  const { data } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .single();

  if (!data) throw new RoleplayError('Could not start conversation', 'CONVERSATION_CREATE_FAILED', 500);
  return data.id;
}

function appendEstablishedFact(state: RoleplaySceneState, narrative: string): RoleplaySceneState {
  const snippet = narrative.replace(/\s+/g, ' ').trim().slice(0, 160);
  const facts = [...(state.establishedFacts ?? []), snippet].slice(-12);
  return { ...state, establishedFacts: facts };
}

function buildSystemPrompt(
  character: CharacterData & { name: string },
  scenario: RoleplayScenario,
  sceneState: RoleplaySceneState,
  currentChapter: number,
  status: RoleplaySessionStatus,
  isOpeningBeat: boolean,
  isFinalChapter: boolean,
): string {
  let prompt = [
    assembleCharacterPrompt(character),
    buildRoleplaySystemFragment({
      characterName: character.name,
      scenario,
      sceneState,
      currentChapter,
      status,
      isOpeningBeat,
    }),
  ].join('\n\n');

  if (isFinalChapter) prompt += `\n\n${FINAL_CHAPTER_CLOSING_NOTE}`;
  return prompt;
}

// ── Public: start a new story ────────────────────────────────────────────────

export async function startSession(params: {
  userId: string;
  tier: Tier;
  characterId: string;
  scenarioId: string;
}): Promise<{ conversationId: string; turn: RoleplayTurnResult }> {
  const { userId, tier, characterId, scenarioId } = params;

  const scenario = await getScenario(scenarioId);
  if (!scenario) throw new RoleplayError('Story not found', 'SCENARIO_NOT_FOUND', 404);
  if (scenario.character_id && scenario.character_id !== characterId) {
    throw new RoleplayError('This story isn\'t available for this character', 'SCENARIO_CHARACTER_MISMATCH', 403);
  }
  // AREA-RESTRICTION FIX: the authoritative gate for "only people living
  // inside the area participate in the scenes" — listScenarios()/
  // getEligibleCastForScenario() already keep an ineligible character from
  // ever being *offered* a faction/location-scoped scenario in either
  // picker UI, but neither of those is a security boundary on its own
  // (same reasoning as the tier check just below: the picker hides locked
  // cards, this is what actually enforces it). A direct POST here with a
  // character who isn't a member/resident is rejected the same way a
  // character_id mismatch is above.
  if (scenario.faction_slug) {
    const factionSlugs = await getCharacterFactionSlugs(characterId);
    if (!factionSlugs.has(scenario.faction_slug)) {
      throw new RoleplayError('This story is only for characters connected to that faction', 'SCENARIO_FACTION_LOCKED', 403);
    }
  }
  if (scenario.location_slug) {
    const locationSlug = await getCharacterLocationSlug(characterId);
    if (locationSlug !== scenario.location_slug) {
      throw new RoleplayError('This story is only for characters who live there', 'SCENARIO_LOCATION_LOCKED', 403);
    }
  }
  if (!isScenarioUnlockedForTier(scenario, tier)) {
    throw new RoleplayError('This story requires Premium', 'SCENARIO_TIER_LOCKED', 403);
  }

  const character = await loadCharacter(characterId);

  // SEC: roleplay generates full narrative turns exactly like chat — a
  // user with a character/scenario id could otherwise start (and
  // continue, since the session carries no re-check) a story with an
  // NSFW character without ever passing age-verification / nsfw_enabled.
  // Same gate as /api/chat/stream.
  const matureGate = await checkMatureContentAccess(userId, !!character.is_nsfw, tier);
  if (!matureGate.allowed) {
    throw new RoleplayError(
      matureGate.reason ?? 'This character has mature content and is currently unavailable',
      'MATURE_CONTENT_BLOCKED',
      403,
    );
  }

  const conversationId = await ensureConversation(userId, characterId, character.name);

  // Only one ACTIVE session per conversation (DB partial unique index also
  // enforces this) — abandon any prior one before starting fresh so
  // switching scenarios mid-conversation never races the constraint.
  await supabaseAdmin
    .from('roleplay_sessions')
    .update({ status: 'abandoned', updated_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('status', 'active');

  const initialSceneState: RoleplaySceneState = {
    location: scenario.setting,
    mood: scenario.tone,
    establishedFacts: [],
  };

  const { data: sessionRow, error: sessionErr } = await supabaseAdmin
    .from('roleplay_sessions')
    .insert({
      conversation_id: conversationId,
      user_id:         userId,
      character_id:    characterId,
      scenario_id:     scenarioId,
      status:           'active',
      current_chapter:  1,
      beat_count:       0,
      scene_state:      initialSceneState as unknown as Json,
    })
    .select('*')
    .single();

  if (sessionErr || !sessionRow) {
    logger.error('roleplay:start:session-insert-failed', { error: sessionErr, userId, scenarioId });
    throw new RoleplayError('Could not start this story — try again in a moment', 'SESSION_CREATE_FAILED', 500);
  }
  const session = sessionRow as RoleplaySession;

  await supabaseAdmin
    .from('conversations')
    .update({ roleplay_mode: true, roleplay_session_id: session.id, updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  const isFinalChapter = scenario.chapter_count <= 1;
  const systemPrompt = buildSystemPrompt(character, scenario, session.scene_state, 1, 'active', true, isFinalChapter);

  const traceId = randomUUID();
  let narrative: string;
  let tokensUsed = 0;

  try {
    const ctx = await orchestrator.prepare({
      userId, tier, characterId, conversationId, traceId, modelTier: modelTierForPlan(tier),
    });
    const inferResult = await orchestrator.infer(ctx, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Begin the story.' },
    ]);
    await orchestrator.finish(ctx, inferResult);
    narrative = parseRoleplayOutput(stripLeakedMeta(inferResult.reply)).narrative || scenario.opening_narration;
    tokensUsed = inferResult.tokensUsed;
  } catch (err) {
    // Never let a model/provider hiccup block the story from starting —
    // the scenario's own authored opening_narration is a perfectly good
    // opening beat on its own; the user just resumes with a live beat on
    // their first action.
    logger.warn('roleplay:start:infer-failed-using-fallback-opening', { error: String(err), userId, scenarioId });
    narrative = scenario.opening_narration;
  }

  watchKeywords({ text: narrative, direction: 'character_reply', userId, characterId, conversationId });

  const { data: messageRow } = await supabaseAdmin
    .from('messages')
    .insert({ conversation_id: conversationId, role: 'assistant', content: narrative, tokens_used: tokensUsed })
    .select('id')
    .single();

  await supabaseAdmin.from('roleplay_beats').insert({
    session_id:  session.id,
    user_id:     userId,
    message_id:  messageRow?.id ?? null,
    beat_number: 1,
    chapter:     1,
    beat_type:   'narration',
    narrator_text: narrative,
    choices:     null,
  });

  await supabaseAdmin
    .from('roleplay_sessions')
    .update({ beat_count: 1, updated_at: new Date().toISOString() })
    .eq('id', session.id);

  return {
    conversationId,
    turn: {
      sessionId:    session.id,
      status:        'active',
      chapter:       1,
      chapterCount:  scenario.chapter_count,
      beatNumber:    1,
      narrative,
      choices:       null,
      isChapterEnd:  false,
      isSessionComplete: false,
    },
  };
}

// ── Public: advance one beat ─────────────────────────────────────────────────

export async function advanceTurn(params: {
  userId: string;
  tier: Tier;
  sessionId: string;
  actionType: RoleplayActionType;
  text: string;
}): Promise<RoleplayTurnResult> {
  const { userId, tier, sessionId, actionType, text } = params;

  const trimmed = text.trim();
  if (!trimmed) throw new RoleplayError('Tell them what you do or say', 'VALIDATION_ERROR', 400);
  if (trimmed.length > 800) throw new RoleplayError('That action is a little long — try trimming it down', 'VALIDATION_ERROR', 400);

  const { data: sessionRow } = await supabaseAdmin
    .from('roleplay_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!sessionRow) throw new RoleplayError('Story session not found', 'SESSION_NOT_FOUND', 404);
  const session = sessionRow as RoleplaySession;

  if (session.status !== 'active') {
    throw new RoleplayError('This story has already ended', 'SESSION_NOT_ACTIVE', 409);
  }

  const scenario = await getScenario(session.scenario_id);
  if (!scenario) throw new RoleplayError('Story not found', 'SCENARIO_NOT_FOUND', 404);

  const character = await loadCharacter(session.character_id);

  // ── Safety first, same as freeform chat: crisis check before anything
  // else, doesn't consume quota, never reaches the model. ──────────────────
  const crisisCheck = detectCrisisSignal(trimmed);
  if (crisisCheck.level === 'detected') {
    logCrisisEvent({
      userId, characterId: session.character_id, conversationId: session.conversation_id,
      category: crisisCheck.category!, messageExcerpt: trimmed,
    });
    return {
      sessionId: session.id, status: session.status, chapter: session.current_chapter,
      chapterCount: scenario.chapter_count, beatNumber: session.beat_count,
      narrative: buildCrisisReply(), choices: null, isChapterEnd: false, isSessionComplete: false,
    };
  }

  // ── Rate limiting — a roleplay beat costs the same as one chat message. ──
  const [burst, daily] = await Promise.all([
    checkChatLimit(userId, tier),
    checkDailyMessageCap(userId, tier),
  ]);
  if (!burst.allowed) throw new RoleplayError('Slow down a little — try again in a moment', 'RATE_LIMIT_EXCEEDED', 429);
  if (!daily.allowed) throw new RoleplayError('You\'ve reached today\'s message limit', 'DAILY_CAP_REACHED', 403);

  const safeText = sanitize(trimmed);
  watchKeywords({ text: safeText, direction: 'user_message', userId, characterId: session.character_id, conversationId: session.conversation_id });

  // ── Recent history for continuity, oldest first ──────────────────────────
  const { data: recentMessages } = await supabaseAdmin
    .from('messages')
    .select('role, content')
    .eq('conversation_id', session.conversation_id)
    .order('created_at', { ascending: false })
    .limit(BEAT_HISTORY_LIMIT);

  const history = (recentMessages ?? [])
    .reverse()
    .map(m => ({ role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.content }));

  const isFinalChapter = session.current_chapter >= scenario.chapter_count;
  const systemPrompt = buildSystemPrompt(
    character, scenario, session.scene_state, session.current_chapter, session.status, false, isFinalChapter,
  );

  const formattedAction = formatUserAction(actionType, safeText);

  const traceId = randomUUID();
  const ctx = await orchestrator.prepare({
    userId, tier, characterId: session.character_id, conversationId: session.conversation_id,
    traceId, modelTier: modelTierForPlan(tier),
  });
  const inferResult = await orchestrator.infer(ctx, [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: formattedAction },
  ]);
  await orchestrator.finish(ctx, inferResult);

  const parsed = parseRoleplayOutput(stripLeakedMeta(inferResult.reply));
  const narrative = parsed.narrative || '*The moment holds a beat longer, as if waiting for you.*';

  watchKeywords({ text: narrative, direction: 'character_reply', userId, characterId: session.character_id, conversationId: session.conversation_id });

  // ── Persist both sides of the exchange in the same message thread
  // freeform chat uses, so leaving Story Mode never loses continuity. ──────
  await supabaseAdmin.from('messages').insert({
    conversation_id: session.conversation_id, role: 'user', content: safeText,
  });
  const { data: assistantMessage } = await supabaseAdmin
    .from('messages')
    .insert({ conversation_id: session.conversation_id, role: 'assistant', content: narrative, tokens_used: inferResult.tokensUsed })
    .select('id')
    .single();

  // ── Chapter-end detection: trust the model's [[CHAPTER_END]] marker,
  // with a hard cap as a safety net if it never emits one. ─────────────────
  const { count: beatsInChapter } = await supabaseAdmin
    .from('roleplay_beats')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', session.id)
    .eq('chapter', session.current_chapter);

  const isChapterEnd = parsed.isChapterEnd || ((beatsInChapter ?? 0) + 1 >= MAX_BEATS_PER_CHAPTER);

  let choices = parsed.choices;
  if (isChapterEnd && !isFinalChapter && !choices) choices = fallbackChapterChoices();
  if (isFinalChapter && isChapterEnd) choices = null; // story is wrapping up, not branching further

  const nextBeatNumber = session.beat_count + 1;
  let nextChapter   = session.current_chapter;
  let newStatus: RoleplaySessionStatus = 'active';
  let completedAt: string | null = null;

  if (isChapterEnd) {
    if (isFinalChapter) {
      newStatus   = 'completed';
      completedAt = new Date().toISOString();
    } else {
      nextChapter = session.current_chapter + 1;
    }
  }

  const updatedSceneState = appendEstablishedFact(session.scene_state, narrative);

  await supabaseAdmin.from('roleplay_beats').insert({
    session_id:  session.id,
    user_id:     userId,
    message_id:  assistantMessage?.id ?? null,
    beat_number: nextBeatNumber,
    chapter:     session.current_chapter,
    beat_type:   isChapterEnd ? 'chapter_end' : 'narration',
    narrator_text: narrative,
    action_type: actionType,
    choices: choices as unknown as Json,
    choice_selected: actionType === 'choice' ? safeText : null,
  });

  await supabaseAdmin
    .from('roleplay_sessions')
    .update({
      current_chapter: nextChapter,
      beat_count:       nextBeatNumber,
      status:           newStatus,
      scene_state:      updatedSceneState as unknown as Json,
      last_cliffhanger: isChapterEnd && newStatus === 'active' ? narrative.slice(-280) : session.last_cliffhanger,
      completed_at:     completedAt,
      updated_at:       new Date().toISOString(),
    })
    .eq('id', session.id);

  if (newStatus === 'completed') {
    await supabaseAdmin
      .from('conversations')
      .update({ roleplay_mode: false })
      .eq('id', session.conversation_id)
      .eq('roleplay_session_id', session.id);
  }

  // ── Retention hooks — fire-and-forget, never block the response on these. ──
  void fireRetentionHooks({
    userId, characterName: character.name, scenarioTitle: scenario.title,
    conversationId: session.conversation_id, sessionId: session.id,
    isChapterEnd, isComplete: newStatus === 'completed', narrative,
  });

  return {
    sessionId: session.id,
    status:     newStatus,
    chapter:    nextChapter,
    chapterCount: scenario.chapter_count,
    beatNumber: nextBeatNumber,
    narrative,
    choices,
    isChapterEnd,
    isSessionComplete: newStatus === 'completed',
  };
}

/**
 * XP + notification on chapter/story completion. Intentionally immediate
 * (fires the moment a chapter ends), not a scheduled "come back tomorrow"
 * nudge — that would belong in src/lib/notifications/nudge.ts's cron-driven
 * getEligibleNudges()/generateNudges() pipeline alongside the existing
 * dating nudges, which is the natural v2 extension point but out of scope
 * here (see summary).
 */
async function fireRetentionHooks(params: {
  userId: string; characterName: string; scenarioTitle: string;
  conversationId: string; sessionId: string;
  isChapterEnd: boolean; isComplete: boolean; narrative: string;
}): Promise<void> {
  const { userId, characterName, scenarioTitle, conversationId, isComplete, isChapterEnd, narrative } = params;
  if (!isChapterEnd) return;

  try {
    if (isComplete) {
      await awardXp(userId, STORY_COMPLETE_XP, 'roleplay_story_complete');
      await emitNotification({
        userId, type: 'story_cliffhanger', urgency: 'low',
        title: `"${scenarioTitle}" — The End`,
        body: `Your story with ${characterName} just concluded. Start a new one anytime.`,
        ctaUrl: `/chat/${conversationId}`,
      });
    } else {
      await awardXp(userId, CHAPTER_COMPLETE_XP, 'roleplay_chapter_complete');
      await emitNotification({
        userId, type: 'story_cliffhanger', urgency: 'low',
        title: `${characterName} is waiting to continue "${scenarioTitle}"`,
        body: narrative.length > 120 ? `${narrative.slice(0, 117)}...` : narrative,
        ctaUrl: `/chat/${conversationId}`,
      });
    }
  } catch (err) {
    logger.warn('roleplay:retention-hooks-failed', { error: String(err), userId });
  }
}

// ── Public: end a story early ────────────────────────────────────────────────

export async function abandonSession(params: { userId: string; sessionId: string }): Promise<void> {
  const { userId, sessionId } = params;

  const { data: session } = await supabaseAdmin
    .from('roleplay_sessions')
    .select('id, status, conversation_id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!session) throw new RoleplayError('Story session not found', 'SESSION_NOT_FOUND', 404);
  if (session.status !== 'active') return;

  await supabaseAdmin
    .from('roleplay_sessions')
    .update({ status: 'abandoned', updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  await supabaseAdmin
    .from('conversations')
    .update({ roleplay_mode: false })
    .eq('id', session.conversation_id)
    .eq('roleplay_session_id', sessionId);
}
