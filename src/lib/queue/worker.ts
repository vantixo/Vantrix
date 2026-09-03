/**
 * Queue Worker — Performance-hardened v2
 *
 * Changes in this revision:
 *
 *   W1: Parallel context loading
 *     Character + conversation history + full context (psychology, memory,
 *     lore, etc.) now load in a single Promise.all() instead of two sequential
 *     steps. Saves one DB round-trip (~5-15ms) per job.
 *
 *   W2: Session bridge + voice fingerprint + fact graph
 *     Workers now inject all three enrichment layers (same parity as the sync
 *     chat route). Previously these were missing from queued requests.
 *
 *   W3: Post-job enrichment fire-and-forget
 *     Psychology update, XP, streak, memory update, and fact extraction
 *     now run fire-and-forget after orchestrator.finish(), matching the sync
 *     route. Previously the worker did none of this.
 *
 *   W4: Billing DLQ fallback
 *     orchestrator.finish() failure now enqueues to billing DLQ instead of
 *     silently losing tokens.
 *
 * Previous fixes (unchanged):
 *   CRIT-2: supabaseAdmin (not createClient) throughout
 *   CRIT-3: decrement only on terminal paths
 *   CRIT-4: assembleFullPrompt with all 8 context layers
 *   DATING-1: dating context overlay
 */

import { after } from 'next/server';
import {
  dequeueNextJob, writeJobResult, requeueJob,
  acquireUserLock, releaseUserLock, decrementUserPendingCount,
  releaseJobLease, LEASE_MS,
  type ChatJob,
} from './index';
import { orchestrator }              from '@/lib/ai/orchestrator';
import { trimHistoryForPlan,
         historyLimitForTier }        from '@/lib/ai/token-budget';
import { assembleFullPrompt }        from '@/lib/ai/prompt';
import { resolveLanguageState }      from '@/lib/ai/language-engine';
import { planResponse, formatPlanForPrompt } from '@/lib/ai/response-planner';
import { NEUTRAL_EMOTION }           from '@/lib/ai/emotion-engine';
import { assembleDatingPrompt,
         type DatingPromptContext,
         type CharacterMood,
         type MatchTier }             from '@/lib/dating/engine';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { sanitize }                  from '@/lib/sanitize';
import { normalizeTier, checkCharacterTierAccess } from '@/lib/rate-limit';
import { checkMatureContentAccess } from '@/lib/access/character-gate';
import { logger, bg }                    from '@/lib/logger';
import { BgLedgerGroup }                 from '@/lib/observability/bg-ledger';
import { getPsychology,
         applyPsychologyEvent,
         detectAbsenceEvent }         from '@/lib/ai/attachment-engine';
import { ensureRelationship,
         addRelationshipXp }          from '@/lib/ai/relationship-engine';
import { getMemoryGraph,
         getDiscoveredLore,
         shouldRevealLore,
         recordLoreDiscovery,
         maybeRecordFirstMeeting,
         generateAmbitionUpdate }     from '@/lib/ai/memory-graph';
import { getMemory, updateMemory,
         formatMemoryForPrompt }      from '@/lib/ai/memory';
import { getEvolutionStage,
         getDynamicInterests,
         computeSessionDrift }        from '@/lib/ai/personality-evolution';
import { detectEvolutionSignal,
         detectHabitSignal,
         recordEvolutionSignal,
         getEvolutionTraits,
         formatEvolutionTraitsForPrompt } from '@/lib/ai/bidirectional-evolution';
import { getSessionBridge,
         updateSessionBridge }        from '@/lib/ai/session-bridge';
import { getOrInitFingerprint,
         formatVoiceFingerprintForPrompt } from '@/lib/ai/voice-fingerprint';
import { getOrInitIdentityCore,
         maybeRefreshIdentityCore,
         formatIdentityCoreForPrompt }     from '@/lib/ai/identity-core';
import { extractAndStoreFacts,
         getFactGraph,
         formatFactGraphForPrompt }   from '@/lib/ai/user-fact-graph';
import { getPriorityMemories }        from '@/lib/ai/priority-memory';
import { getCharacterSeedMemories }   from '@/lib/ai/character-seed-memory';
import { scheduleMemoryTest, MIN_EXCHANGES_BEFORE_TEST } from '@/lib/ai/memory-test-engine';
import { enqueueBillingRetry }        from '@/lib/ai/billing-dlq';
import { getUnifiedMind, formatMindForPrompt } from '@/lib/mind/unified-mind';
import { checkStreak, progressQuest,
         awardXp }                    from '@/lib/growth/streak-rewards-engine';

// ── Public: process one job from the queue ────────────────────────────────────

export async function processNextJob(): Promise<boolean> {
  const job = await dequeueNextJob();
  if (!job) return false;

  // QUEUE-LEASE-FIX: dequeueNextJob() has already started this job's
  // processing lease (see lib/queue/index.ts). Every return path below
  // must release it — wrapping the whole post-dequeue body in try/finally
  // guarantees that even the early-return branches (stale, concurrency
  // lock) clear it, so reapExpiredLeases() doesn't later mistake a job
  // this process actually finished handling for one whose worker died.
  try {
    // Stale check
    const ageMs = Date.now() - job.enqueuedAt;
    if (ageMs > 5 * 60 * 1000) {
      await writeJobResult({
        jobId: job.id, userId: job.userId,
        status: 'failed', error: 'Job expired in queue (stale after 5 min)',
        doneAt: Date.now(),
      });
      await decrementUserPendingCount(job.userId);
      return true;
    }

    // Concurrency lock — TTL matches the job's own processing lease
    // (LEASE_MS), not a shorter fixed value. A lock TTL below the lease
    // could expire while a legitimately slow job was still running,
    // letting a second concurrent job start for the same user; see the
    // LEASE_MS comment in lib/queue/index.ts. The lock is still released
    // explicitly in the `finally` below the instant a job actually
    // finishes, so this only widens the crash-recovery window, not normal
    // per-job latency.
    const locked = await acquireUserLock(job.userId, LEASE_MS / 1000);
    if (!locked) {
      if (job.attempts < job.maxAttempts) {
        await requeueJob(job);
      } else {
        await writeJobResult({
          jobId: job.id, userId: job.userId,
          status: 'dead', error: 'Max concurrency retries exceeded',
          doneAt: Date.now(),
        });
        await decrementUserPendingCount(job.userId);
      }
      return true;
    }

    try {
      const result = await executeJob(job);
      await writeJobResult({ jobId: job.id, userId: job.userId, status: 'done', ...result, doneAt: Date.now() });
      await decrementUserPendingCount(job.userId);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Worker job failed', { jobId: job.id, userId: job.userId, error: errMsg, attempt: job.attempts });

      if (job.attempts + 1 < job.maxAttempts) {
        await requeueJob(job);
      } else {
        await writeJobResult({
          jobId: job.id, userId: job.userId, status: 'dead',
          error: `Exhausted ${job.maxAttempts} attempts. Last: ${errMsg}`,
          doneAt: Date.now(),
        });
        await decrementUserPendingCount(job.userId);
      }
    } finally {
      await releaseUserLock(job.userId);
    }

    return true;
  } finally {
    await releaseJobLease(job.id);
  }
}

// ── Private: execute one job ──────────────────────────────────────────────────

async function executeJob(job: ChatJob): Promise<{ reply: string; tokensUsed: number }> {
  const tier    = normalizeTier(job.tier);
  const traceId = `queue-${job.id}`;
  const userId  = job.userId;
  const characterId = job.characterId;

  // ── 1. Orchestrator prepare ───────────────────────────────────────────────
  const ctx = await orchestrator.prepare({ userId, tier, characterId, conversationId: job.conversationId, traceId });
  if (job.originTraceId) ctx.tracer.event('queue.origin_trace', { originTraceId: job.originTraceId, jobId: job.id });

  // ── 2. W1: Parallel load — character + history + all context ─────────────
  // Previously: character load → await → history load → await → context load
  // Now: all three in one Promise.all(), saves ~10-20ms per job.
  const historyLimit = historyLimitForTier(tier);

  const [characterResult, historyResult, contextResults, profileResult] = await Promise.all([
    // Character
    supabaseAdmin
      .from('characters')
      .select('name,description,personality,scenario,backstory,tags,age,gender,origin,occupation,values_list,fears,flaws,speech_style,current_goal,goal_progress,daily_routine,friends_list,secrets,char_openness,char_warmth,char_adventure,char_depth,is_premium,min_tier,is_nsfw')
      .eq('id', characterId)
      .single(),

    // Conversation history
    job.conversationId
      ? supabaseAdmin.from('messages').select('role,content')
          .eq('conversation_id', job.conversationId)
          .order('created_at', { ascending: true })
          .limit(historyLimit)
      : Promise.resolve({ data: [] }),

    // Full context (same as sync route)
    Promise.all([
      getPsychology(userId, characterId),
      ensureRelationship(userId, characterId),
      // FEATURE-7 parity: widened from 12 → 30, matching companion-context.ts's
      // sync route fix — same reasoning: semantic reranking needs a bigger
      // candidate pool than the final displayed slice to actually surface
      // relevant-but-lower-emotion memories.
      getMemoryGraph(userId, characterId, 30),
      getMemory(userId, characterId),
      getDiscoveredLore(userId, characterId),
      getDynamicInterests(userId, characterId),
      getFactGraph(userId, characterId),
      getSessionBridge(userId, characterId),
      // PARITY FIX: priority memories and creator-authored seed memories
      // were present in the sync chat route but missing here — a queued
      // (503-fallback) reply was missing two of the memory-engine's layers
      // versus a synchronously-streamed one.
      getPriorityMemories(userId, characterId, { limit: 12 }),
      getCharacterSeedMemories(characterId, 8),
      getEvolutionTraits(userId, characterId),
    ]),

    // User's self-reported gender and response-language preference — so the
    // character can address/understand them naturally and reply in the
    // right language (see lib/ai/prompt.ts describeUserGender() and
    // lib/ai/language-engine.ts).
    supabaseAdmin.from('profiles').select('gender,preferred_language').eq('id', userId).single(),
  ]);

  const character = characterResult.data;
  if (!character) throw new Error(`Character ${characterId} not found`);

  const premiumGate = checkCharacterTierAccess(
    tier,
    (character as Record<string, unknown>).min_tier as typeof tier | null | undefined,
    !!(character as Record<string, unknown>).is_premium,
  );
  if (!premiumGate.allowed) {
    throw new Error(`PREMIUM_CHARACTER_REQUIRED: ${premiumGate.reason ?? 'character requires a higher plan'}`);
  }

  // SEC: the enqueue route checks mature-content access at submit time,
  // but a queued job can execute seconds to minutes later — long enough
  // for a user to flip nsfw_enabled off, or for age-verification status
  // to change. Recheck here at execution time, the same way premiumGate
  // above is already rechecked rather than trusted from enqueue.
  const matureGate = await checkMatureContentAccess(
    userId,
    !!(character as Record<string, unknown>).is_nsfw,
    tier,
  );
  if (!matureGate.allowed) {
    throw new Error(`MATURE_CONTENT_BLOCKED: ${matureGate.reason ?? 'mature content is currently unavailable'}`);
  }

  const rawHistory = (historyResult.data ?? []) as { role: string; content: string }[];
  const history    = trimHistoryForPlan(rawHistory, tier);

  const [
    psychology, relationship, memoryGraph, memoryFacts,
    discoveredLore, dynamicInterests, factGraph, sessionBridge,
    priorityMemories, seedMemories, evolutionTraits,
  ] = contextResults;

  // ── 3. Absence detection + lore reveal ───────────────────────────────────
  const absenceEvent = detectAbsenceEvent(psychology.last_interaction);
  if (absenceEvent) after(() => applyPsychologyEvent(userId, characterId, absenceEvent).catch(bg('applyPsychologyEvent.absence')));

  let loreToReveal: string | null = null;
  let loreDiscoveryKey: string | null = null;
  if (Array.isArray(character.secrets) && character.secrets.length) {
    const reveal = shouldRevealLore(psychology.total_interactions, discoveredLore, character.secrets as string[]);
    if (reveal) {
      loreToReveal = reveal.content;
      loreDiscoveryKey = reveal.key;
      after(() => {
        recordLoreDiscovery(userId, characterId, reveal.key, reveal.content, character.name).catch(bg('recordLoreDiscovery'));
        applyPsychologyEvent(userId, characterId, 'lore_discovered').catch(bg('applyPsychologyEvent.loreDiscovered'));
      });
    }
  }

  const evolutionStage = getEvolutionStage(psychology.days_known, psychology.total_interactions);
  const evolutionTraitsPrompt = formatEvolutionTraitsForPrompt(evolutionTraits);

  // PARITY FIX: mirror chat/stream/route.ts's memory-test scheduling here too
  // — this queued (503-fallback) path builds the same seedMemories context,
  // so it should drive the same scheduleMemoryTest() side effect rather than
  // silently depending on the user's next turn happening to hit the sync path.
  if (psychology.total_interactions >= MIN_EXCHANGES_BEFORE_TEST) {
    for (const sm of seedMemories) {
      if (sm.is_testable) {
        after(() => scheduleMemoryTest(userId, characterId, sm.id).catch(bg('scheduleMemoryTest')));
      }
    }
  }

  // ── 4. Prompt assembly ────────────────────────────────────────────────────
  // Response language — parity with chat/stream/route.ts. Same
  // user+character Redis key, so smoothing state is shared across the
  // synchronous and queued (503-fallback) paths rather than each keeping
  // its own view of what language the conversation is in.
  let languagePrompt = '';
  try {
    const languageState = await resolveLanguageState(userId, characterId, job.message, profileResult.data?.preferred_language ?? null);
    languagePrompt = languageState.promptBlock;
  } catch (err) {
    logger.warn('worker: language engine failed', { userId, characterId, error: String(err) });
  }

  let systemPrompt = assembleFullPrompt({
    character,
    psychology, relationship,
    memories:         memoryGraph,
    evolutionStage,   dynamicInterests,
    evolutionTraitsPrompt,
    memoryFacts:      formatMemoryForPrompt(memoryFacts),
    loreToReveal,
    userGender:       profileResult.data?.gender ?? null,
    priorityMemories,
    seedMemories,
    languagePrompt,
  });

  // W2: Session bridge
  if (sessionBridge?.bridgePrompt) {
    systemPrompt = sessionBridge.bridgePrompt + '\n\n' + systemPrompt;
  }

  // W2: Voice fingerprint
  const fingerprint = await getOrInitFingerprint(userId, characterId, character.speech_style ?? null, psychology.total_interactions);
  if (fingerprint) {
    systemPrompt = systemPrompt + '\n\n' + formatVoiceFingerprintForPrompt(fingerprint);
  }

  // Unified Mind — single fortune/self-awareness composite across
  // character-evolution, reputation, social-graph, and belief-engine (see
  // lib/mind/unified-mind.ts). Fail-open, same tolerance as everything
  // else in this pipeline. Parity with chat/stream/route.ts's wiring —
  // queued messages previously got none of this, same gap class as the
  // roleplay-system audit found for guest/worker.
  const unifiedMind = await getUnifiedMind(userId, characterId).catch((err) => {
    logger.warn('unified-mind.getUnifiedMind failed (worker)', { userId, characterId, err });
    return null;
  });
  if (unifiedMind) {
    systemPrompt = systemPrompt + '\n\n' + formatMindForPrompt(unifiedMind);
  }

  // Identity Core — automatic self-model layer (see identity-core.ts). Parity
  // with chat/stream/route.ts's wiring.
  const identityCore = await getOrInitIdentityCore(
    userId, characterId,
    character as unknown as Parameters<typeof getOrInitIdentityCore>[2],
    psychology,
  );
  if (identityCore) {
    systemPrompt = systemPrompt + '\n\n' + formatIdentityCoreForPrompt(identityCore);
    after(() => maybeRefreshIdentityCore(
      userId, characterId,
      character as unknown as Parameters<typeof getOrInitIdentityCore>[2],
      psychology,
      {
        memoryHighlights:  memoryGraph.slice(0, 6).map(m => `${m.title}: ${m.description}`),
        priorityHeadlines: priorityMemories.slice(0, 6).map(m => m.headline),
        dynamicInterests,
      },
    ).catch(bg('maybeRefreshIdentityCore')));
  }

  // W2: User fact graph
  const factGraphPrompt = formatFactGraphForPrompt(factGraph);
  if (factGraphPrompt) systemPrompt = systemPrompt + '\n\n' + factGraphPrompt;

  // ── 5. Dating overlay ─────────────────────────────────────────────────────
  if (job.datingMode && job.matchId) {
    try {
      const { data: match } = await supabaseAdmin
        .from('dating_matches')
        .select('bond_score,match_tier,character_mood,streak_days,milestones')
        .eq('id', job.matchId).eq('user_id', userId)
        .single();

      if (match) {
        const milestoneFlagMap: Record<string, number> = { soulmate: 16, week_streak: 8, first_gift: 4, deep_talk: 2, first_chat: 1 };
        const recentMilestone = Object.entries(milestoneFlagMap).find(([, f]) => (match.milestones ?? 0) & f)?.[0];
        const { data: gifts } = await supabaseAdmin
          .from('dating_gifts')
          .select('gift_name,created_at')
          .eq('match_id', job.matchId)
          .order('created_at', { ascending: false })
          .limit(1);
        const datingCtx: DatingPromptContext = {
          characterName: character.name,
          matchTier:     (match.match_tier as MatchTier) ?? 'spark',
          bondScore:     match.bond_score ?? 0,
          characterMood: (match.character_mood as CharacterMood) ?? 'happy',
          streakDays:    match.streak_days ?? 0,
          lastGiftName:  gifts?.[0]?.gift_name,
          recentMilestone,
        };
        systemPrompt = assembleDatingPrompt(systemPrompt, datingCtx);
      }
    } catch (err) {
      logger.warn('Worker: dating context failed, using base prompt', { jobId: job.id, error: String(err) });
    }
  }

  // ── 5.5 Response planner: separate think-before-you-speak stage ─────────
  // Worker path has no per-turn emotion detection (see W1 context load
  // above), so it plans against NEUTRAL_EMOTION — consistent with this
  // already being the degraded/overload path that also omits
  // emotionInstructions from assembleFullPrompt() above. Fails open
  // internally, never blocks the job.
  const plan = await planResponse({
    characterName:    character.name,
    characterSummary: [character.personality, character.occupation, character.current_goal]
      .filter(Boolean).join(' — ').slice(0, 400),
    recentMessages:   history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    emotion:          NEUTRAL_EMOTION,
    relationshipStage: relationship?.stage,
    traceId,
  });
  systemPrompt = systemPrompt + formatPlanForPrompt(plan);

  const messagesPayload = [
    { role: 'system'    as const, content: systemPrompt },
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user'      as const, content: sanitize(job.message) },
  ];

  // ── 6. Infer ──────────────────────────────────────────────────────────────
  const result = await orchestrator.infer(ctx, messagesPayload);
  const { reply, tokensUsed } = result;

  // ── 7. Persist messages ───────────────────────────────────────────────────
  if (job.conversationId) {
    await Promise.all([
      supabaseAdmin.from('messages').insert([
        { conversation_id: job.conversationId, role: 'user',      content: sanitize(job.message) },
        { conversation_id: job.conversationId, role: 'assistant', content: reply },
      ]),
      supabaseAdmin.from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', job.conversationId),
    ]);
  }

  // ── 8. W4: Billing with DLQ fallback ─────────────────────────────────────
  try {
    await orchestrator.finish(ctx, result);
  } catch (finishErr) {
    logger.error('Worker: orchestrator.finish failed — enqueuing DLQ', {
      userId, tokensUsed, traceId,
      error: finishErr instanceof Error ? finishErr.message : String(finishErr),
    });
    await enqueueBillingRetry(userId, tokensUsed, traceId);
  }

  // ── 9. W3: Post-job enrichment (all fire-and-forget, but wrapped in
  // after() — the route awaits Promise.allSettled() over all jobs in the
  // batch before responding, so without after() these races the route's
  // response exactly like the sync/streaming chat routes did. See ARCH-04.
  //
  // LEDGER: every task below is tracked through a BgLedgerGroup instead of
  // the bare `.catch(bg(label))` this block used previously. Behavior is
  // identical (immediate fire-and-forget, failure logged, never thrown) —
  // group.flush() additionally persists all outcomes to bg_task_ledger in
  // one batched RPC call so failures here are queryable, not just grep-able.
  // See src/lib/observability/bg-ledger.ts. This also brings the two RPC
  // calls below (apply_personality_drift, increment_daily_messages) under
  // the same failure visibility — previously both were fired with a bare
  // `void`, so a failing drift update or message-count increment produced
  // no log line and no trace anywhere.
  after(async () => {
    const group = new BgLedgerGroup();

    const sessionCount = rawHistory.length;
    const isLong       = sessionCount >= 30;
    const positive      = /thank|love|miss|happy|great|amazing/i.test(job.message);

    group.track('applyPsychologyEvent.baseline', applyPsychologyEvent(userId, characterId, isLong ? 'long_session' : 'message_sent'));
    if (positive) group.track('applyPsychologyEvent.compliment', applyPsychologyEvent(userId, characterId, 'compliment'));
    group.track('addRelationshipXp', addRelationshipXp(userId, characterId, isLong ? 'long_session' : 'message_sent'));
    group.track('maybeRecordFirstMeeting', maybeRecordFirstMeeting(userId, characterId, character.name));
    group.track('updateMemory', updateMemory(userId, characterId, character.name, job.message, reply, sessionCount + 1));
    group.track('extractAndStoreFacts', extractAndStoreFacts(userId, characterId, job.message, reply, sessionCount + 1));

    const evolutionSignal = detectEvolutionSignal(job.message);
    if (evolutionSignal) group.track('recordEvolutionSignal', recordEvolutionSignal(userId, characterId, evolutionSignal));
    const habitSignal = detectHabitSignal(new Date().getHours(), job.message);
    if (habitSignal) group.track('recordEvolutionSignal.habit', recordEvolutionSignal(userId, characterId, habitSignal));

    if ((sessionCount + 1) % 10 === 0) {
      const drift = computeSessionDrift(psychology.days_known, psychology.total_interactions, sessionCount + 1, positive);
      group.track('applyPersonalityDrift', Promise.resolve(supabaseAdmin.rpc('apply_personality_drift', {
        p_user_id: userId, p_character_id: characterId,
        p_openness: Math.round(drift.openness), p_warmth: Math.round(drift.warmth),
        p_confidence: Math.round(drift.confidence),
      })));
    }

    group.track('checkStreak', checkStreak(userId));
    group.track('progressQuest.messages', progressQuest(userId, 'messages', 1));
    if (isLong) group.track('progressQuest.longSession', progressQuest(userId, 'long_session', 1));
    group.track('awardXp', awardXp(userId, isLong ? 25 : 2, isLong ? 'long_session' : 'message_sent'));
    group.track('incrementDailyMessages', Promise.resolve(supabaseAdmin.rpc('increment_daily_messages', { p_user_id: userId })));

    if (job.conversationId) {
      const allMessages = [
        ...rawHistory,
        { role: 'user', content: job.message },
        { role: 'assistant', content: reply },
      ];
      group.track('updateSessionBridge', updateSessionBridge(userId, characterId, job.conversationId, allMessages));
    }

    if (character.current_goal) {
      group.track('generateAmbitionUpdate', generateAmbitionUpdate(userId, characterId, character.name, character.current_goal, character.goal_progress ?? 0));
    }

    await group.flush({ userId });
  });

  return {
    reply, tokensUsed,
    // JOURNEY-GAP-FIX parity with chat/stream/route.ts: without this, a
    // message sent via the queue fallback (network hiccup on the primary
    // SSE path) would silently never render the world-reference tap chip,
    // permanently undercounting worldReferenceTappedCount for exactly the
    // users whose connection is flaky enough to hit this path most often.
    ...(loreToReveal ? { loreReveal: { key: loreDiscoveryKey!, content: loreToReveal } } : {}),
  };
}
