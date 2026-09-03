/**
 * POST /api/chat/stream — Hardened SSE Streaming Chat
 *
 * Production fixes applied in this revision:
 *   S1: Session bridge injected (parity with /api/chat)
 *   S2: Voice fingerprint injected (parity with /api/chat)
 *   S3: User fact graph injected (parity with /api/chat)
 *   S4: Fact graph extracted fire-and-forget after each message
 *   S5: Session bridge updated at end of stream
 *   S6: Billing DLQ fallback for failed token writes
 *
 * Pre-existing hardening (unchanged):
 *   - AbortSignal propagation to cancel upstream on client disconnect
 *   - Stream slot guard (max concurrent SSE per user by tier)
 *   - 5-minute hard timeout
 *   - 8KB body size limit
 *   - Request deduplication (5s window)
 *   - SSE keepalive every 15s
 *   - Error sanitization
 *   - Metrics on every path
 */

import { NextRequest, after }      from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { z }                       from 'zod';
import { supabaseAdmin }           from '@/lib/supabase/admin';
import { detectCrisisSignal, logCrisisEvent } from '@/lib/safety/crisis-detection';
import { buildCrisisReply, buildCrisisReplyShort } from '@/lib/safety/crisis-response';
import { guardReply, stripLeakedMeta, looksLikePotentialMetaLeakPrefix } from '@/lib/moderation/reply-guard';
import { watchKeywords } from '@/lib/moderation/keyword-watch';
import { getRuptureState, evaluateRepair, markRuptureRaised } from '@/lib/ai/repair-engine';
import { computeTrustState } from '@/lib/ai/trust-engine';
import { buildFamilyContext } from '@/lib/ai/family-engine';
import { computeCompatibilityState } from '@/lib/ai/compatibility-engine';
import { computeChemistryState } from '@/lib/ai/chemistry-engine';
import { computeAttractionState } from '@/lib/ai/attraction-engine';
import { computeLoveLanguageState } from '@/lib/ai/love-language-engine';
import { computeVulnerabilityState } from '@/lib/ai/vulnerability-engine';
import { computeEmotionalSafetyState } from '@/lib/ai/emotional-safety-engine';
import { computeAttachmentSecurityState } from '@/lib/ai/attachment-security-engine';
import { computeTrustRepairState } from '@/lib/ai/trust-repair-engine';
import { computeIntimacyState } from '@/lib/ai/intimacy-engine';
import { computeCrushState } from '@/lib/ai/crush-engine';
import { computeInfatuationState } from '@/lib/ai/infatuation-engine';
import { computeAttachmentStyleState } from '@/lib/ai/attachment-style-engine';
import { computeLoveEvolutionState } from '@/lib/ai/love-evolution-engine';
import { computeHeartbreakState } from '@/lib/ai/heartbreak-engine';
import { computeHealingState } from '@/lib/ai/healing-engine';
import { computeClosureState } from '@/lib/ai/closure-engine';
import type { RepairResult } from '@/lib/ai/repair-engine';
import { checkChatLimit,
         resolveEffectiveTier,
         checkCharacterTierAccess,
         checkDailyMessageCap,
         checkPerCharacterMessageCap }   from '@/lib/rate-limit';
import { checkMatureContentAccess } from '@/lib/access/character-gate';
import { sanitize }                from '@/lib/sanitize';
import { logger, bg }               from '@/lib/logger';
import { costGuard }               from '@/lib/ai/cost-guard';
import { orchestrator }            from '@/lib/ai/orchestrator';
import { assembleCompanionContext } from '@/lib/ai/companion-context';
import { routeStream }             from '@/lib/ai/provider-router';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/ai/model-router';
import { updateMemory }            from '@/lib/ai/memory';
import { trimHistoryForPlan,
         historyLimitForTier }     from '@/lib/ai/token-budget';
import { assembleFullPrompt, type CharacterData } from '@/lib/ai/prompt';
import { resolveLanguageState } from '@/lib/ai/language-engine';
import { semanticRerankMemories, retrieveRelevantMemories }  from '@/lib/ai/semantic-memory';
import { planResponse, formatPlanForPrompt, NEUTRAL_PLAN } from '@/lib/ai/response-planner';
import { applyPsychologyEvent,
         detectAbsenceEvent }      from '@/lib/ai/attachment-engine';
import { addRelationshipXp,
         checkAndApplyExtraMilestones }       from '@/lib/ai/relationship-engine';
import { maybeRecordFirstMeeting,
         shouldRevealLore,
         recordLoreDiscovery,
         generateAmbitionUpdate,
         maybeRecordEmotionalMemory }   from '@/lib/ai/memory-graph';
import { getEvolutionStage,
         computeSessionDrift }     from '@/lib/ai/personality-evolution';
import { detectEvolutionSignal,
         detectHabitSignal,
         recordEvolutionSignal,
         formatEvolutionTraitsForPrompt } from '@/lib/ai/bidirectional-evolution';
import { extractPromise, recordPromise, recordSurprise } from '@/lib/ai/surprise-engine';
import {
  getOpenCuriosities, formatCuriositiesForPrompt,
  detectAndRaiseCuriosity, detectAndResolveCuriosity, formatDiscoveryForPrompt,
} from '@/lib/ai/discovery-engine';
import {
  getLearningSnapshot, pickNextFocus, formatLearningSnapshotForPrompt,
} from '@/lib/ai/learning-engine';
import {
  generateAutobiography, formatAutobiographyForPrompt,
  getCachedAutobiographyPrompt, setCachedAutobiographyPrompt,
} from '@/lib/ai/autobiography-engine';

import { detectSecretMoment, generateSecretMoment } from '@/lib/ai/secret-moments';
import { emotionEngine }           from '@/lib/ai/emotion-engine';
import { buildRomanceFragment }    from '@/lib/ai/romance-engine';
import { buildFlirtFragment, formatFlirtForPrompt }         from '@/lib/ai/flirting-engine';
import { buildComplimentFragment, formatComplimentForPrompt } from '@/lib/ai/compliment-engine';
import { buildAffectionFragment, formatAffectionForPrompt } from '@/lib/ai/affection-engine';
import { buildGiftFragment, formatGiftForPrompt, detectRecentGift } from '@/lib/ai/gift-engine';
import { GIFT_CATALOGUE } from '@/lib/dating/constants';
import { buildCareFragment, formatCareForPrompt }           from '@/lib/ai/care-engine';
import { buildComfortFragment, formatComfortForPrompt }     from '@/lib/ai/comfort-engine';
import { buildPartnershipFragment, formatPartnershipForPrompt } from '@/lib/ai/life-partnership-engine';
import { buildAgingTogetherFragment, formatAgingTogetherForPrompt } from '@/lib/ai/aging-together-engine';
import { buildLegacyFragment, formatLegacyForPrompt } from '@/lib/ai/legacy-engine';
import { getSocialStatus, getLegend } from '@/lib/universe/status-legend';
import { getCharacterAttributes } from '@/lib/universe/character-evolution';
import { getCharacterAssets } from '@/lib/universe/scarcity';
import {
  buildRelationshipHistoryTimeline, formatHistoryRecapForPrompt, logHistoryReadFailure,
} from '@/lib/ai/relationship-history-engine';
import { setEmotionState,
         emotionToPsychologyEvent,
         applyEmotionBias,
         evaluateEmotionalMemory } from '@/lib/ai/emotion-state';
import { checkStreak,
         progressQuest,
         awardXp }                 from '@/lib/growth/streak-rewards-engine';
import { recordTokensUsed }        from '@/lib/ai/spending-cap';
import { retry }                   from '@/lib/network/retry';
import { metrics }                 from '@/lib/observability';
import { emitAuthFailureEvent,
         emitRateLimitEvent }      from '@/lib/tracing';
import { updateSessionBridge }     from '@/lib/ai/session-bridge';
import { getOrInitFingerprint,
         formatVoiceFingerprintForPrompt } from '@/lib/ai/voice-fingerprint';
import { loadSelfModel, maybeDeepenSelfModel, recordSelfModelEvent } from '@/lib/ai/self-model';
import { loadTheoryOfMind } from '@/lib/ai/theory-of-mind';
import { runBeliefPipeline, processExperience, type ExperienceEvidence } from '@/lib/ai/belief-engine';
import { runReputationPipeline, recordReputationEvidence, type ReputationEvidence } from '@/lib/ai/reputation-engine';
import { getTurnSignals, recordCharacterReply } from '@/lib/ai/conversation-thread-tracker';
import { extractAndStoreFacts,
         getFactGraph }             from '@/lib/ai/user-fact-graph';
import { enqueueBillingRetry }       from '@/lib/ai/billing-dlq';
import { enqueueMessageRecovery }    from '@/lib/ai/message-dlq';
import { checkAIShield, checkLoadShedder } from '@/lib/rate-limit/ai-shield';
import { getPlatformHourlyUsage }      from '@/lib/ai/adaptive-quota';
import { getComputeBudget }            from '@/lib/ai/compute-budget';
import { advanceBelief }               from '@/lib/ai/character-revolution';
import { getClientIp }               from '@/lib/network/get-client-ip';
import { isUserSuspended }           from '@/lib/ai/anomaly-detector';
import {
  readBodyWithLimit,
  acquireStreamSlot,
  releaseStreamSlot,
  checkDeduplication,
  dedupKey,
  hashBody,
  sanitizeProviderError,
} from '@/lib/security';
import { env }                          from '@/env';
import { queueForTraining }             from '@/lib/training/queue';
import { getUnlockedTiers, computeAvailableTiers, unlockSecretTier, meetsCatastrophicStageFloor } from '@/lib/ai/secret-tier-engine';
import { getDueMemoryTest, resolveMemoryTest, gradeRecall, scheduleMemoryTest, MIN_EXCHANGES_BEFORE_TEST } from '@/lib/ai/memory-test-engine';
import { formatMindForPrompt } from '@/lib/mind/unified-mind';
import { initializeDigitalPerson }      from '@/lib/ai/digital-person-bootstrap';
import { formatWritingStyleForPrompt, WRITING_STYLE_PRESETS,
         type WritingStyleProfile }      from '@/lib/ai/writing-style';
import { formatKnowledgeForPrompt }      from '@/lib/ai/knowledge-library';
import {
  ensureCoreDesire, computeDesireBias,
  inferNudgeFromMessage, nudgeFulfillment,
} from '@/lib/ai/desire-engine';
import { ensureDefaultRelationshipGoal,
         logDecision } from '@/lib/ai/goal-engine';
import { decideIntent, planBehavior, formatIntentForPrompt, Intent,
         type CharacterState }           from '@/lib/ai/decision-engine';
import { setLongTermPlan, deriveDefaultPlan,
         selectPursuitStrategy, decideAgencyMove, applyAgencyMove, openThread,
         formatAgencyForPrompt, maybeAutoResolveThreads }  from '@/lib/ai/agency-engine';
import { maybeWriteJournalEntry,
         formatJournalForPrompt, pendingFollowUps } from '@/lib/ai/daily-journal';
import { maybeRecordThoughts,
         markThoughtsSurfaced, formatThoughtsForPrompt } from '@/lib/ai/independent-thoughts';
import { recomputeMilestones,
         formatMilestonesForPrompt, milestoneNodeIds } from '@/lib/ai/relationship-milestones';
import { rollImperfection, formatImperfectionForPrompt,
         classifyResponseWeight, computeTypingDelayMs } from '@/lib/ai/controlled-imperfection';
import { getExemplarsForSkill, inferNeededSkill,
         formatExemplarsForPrompt }      from '@/lib/ai/conversation-dataset';
import { assembleDatingPrompt, type DatingPromptContext, type CharacterMood, type MatchTier } from '@/lib/dating/engine';
import type { DriveEngineSignals } from '@/lib/ai/drive-engine';
// runExecutiveController itself is no longer called directly from this
// file — runCognitionCycle() (below) calls it internally via
// cognition/executive-controller.ts. Only the ExecutiveInput type is
// still needed here, for executiveInput's own type annotation.
import type { ExecutiveInput } from '@/lib/ai/executive-controller';
// ATTENTION-WIRE: routes the S2-S21/comfort promptBlocks through a real
// budget instead of unconditional concatenation — see the call site below
// for why this is a separate pass from executive-controller.ts's own
// routeAttention() call.
import { routeAttention, assembleRoutedPrompt, type AttentionCandidate } from '@/lib/ai/attention-router';
// COGNITION-WIRE: src/lib/cognition/ (consciousness-loop, working-memory,
// attention-engine, and this session's reasoning/metacognition/reflection
// additions) was fully built but never called from any route — every
// call in this file went straight to ai/executive-controller.ts, so
// working-memory carry-forward, attention gating, and the new
// reasoning/metacognition/reflection layers were dead code. Wired in
// below, replacing the direct runExecutiveController() call with the
// cognition layer's wrapper so the rest of this file gets carry-forward
// "what's still on her mind" for free. See each call site's comment for
// what's real vs still a documented gap.
import {
  runCognitionCycle, reportCognitionOutcome, type ResolutionNote,
  recordBeliefs, markBeliefsUsed, formatBeliefsForPrompt,
  type BeliefEvidence, type BeliefCategory,
  composeMonologue, peekWorkingMemory,
  recordExperience, getRecentExperiences, reinforceLessons, synthesizeWisdom,
} from '@/lib/cognition/cognition-engine';
import type { AttentionSignal } from '@/lib/cognition/attention-engine';
import { reason as reasonAboutConflicts, type Claim } from '@/lib/cognition/reasoning-engine';
import { recordOutcome as recordMetacognitionOutcome, checkStall } from '@/lib/cognition/metacognition';
import { reflectOnTurn } from '@/lib/cognition/reflection-engine';
// COGNITION-WIRE (session 2): belief-engine.ts (durable, decaying,
// conflict-aware user beliefs) and internal-monologue.ts/private-thoughts.ts
// (structured, leak-risk-aware thought stream) were built but never called
// from this route — wired in below, same "additive, fails open" posture
// as every other COGNITION-WIRE addition. Read path: getActiveBeliefs()
// feeds both formatBeliefsForPrompt() (S3b) and composeMonologue() (S3c).
// Write path: recordBeliefs() is chained after extractAndStoreFacts() (S4)
// so freshly extracted facts get reconciled into the belief store the
// same turn they're extracted, rather than needing a second pass. All
// pulled in through cognition-engine.ts's facade, per that file's own
// "callers outside src/lib/cognition/ should import from here" rule.

export const dynamic = 'force-dynamic';

const MAX_STREAM_MS  = 5 * 60 * 1000;
const KEEPALIVE_MS   = 15_000;
const MAX_BODY_BYTES = 8 * 1024;

// DB-ROUNDTRIP-FIX: single column list for the one `characters` fetch this
// route now performs per request (previously fetched twice — a narrow
// "gate" select up front, then this same wider list again ~140 lines later
// for the generation context). The gate columns (id, is_premium, min_tier,
// is_nsfw, active) are a subset of this list, so one fetch now serves both
// the early tier/mature/existence gate and the downstream companion-context
// assembly. Column list unchanged from the original generation-context
// query — just fetched once instead of twice.
const CHARACTER_ROW_SELECT =
  'id,name,description,personality,scenario,backstory,tags,age,gender,origin,occupation,values_list,fears,flaws,speech_style,current_goal,goal_progress,daily_routine,friends_list,secrets,char_openness,char_warmth,char_adventure,char_depth,is_premium,min_tier,is_nsfw,active,creator_id,brain_initialized,category,archetype,writing_style,voice_profile';

interface CharacterRow {
  id: string;
  name: string;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  backstory: string | null;
  tags: string[] | null;
  age: number | null;
  gender: string | null;
  origin: string | null;
  occupation: string | null;
  values_list: string[] | null;
  fears: string[] | null;
  flaws: string[] | null;
  speech_style: string | null;
  current_goal: string | null;
  goal_progress: number | null;
  daily_routine: string | null;
  friends_list: string[] | null;
  secrets: string[] | null;
  char_openness: number | null;
  char_warmth: number | null;
  char_adventure: number | null;
  char_depth: number | null;
  is_premium: boolean | null;
  min_tier: string | null;
  is_nsfw: boolean | null;
  active: boolean | null;
  creator_id: string | null;
  brain_initialized: boolean | null;
  category: string | null;
  archetype: string | null;
  writing_style: string | null;
  voice_profile: string | null;
}

const chatSchema = z.object({
  message:        z.string().min(1).max(4000),
  characterId:    z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  datingMode:     z.boolean().optional().default(false),
  matchId:        z.string().uuid().optional(),
  sessionCount:   z.number().int().min(0).max(10_000).optional().default(0),
});

function jsonErr(msg: string, status: number, code?: string): Response {
  return new Response(JSON.stringify({ error: msg, ...(code ? { code } : {}) }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  const traceId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  const ip      = getClientIp(req);
  const start   = Date.now();

  // ── Body size guard ───────────────────────────────────────────────────────
  const bodyResult = await readBodyWithLimit(req, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return jsonErr(
      bodyResult.reason === 'too_large' ? 'Request body too large' : 'Invalid JSON',
      400,
    );
  }

  const parsed = chatSchema.safeParse(bodyResult.body);
  if (!parsed.success) return jsonErr('Invalid request', 400);
  const { message, characterId, conversationId, datingMode, matchId, sessionCount } = parsed.data;

  // Stream slot guard is scoped per-conversation (falling back to
  // per-character when this is the first message and no conversationId
  // exists yet) — see security.ts acquireStreamSlot/releaseStreamSlot.
  const streamScopeId = conversationId ?? characterId;

  // ── Emotion detection (28-state, pure in-process — zero added latency) ──
  const detectedEmotion = emotionEngine.detectFromText(message);

  // ── Pre-auth shield ──────────────────────────────────────────────────────
  if (await checkAIShield(ip)) {
    return jsonErr('Too many requests', 429);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { supabase, user } = await getAuthedUser();
  if (!user) {
    after(() => emitAuthFailureEvent({ traceId, reason: 'no user', route: '/api/chat/stream', ip: ip ?? undefined }).catch(bg('emitAuthFailureEvent')));
    return jsonErr('Unauthorized', 401, 'UNAUTHORIZED');
  }
  const userId = user.id;

  // ── Crisis detection — must run before ANY other pipeline work ──────────
  // Deliberately placed here: before stream-slot acquisition, before the
  // anomaly-suspension gate, before memory retrieval, before any model
  // routing. A crisis-flagged message must never reach decision-engine or
  // an in-character LLM reply — see src/lib/safety/crisis-detection.ts and
  // crisis-response.ts for why this is a fixed template, not a generation.
  const crisisCheck = detectCrisisSignal(message);
  if (crisisCheck.level === 'detected') {
    logCrisisEvent({
      userId,
      characterId: characterId ?? null,
      conversationId: conversationId ?? null,
      category: crisisCheck.category!,
      messageExcerpt: message,
    });

    // Still persist the real turn so the conversation reads coherently if
    // the user continues — same fire-and-forget pattern used elsewhere in
    // this route for message persistence, deliberately NOT run through
    // applyPsychologyEvent/decideIntent/any engine layer for this turn.
    // Repeat-turn check: if the immediately preceding crisis event for this
    // conversation was recent, use the short variant (see crisis-response.ts
    // header — buildCrisisReplyShort exists specifically for this and was
    // previously never called). Single indexed-row lookup; fails open to
    // the full message on any error, which is the safer default either way
    // since it's strictly more complete, not less.
    let crisisReply = buildCrisisReply();
    if (conversationId) {
      try {
        const { data: recentCrisis } = await supabaseAdmin
          .from('crisis_events')
          .select('created_at')
          .eq('conversation_id', conversationId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (recentCrisis && (Date.now() - new Date(recentCrisis.created_at).getTime()) < 30 * 60 * 1000) {
          crisisReply = buildCrisisReplyShort();
        }
      } catch (err) {
        logger.warn('crisis: repeat-turn lookup failed, using full reply', { error: String(err) });
      }
    }
    if (conversationId) {
      // TYPECHECK FIX: supabaseAdmin's query builder is a PromiseLike, not a
      // full Promise — it only implements .then(), not .catch(). Chaining
      // .catch() straight after .then() (as before) fails `tsc --noEmit`
      // here, and isn't guaranteed by the type even where it happens to
      // work at runtime today. Promise.resolve(...) adapts the thenable
      // into a real Promise so the .catch() below is actually safe.
      Promise.resolve(
        supabaseAdmin.from('messages').insert([
          { conversation_id: conversationId, role: 'user', content: sanitize(message) },
          { conversation_id: conversationId, role: 'assistant', content: crisisReply },
        ])
      ).then(({ error }) => { if (error) logger.error('crisis: turn persist failed', { error: String(error) }); })
        .catch(bg('persistCrisisTurn'));
    }

    const enc = new TextEncoder();
    const rs  = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: crisisReply })}\n\n`));
        c.enqueue(enc.encode(`data: ${JSON.stringify({ done: true, tokensUsed: 0, model: 'crisis-fixed', crisis: true })}\n\n`));
        c.close();
      },
    });
    return new Response(rs, { headers: sseHeaders(traceId) });
  }

  // ── Anomaly-suspension gate ────────────────────────────────────────────
  // checkAnomaly() (called further down, fire-and-forget) can flag a user
  // SUSPEND on runaway/loop token abuse and writes a 24h Redis flag — but
  // until now nothing ever read that flag back, so a suspended user could
  // keep chatting normally. This is the actual enforcement point.
  if (await isUserSuspended(userId)) {
    return jsonErr(
      'Your account has been temporarily suspended for unusual usage patterns. Contact support if you believe this is an error.',
      403,
      'ACCOUNT_SUSPENDED',
    );
  }

  // ── Pre-flight: independent reads run in parallel ───────────────────────────
  // Profile fetch, platform-hourly-usage, and the dedup check share no data
  // dependency on each other (dedup only needs userId/message/characterId,
  // platform usage is global, profile is per-user) — previously these ran as
  // three sequential round-trips before a single AI token could be requested.
  // Running them together removes ~2 round-trips (redis + postgres latency)
  // from the front of every chat request.
  const bodyHash = hashBody({ message, characterId, conversationId });
  const dupKey   = dedupKey(userId, bodyHash);

  const [{ data: profile }, platformUsageRaw, isDuplicateEarly] = await Promise.all([
    supabase.from('profiles').select('tier,role,is_admin,gender,preferred_language').eq('id', userId).single(),
    getPlatformHourlyUsage().catch(() => 0),
    checkDeduplication(dupKey),
  ]);

  if (isDuplicateEarly) {
    return jsonErr('Duplicate request — please wait before retrying', 429);
  }
  if (!profile) return jsonErr('Profile not found', 404);
  const tier = resolveEffectiveTier(profile);

  // ── Compute budget — caps optional cognition-engine IO for this turn ───
  // Pure/sync, reuses platformUsageRaw already fetched above for the load
  // shedder (no extra Redis call). See compute-budget.ts's header for why
  // only legacy-engine.ts / memory-test-engine.ts are gated — every other
  // cognition engine is cheap, synchronous, and load-bearing for prompt
  // assembly, so throttling it would risk more than it saves.
  const computeBudget = getComputeBudget({ tier, platformUsage: platformUsageRaw });

  // ── Platform load shedder — after tier is known ────────────────────────
  const PLATFORM_HOURLY_BUDGET_STREAM = env.PLATFORM_HOURLY_TOKEN_BUDGET;
  const platformUsagePct = PLATFORM_HOURLY_BUDGET_STREAM > 0
    ? (platformUsageRaw / PLATFORM_HOURLY_BUDGET_STREAM) * 100
    : 0;
  if (await checkLoadShedder(tier, platformUsagePct)) {
    // SLOT-LEAK-FIX: no releaseStreamSlot() call here — see the removed
    // calls throughout this pre-gate block, explained where slot
    // acquisition actually happens below (~line 488). This rejection
    // fires before this request has ever acquired a slot.
    // WIRE-FIX: this code was previously omitted, so the only signal a
    // client had for "queue this instead" vs. any other 503 (e.g. the
    // character-brain-init failure below, which retrying via the queue
    // would only reproduce) was the HTTP status alone. use-chat-stream.ts's
    // queue fallback keys off this exact code before calling
    // /api/queue/enqueue — see that hook for the other half of this wire-up.
    return jsonErr('Platform at capacity — please try again shortly', 503, 'PLATFORM_AT_CAPACITY');
  }

  // QUOTA-INTEGRITY FIX: checkDailyMessageCap/checkPerCharacterMessageCap
  // below both increment their Redis counters as part of the check itself
  // (atomic incr-then-compare). They used to run before the character was
  // even fetched — so a request against a deleted, inactive, or
  // tier/NSFW-gated character burned one of the user's daily and
  // per-character messages for a reply that would never arrive. That's
  // most damaging for exactly the users with the tightest caps: free tier
  // gets 30/day and 5/character total, so one bad request (a stale link, a
  // client retry, a character that got NSFW-gated after being bookmarked)
  // could cost 1/30 or 1/5 of a day's allotment for nothing.
  //
  // Tier/mature gate here, before either counter increments.
  //
  // DB-ROUNDTRIP-FIX (cost audit): this used to select only
  // id,is_premium,min_tier,is_nsfw,active — a "cheap, minimal-column" gate
  // query — on the stated rationale that the full character row would be
  // fetched again in the parallel load below anyway, so narrowing this one
  // wasn't worth restructuring the whole mega-parallel block. That
  // reasoning no longer holds: the full-column list selected further down
  // (~line 610, now removed) was already a strict superset of these four
  // gate columns, so the two queries were fetching the exact same row
  // twice on every single chat message for no reason — one extra Postgres
  // round trip per message, platform-wide. Selecting the full column list
  // here instead, once, and reusing this same row at every later site that
  // used to re-fetch it (`characterRow`, replacing `characterResult.data`)
  // removes that second round trip entirely without changing the
  // reject-before-rate-limit-increment ordering this block exists for.
  // PERF: populated inside the block below and reused at the later mature-gate
  // check site (~line 725) instead of calling checkMatureContentAccess twice
  // with identical arguments for the same request.
  // SLOT-LEAK-FIX (found during chat-audit, see security.ts's
  // releaseStreamSlot): this whole gate block runs *before* the
  // acquireStreamSlot() Promise.all below (~line 488) — nothing here has
  // acquired a slot for this request yet. The three rejection branches
  // below used to each call `await releaseStreamSlot(userId, streamScopeId)`
  // regardless, which is an unconditional Redis DECR on
  // `stream:slots:{userId}:{streamScopeId}` (see LUA_ACQUIRE_SLOT / the
  // plain-DECR releaseStreamSlot in security.ts) with no check that this
  // request ever held that slot.
  //
  // Exploit: streamScopeId falls back to `conversationId ?? characterId`.
  // A user with a real, in-flight stream on conversation C (slot count 1)
  // could fire a second request reusing the same conversationId but with a
  // *different*, invalid/gated characterId — e.g. a deleted character, one
  // above their tier, or an NSFW character without the flag enabled. That
  // request fails one of these three checks, hits the (now-removed)
  // releaseStreamSlot() call, and DECRs the real stream's slot back to 0 —
  // silently defeating MAX_STREAMS_PER_CONVERSATION = 1, the exact
  // same-conversation double-submit/race guard this key exists for (see
  // that constant's own comment in security.ts). A follow-up genuine
  // double-submit could then race two generations on the same conversation,
  // doubling token spend and risking duplicate/out-of-order persisted
  // messages. Fix: simply don't release a slot this request never
  // acquired — these three branches now just return.
  let cachedMatureGate: { allowed: boolean; reason?: string } | null = null;
  // DB-ROUNDTRIP-FIX: hoisted out of the gate block below (was `gateChar`,
  // block-scoped and narrow-column) so the same fetch also serves every
  // site that used to run a second, full-column `characters` query later
  // in this file (assembleCompanionContext's parallel load, the
  // ensureCoreDesire name lookup, and the post-gate `character` binding).
  let characterRow: CharacterRow | null = null;
  {
    const { data: gateChar } = await supabase
      .from('characters')
      .select(CHARACTER_ROW_SELECT)
      .eq('id', characterId)
      .maybeSingle<CharacterRow>();

    if (!gateChar || gateChar.active === false) {
      return jsonErr('Character not found', 404);
    }
    characterRow = gateChar;

    const tierGate = checkCharacterTierAccess(tier, gateChar.min_tier as typeof tier | null | undefined, !!gateChar.is_premium);
    if (!tierGate.allowed) {
      return jsonErr(tierGate.reason ?? 'This character requires a higher plan', 403);
    }

    const matureGateEarly = await checkMatureContentAccess(userId, !!gateChar.is_nsfw, tier);
    if (!matureGateEarly.allowed) {
      return jsonErr(matureGateEarly.reason ?? 'This character requires mature content to be enabled', 403);
    }
    // PERF: cache this result — the full character row fetched later in the
    // mega-parallel load has the same is_nsfw value for the same character,
    // so re-calling checkMatureContentAccess(userId, character.is_nsfw, tier)
    // further down was a guaranteed-identical, purely redundant round trip
    // on every single message. Reused at the original later gate site below.
    cachedMatureGate = matureGateEarly;
  }

  // ── Rate/cap/slot gates — run in parallel ───────────────────────────────
  // SPEED TRADEOFF (explicit, requested): checkChatLimit, checkDailyMessageCap,
  // and checkPerCharacterMessageCap each atomically increment their own Redis
  // counter as part of "checking". Run sequentially, a request that fails an
  // earlier gate never touches the later counters. Run in parallel, all three
  // increment regardless of which one (if any) rejects — so a user sitting
  // exactly at one cap's boundary can occasionally have a later counter
  // ticked for a message that never actually sent. That's a real, accepted
  // cost of removing ~2 sequential Redis round trips from every single chat
  // message. acquireStreamSlot doesn't have the same counter-drift concern
  // (it's a concurrency slot, released on every rejection path below) so it
  // rides along in the same Promise.all.
  //
  // Precedence on rejection is preserved exactly as the old sequential code:
  // rateLimit > dailyCap > perCharCap > stream slot — first met wins, so
  // client-facing error codes/messages are unchanged.
  const [rateLimit, dailyCap, perCharCap, slotAcquired] = await Promise.all([
    checkChatLimit(userId, tier),
    checkDailyMessageCap(userId, tier),
    checkPerCharacterMessageCap(userId, characterId, tier),
    acquireStreamSlot(userId, streamScopeId),
  ]);

  if (!rateLimit.allowed) {
    if (slotAcquired) await releaseStreamSlot(userId, streamScopeId);
    after(() => emitRateLimitEvent({ traceId, userId, tier, route: '/api/chat/stream', ip: ip ?? undefined }).catch(bg('emitRateLimitEvent.sliding')));
    // WIRE-FIX: this used to omit `code` and `rateLimit`, unlike the
    // non-streaming /api/chat route's equivalent response. Since both
    // routes serve the same client contract, a client that branches on
    // `code === 'RATE_LIMIT_EXCEEDED'` to show the upgrade-prompt UI
    // (rather than a generic error) would silently degrade to the generic
    // path here, only via this route.
    return new Response(JSON.stringify({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED', rateLimit, traceId }), {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil((rateLimit.reset - Date.now()) / 1000)),
        'Content-Type': 'application/json',
      },
    });
  }

  // ── Hard daily message cap (C-02) — must run before any SSE bytes are sent.
  // The non-streaming /api/chat route enforced this; the streaming route never
  // did — the only "enforcement" was a fire-and-forget increment AFTER the
  // response had already started (and thus couldn't block anything).
  // checkDailyMessageCap also increments the Redis counter atomically as part
  // of the check, so the redundant fire-and-forget below has been removed.
  if (!dailyCap.allowed) {
    if (slotAcquired) await releaseStreamSlot(userId, streamScopeId);
    after(() => emitRateLimitEvent({ traceId, userId, tier, route: '/api/chat/stream', ip: ip ?? undefined }).catch(bg('emitRateLimitEvent.dailyCap')));
    return new Response(
      JSON.stringify({
        error:   'daily_message_cap_exceeded',
        // DATING-HARDEN: dating messages run through this same route
        // (datingMode=true) and share the exact same daily counter as
        // regular chat — a free user who burns their 5 messages talking to
        // a match is out of messages everywhere, not just in dating. Swiping
        // is intentionally a *separate* limiter (checkSwipeLimit,
        // dailySwipes in tiers/limits.ts) that never touches this counter,
        // so it stays available. Surface that explicitly in dating mode so
        // the client can route the user to the swipe deck instead of a dead
        // end, without implying they should just wait/upgrade.
        message: datingMode
          ? "You're out of messages for today, but you can keep swiping — matches don't cost you anything."
          : `You've hit your daily message limit for the ${tier} plan.`,
        used:    dailyCap.used,
        limit:   dailyCap.limit,
        code:    'DAILY_LIMIT_EXCEEDED',
        canStillSwipe: datingMode ? true : undefined,
        upgrade: tier === 'free' ? 'Upgrade to Premium for unlimited messages' : undefined,
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Per-character sub-cap — nested inside the daily total (must also run
  // before any SSE bytes are sent, same rationale as the daily cap above).
  //
  // WIRE-FIX: perCharCap was previously only used to gate/reject requests —
  // its remaining count was computed and then discarded on every successful
  // send. Both `done` emission sites below now forward it as
  // `perCharacterRemaining` so the client (useChat) can show
  // "N left with this character" instead of only the global daily count.
  if (!perCharCap.allowed) {
    if (slotAcquired) await releaseStreamSlot(userId, streamScopeId);
    return new Response(
      JSON.stringify({
        error:   'per_character_message_cap_exceeded',
        message: datingMode
          ? "You're out of messages with this match for today, but you can keep swiping."
          : `You've reached the ${perCharCap.limit}-message limit for this character today.`,
        used:    perCharCap.used,
        limit:   perCharCap.limit,
        code:    'PER_CHARACTER_LIMIT_EXCEEDED',
        canStillSwipe: datingMode ? true : undefined,
        upgrade: tier === 'free' ? 'Upgrade to Premium to remove the per-character cap' : undefined,
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Stream slot guard ─────────────────────────────────────────────────────
  if (!slotAcquired) {
    return jsonErr("You've got a lot going on at once — give one of your conversations a moment to finish, then try again.", 429);
  }

  // ── Mega-parallel context load ────────────────────────────────────────────
  // MIGRATION (companion-context.ts): the ~23 relationship/memory/state
  // engine calls previously inlined here now go through
  // assembleCompanionContext(), the canonical CompanionContext assembly —
  // same underlying calls, same parallelism, destructured back into the
  // exact same local names so none of the ~2,200 downstream lines in this
  // file needed to change.
  //
  // DB-ROUNDTRIP-FIX: this used to re-fetch the full `characters` row here,
  // in parallel with assembleCompanionContext, on the stated rationale that
  // assembleCompanionContext doesn't fetch it itself. That was a second,
  // full round trip for a row already fetched by the gate block above
  // (~line 500) with an identical-or-wider column list — pure waste on
  // every message. `characterRow` (hoisted from that gate fetch) is reused
  // directly here instead; assembleCompanionContext now runs alone rather
  // than racing a redundant query in the same Promise.all.
  const companionContext = await assembleCompanionContext({
    userId, characterId, conversationId: conversationId ?? null, message, character: null,
  });
  companionContext.character = characterRow;

  const {
    relationship: { psychology, relationship, revolutionProfile, evolutionTraits },
    memory: {
      graph: memoryGraph, facts: memoryFacts, priority: priorityMemories, seed: seedMemories,
      factGraph, dynamicInterests, discoveredLore, relevantKnowledge,
    },
    cognition: {
      canonicalMemory,
      // COMPUTE-BUDGET FIX: these were previously re-fetched independently
      // below (getActiveBeliefs ~S3b, getCompanionRelationships in the
      // roleplay Promise.all, getUnifiedMind for the fortune score) even
      // though assembleCompanionContext() above already fetches all
      // three — a straight duplicate DB/Redis round trip on every single
      // turn for data already in hand, verified with no state mutation
      // between assembly and the old re-fetch points. Renamed at
      // destructure time to match the local variable names those call
      // sites already used, so nothing downstream needed to change.
      beliefs: activeBeliefs,
      companionRelationships,
      fortune: unifiedMind,
    },
    state: { emotion: previousEmotion, coreDesire, fulfillment: desireFulfillment, milestones },
    conversation: {
      sessionBridge, recentIntents, openThreads, longTermPlan,
      journalEntries, unsurfacedThoughts, activeGoals,
    },
    world: { universeContext },
  } = companionContext;

  // ── Session-boundary: reinforce lessons + synthesize wisdom (WIRE FIX) ──────
  // reinforceLessons() and synthesizeWisdom() had zero call sites anywhere —
  // recordExperience() was logging raw experiences (see the GAP-FIX below),
  // but nothing ever turned them into lessons, and nothing ever turned
  // promotable lessons into durable wisdom. reflectOnSession() (this same
  // cognition layer) documents the intended trigger for this exact chain:
  // "at session end, or when a long gap is detected before the next
  // session starts" — so this reuses the gap-detection convention already
  // established elsewhere in this codebase (agency-engine.ts's
  // hoursSinceLastMsg >= 2 for "enough time has passed to treat this as a
  // new visit"), computed here directly from psychology.last_interaction
  // since the file's own hoursSinceLastMsgForDrives isn't computed until
  // later. Because last_interaction is updated after every turn (see
  // relationship-engine.ts), this naturally fires exactly once per real
  // session transition — the first message after a >=2h gap — not on
  // every turn of a session.
  //
  // Placed before this turn's own recordExperience() calls (below) so it
  // processes the experience log the JUST-ENDED session accumulated,
  // before any of this new session's experiences are added to it.
  //
  // NOT wired here: reflectOnSession() itself (a related but separate gap —
  // it needs a spanTurns value with no existing source in this file, and
  // its carryForward output needs its own integration into resolveCycle()
  // to actually write back into working memory. Left flagged rather than
  // guessed at under the same change.)
  {
    const hoursSinceLastMsgForSession = psychology.last_interaction
      ? (Date.now() - new Date(psychology.last_interaction).getTime()) / 3_600_000
      : 999;
    if (psychology.total_interactions > 0 && hoursSinceLastMsgForSession >= 2) {
      after(() => (async () => {
        const priorSessionExperiences = getRecentExperiences(userId, characterId);
        if (priorSessionExperiences.length === 0) return;
        reinforceLessons(userId, characterId, psychology.total_interactions, priorSessionExperiences);
        await synthesizeWisdom(userId, characterId, psychology.total_interactions);
      })().catch(bg('reinforceLessons+synthesizeWisdom')));
    }
  }

  // ── Schedule memory tests for testable seed memories (WIRE FIX) ────────────
  // scheduleMemoryTest() previously had zero call sites — is_testable seed
  // memories were surfaced in the prompt (formatSeedMemoriesForPrompt) but
  // never scheduled for the recall-test flow described in memory-test-
  // engine.ts's header, so getDueMemoryTest() could never find a pending
  // row and the whole feature was dormant. Gated on MIN_EXCHANGES_BEFORE_TEST
  // (the same total_interactions counter already used for lore-reveal and
  // evolution-stage gating elsewhere in this file) so tests aren't scheduled
  // on a player's very first exchange. Idempotent — scheduleMemoryTest()
  // upserts with ignoreDuplicates, so calling this again on every subsequent
  // turn is safe and cheap (a no-op once a memory is already scheduled).
  if (psychology.total_interactions >= MIN_EXCHANGES_BEFORE_TEST) {
    for (const sm of seedMemories) {
      if (sm.is_testable) {
        after(() => scheduleMemoryTest(userId, characterId, sm.id).catch(bg('scheduleMemoryTest')));
      }
    }
  }

  // ── Ensure every relationship has at least a default goal — idempotent, cheap, non-blocking. ──
  after(() => ensureDefaultRelationshipGoal(characterId, userId).catch(bg('ensureDefaultRelationshipGoal')));
  // Desire Engine: every character needs exactly one core-desire quad (need/want/fear/obsession).
  // Cheap deterministic fallback if this is the first message ever for this character — no LLM
  // call blocks the response; a richer AI-authored quad can be backfilled by a separate job.
  after(() => ensureCoreDesire(characterId, { name: characterRow?.name ?? '' }).catch(bg('ensureCoreDesire')));
  // Nudge per-relationship desire fulfillment from what the user just said — small, cheap,
  // non-blocking. Only runs once the core desire quad actually exists (post-bootstrap turns).
  if (coreDesire) {
    const nudge = inferNudgeFromMessage(message, coreDesire);
    if (Object.keys(nudge).length > 0) {
      after(() => nudgeFulfillment(characterId, userId, nudge).catch(bg('nudgeFulfillment')));
    }
  }

  // ── Resolve open threads if this message plausibly answers one — cheap keyword check. ──
  after(() => maybeAutoResolveThreads(userId, characterId, message).catch(bg('maybeAutoResolveThreads')));

  // ── Emotion transition (sync, in-process) ────────────────────────────────
  const emotionTransitioned = emotionEngine.transition(previousEmotion, detectedEmotion, sessionCount);
  const emotionInstructions = emotionEngine.buildPromptInstructions(emotionTransitioned);

  // Emotion-biased re-ranking of already-fetched memories — zero extra DB cost.
  const rankedMemoryGraph = applyEmotionBias(memoryGraph, emotionTransitioned);

  // Semantic retrieval against what the user actually just said — see
  // lib/ai/semantic-memory.ts / lib/ai/memory-embeddings.ts. Fails open to
  // rankedMemoryGraph unchanged if BRAIN_SERVICE_URL isn't configured, no
  // memory has a persisted embedding yet, or the service is unavailable.
  // WIRE-FIX: this was only present in /api/chat (non-streaming); the
  // actually-used streaming path was missing it, so live memory recall
  // wasn't tuned to the current message on the primary chat path.
  //
  // PGVECTOR UPGRADE: previously this only ever reranked rankedMemoryGraph
  // (already truncated by the emotion/recency query). retrieveRelevantMemories()
  // now tries real pgvector similarity search first (can surface a genuinely
  // relevant older/lower-weight memory the recency/weight query wouldn't
  // have fetched at all), then falls back to the exact same live-rerank
  // behavior (semanticRerankMemories) this call site used before, then to
  // rankedMemoryGraph's original order untouched. No regression for any
  // deployment that hasn't run the pgvector migration or backfill yet.
  //
  // PERF: this is a blocking network call to an external brain microservice
  // that doesn't depend on the character row or any of the validation gates
  // immediately below (character existence, active/premium/mature checks) —
  // it only needs rankedMemoryGraph (already in hand) and the raw message.
  // Kicked off here as a promise instead of `await`ed inline, so it runs
  // *during* those gate checks instead of stacking in front of them. Only
  // `await`ed at its first real use site further down (~line 1140).
  const semanticMemoryGraphPromise = retrieveRelevantMemories(userId, characterId, rankedMemoryGraph, message);

  const character = characterRow;
  if (!character) {
    await releaseStreamSlot(userId, streamScopeId);
    return jsonErr('Character not found', 404);
  }

  // ── ENFORCE DIGITAL PERSON: self-healing guard ────────────────────────────
  // Every character created through POST /api/characters already has a brain
  // (initializeDigitalPerson runs synchronously at creation, with rollback on
  // failure — see digital-person-bootstrap.ts). This catches the remaining
  // case: canon/seed characters inserted directly via SQL/migration that
  // bypassed the API. Rather than hard-blocking chat on a legacy character,
  // heal it inline once — cheap (no LLM call, just derived-field seeding),
  // and every future turn for this character skips this branch entirely.
  if (!(character as { brain_initialized?: boolean }).brain_initialized) {
    const healed = await initializeDigitalPerson({
      characterId: characterId,
      name:        character.name,
      personality: character.personality,
      backstory:   character.backstory,
      occupation:  character.occupation,
      category:    undefined,
    });
    if (!healed.success) {
      logger.error('chat/stream: character missing brain and self-heal failed', {
        characterId, stage: healed.stage, error: healed.error,
      });
      await releaseStreamSlot(userId, streamScopeId);
      return jsonErr('This character isn\'t ready to chat yet — please try again shortly.', 503);
    }
  }

  // ACTIVATION-FIX (P0): same gap as /api/chat — service-role client bypasses
  // RLS, so `active` was never checked here. Allow the creator to preview
  // their own pending character; respond identically to "not found" for
  // anyone else so a pending character's existence isn't leaked.
  if (!character.active && character.creator_id !== userId) {
    await releaseStreamSlot(userId, streamScopeId);
    return jsonErr('Character not found', 404);
  }

  // PREMIUM-GATE FIX: /api/chat/route.ts has always checked tier access here;
  // this route — the one use-chat.ts actually calls — never did, so any
  // free-tier user could chat with premium/VIP characters through the live
  // code path. Mirrors the non-streaming route's
  // check and response shape (code: 'PREMIUM_CHARACTER_REQUIRED') so
  // use-chat.ts's existing 429 handling can react to it the same way.
  const premiumGate = checkCharacterTierAccess(
      tier,
      character.min_tier as typeof tier | null | undefined,
      !!character.is_premium,
    );
  if (!premiumGate.allowed) {
    await releaseStreamSlot(userId, streamScopeId);
    return jsonErr(premiumGate.reason ?? 'This character requires a paid plan', 403, 'PREMIUM_CHARACTER_REQUIRED');
  }

  // MATURE-GATE FIX: this route (the one use-chat.ts actually calls, same
  // gap PREMIUM-GATE FIX above closed for tiers) never checked nsfw_enabled
  // for is_nsfw characters — only the character *discovery* endpoint
  // (/api/characters) did. Anyone who obtained an is_nsfw character's ID by
  // any means (shared link, prior session, guessed UUID) could message it
  // and receive mature content with zero opt-in check.
  // PERF: reuse the identical check already done above (same userId, tier,
  // and is_nsfw value — is_nsfw is a stable per-character flag, not
  // something that changes between the two fetches within one request) —
  // avoids a second, guaranteed-redundant Redis/DB round trip per message.
  const matureGate = cachedMatureGate ?? await checkMatureContentAccess(
    userId,
    !!character.is_nsfw,
    tier,
  );
  if (!matureGate.allowed) {
    await releaseStreamSlot(userId, streamScopeId);
    return jsonErr(matureGate.reason ?? 'This character has mature content enabled', 403, 'MATURE_CONTENT_GATE');
  }

  // ── ROLEPLAY-LATENCY-FIX: kick off history fetch + response planner early ──
  // planResponse() is a genuinely separate LLM call (up to PLANNER_TIMEOUT_MS
  // = 2.5s) whose whole point is to think-before-speaking ahead of the main
  // generation call. It used to be `await`ed AFTER the entire cognition
  // cascade below (runCognitionCycle, prompt assembly, dating context, etc.
  // — roughly 1,200 lines / several round-trips of work) had already
  // finished, meaning every single reply paid the planner's full latency
  // stacked ON TOP of everything else, purely serialized in front of the
  // main streaming call. That's the dominant source of "streaming feels
  // laggy": nothing is sent to the client until this call resolves.
  //
  // The planner only needs the character, this turn's already-computed
  // emotion, the relationship stage, and recent message history — all of
  // which are resolvable this early (history is the only one that wasn't
  // fetched yet). So both are kicked off here as promises, immediately after
  // the gates above confirm this is a real, allowed request, and are only
  // `await`ed at their ORIGINAL use sites further down. That lets the
  // planner's LLM call run *inside* the ~1-2s the cognition cascade already
  // takes — overlapped, not stacked — instead of adding to it. The
  // conversation-ownership 404 check still happens for real at the original
  // use site below; this just avoids blocking on it up front.
  const historyPromise = conversationId
    ? (async (): Promise<{ notFound: boolean; rows: { role: string; content: string }[] }> => {
        const { data: conv } = await supabase
          .from('conversations').select('id')
          .eq('id', conversationId).eq('user_id', userId).maybeSingle();
        if (!conv) return { notFound: true, rows: [] };
        const { data: msgs } = await supabase
          .from('messages').select('role,content')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true })
          .limit(historyLimitForTier(tier));
        return { notFound: false, rows: msgs ?? [] };
      })()
    : Promise.resolve({ notFound: false, rows: [] as { role: string; content: string }[] });

  const planPromise = historyPromise.then((h) => {
    // A not-found/not-owned conversation gets its real 404 at the use site
    // below — no point spending a planner call on a request that's about to
    // be rejected anyway.
    if (h.notFound) return NEUTRAL_PLAN;
    const historyForPlan = trimHistoryForPlan(h.rows, tier);
    return planResponse({
      characterName:    character.name,
      characterSummary: [character.personality, character.occupation, character.current_goal]
        .filter(Boolean).join(' — ').slice(0, 400),
      recentMessages:   historyForPlan.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      emotion:          emotionTransitioned,
      relationshipStage: relationship?.stage,
      traceId,
    });
  });

  // LATENCY-FIX: these five were previously five separate sequential
  // `await`s — voiceFingerprint, selfModel, theoryOfMind, beliefPipeline,
  // reputationPipeline. None of them depend on another's *result* (each
  // only needs userId/characterId/character/psychology, all already
  // available above), so serializing them was pure added latency: five
  // Redis/DB round-trips back-to-back instead of in flight together.
  // Promise.all here preserves each call's original error-handling
  // exactly — theoryOfMind's try/catch-with-null-fallback and
  // beliefPipeline/reputationPipeline's .catch-to-null are unchanged,
  // just no longer blocking each other.
  const [voiceFingerprint, selfModel, theoryOfMind, beliefPipeline, reputationPipeline] = await Promise.all([
    getOrInitFingerprint(
      userId, characterId, character.speech_style ?? null, psychology.total_interactions,
    ),
    loadSelfModel(
      userId, characterId,
      character as unknown as Parameters<typeof loadSelfModel>[2],
      psychology,
    ),
    loadTheoryOfMind(
      userId, characterId,
      { char_warmth: character.char_warmth },
    ).catch((err) => {
      // loadTheoryOfMind() throws on hard failure (e.g. Redis down) rather
      // than failing open, since the underlying models already fail open
      // individually — same null-on-failure outcome as the original
      // try/catch, just expressed as a .catch() so it can sit in
      // Promise.all with the rest.
      logger.warn('stream: theory-of-mind load failed', { userId, characterId, error: String(err) });
      return null;
    }),
    runBeliefPipeline(userId, characterId).catch((err) => {
      logger.warn('stream: belief-pipeline load failed', { userId, characterId, error: String(err) });
      return null;
    }),
    runReputationPipeline(userId, characterId).catch((err) => {
      logger.warn('stream: reputation-pipeline load failed', { userId, characterId, error: String(err) });
      return null;
    }),
  ]);
  after(() => maybeDeepenSelfModel(
    userId, characterId,
    character as unknown as Parameters<typeof loadSelfModel>[2],
    psychology,
    {
      memoryHighlights:  memoryGraph.slice(0, 6).map(m => `${m.title}: ${m.description}`),
      priorityHeadlines: priorityMemories.slice(0, 6).map(m => m.headline),
      dynamicInterests,
    },
  ).catch(bg('maybeDeepenSelfModel')));
  // recordSelfModelEvent(userId, characterId, character, event) is exported
  // from self-model.ts for routing a specific lived moment (a boundary
  // held/violated, a value conflict resolved, a compliment landing) through
  // core-beliefs.ts/personal-values.ts/self-image.ts. GAP-FIX: this used to
  // say "not called here" — now fixed, see the repair-outcome block further
  // down, which is the one signal this route can classify without guessing
  // (same standard the belief-engine/reputation-engine hooks next to it
  // already use). belief, esteem, selfImage, and purpose are wired off that
  // signal; valueConflict still has no clean classifier — decision-engine.ts's
  // Intent and repair-engine.ts's rupture state are the closest existing
  // signals but don't map cleanly onto it without guessing.

  const absenceEvent = detectAbsenceEvent(psychology.last_interaction);
  if (absenceEvent) after(() => applyPsychologyEvent(userId, characterId, absenceEvent).catch(bg('applyPsychologyEvent.absence')));

  // Lore reveal — character secrets unlock progressively
  let loreToReveal: string | null = null;
  let loreDiscoveryKey: string | null = null;
  let isFirstLoreReveal = false;
  if (Array.isArray(character.secrets) && character.secrets.length) {
    const reveal = shouldRevealLore(psychology.total_interactions, discoveredLore, character.secrets as string[]);
    if (reveal) {
      loreToReveal = reveal.content;
      loreDiscoveryKey = reveal.key;
      isFirstLoreReveal = discoveredLore.length === 0;
      after(() => {
        recordLoreDiscovery(userId, characterId, reveal.key, reveal.content, character.name).catch(bg('recordLoreDiscovery'));
        applyPsychologyEvent(userId, characterId, 'lore_discovered').catch(bg('applyPsychologyEvent.loreDiscovered'));
      });
    }
  }

  const evolutionStage = getEvolutionStage(psychology.days_known, psychology.total_interactions);
  const evolutionTraitsPrompt = formatEvolutionTraitsForPrompt(evolutionTraits);

  // ── Relationship engine layer: writing style, decision, agency ──────────
  const writingStyle: WritingStyleProfile =
    (character.writing_style as unknown as WritingStyleProfile | null) ??
    WRITING_STYLE_PRESETS.girl_next_door;

  // ── Rupture & repair: resolve any pending rupture before this turn's intent ──
  // WIRE FIX: getRuptureState()/evaluateRepair() were previously exported by
  // repair-engine.ts but never called anywhere in the request path, so
  // ruptureCooldownUntil never reached decideIntent() and a pending
  // SetBoundary rupture was never evaluated on the user's next reply. Read
  // first (cheap), and only run evaluateRepair() — which re-reads pending
  // itself — when there's actually something pending, then re-read the
  // (now-updated) cooldown so it's fresh for this same turn's CharacterState.
  const ruptureStateInitial = await getRuptureState(userId, characterId);
  let ruptureCooldownUntil = ruptureStateInitial.ruptureCooldownUntil;
  // Captured (previously discarded) so trust-repair-engine.ts can tell the
  // character's voice this turn that a repair/deflection/escalation just
  // actually happened, instead of that outcome only ever affecting future
  // turns' numbers silently.
  let repairResultThisTurn: RepairResult | null = null;
  if (ruptureStateInitial.pending) {
    repairResultThisTurn = await evaluateRepair(userId, characterId, message, emotionTransitioned).catch(err => {
      logger.warn('stream:evaluateRepair-failed', { userId, characterId, error: String(err) });
      return null;
    });
    const ruptureStateAfterEval = await getRuptureState(userId, characterId);
    ruptureCooldownUntil = ruptureStateAfterEval.ruptureCooldownUntil;

    // belief-engine.ts (lib/ai) evidence hook — deliberately narrow. Most
    // "what just happened this turn" signals don't have a clean classifier
    // yet (see the self-model.ts recordSelfModelEvent note above), but a
    // resolved repair does: evaluateRepair() already classified the outcome,
    // so this doesn't require guessing. 'repaired' confirms that she can
    // count on things getting fixed when they go wrong; 'escalated'
    // contradicts it. 'deflected'/'ambiguous'/'stale' are genuinely
    // ambiguous and deliberately not recorded as evidence either way.
    if (repairResultThisTurn && (repairResultThisTurn.outcome === 'repaired' || repairResultThisTurn.outcome === 'escalated')) {
      // Captured once, narrowed, so closures below (after() callbacks) don't
      // lose TS's narrowing on repairResultThisTurn — same value the ! in
      // recordExperience()'s callback above works around, this just avoids
      // adding another non-null assertion for the new block below.
      const repairOutcome = repairResultThisTurn.outcome;
      const evidence: ExperienceEvidence = {
        category: 'about_relationship',
        statement: 'when something goes wrong between us, it actually gets worked through',
        confirms: repairResultThisTurn.outcome === 'repaired',
        weight: repairResultThisTurn.outcome === 'escalated' ? 0.8 : 0.6,
      };
      after(() => processExperience(userId, characterId, evidence).catch(bg('belief-engine.processExperience')));

      // cognition/experience-engine.ts — GAP-FIX: recordExperience() was
      // exported from cognition-engine.ts's facade but never actually
      // called from any live route (see that engine's header — it's the
      // base of the experience → lesson → wisdom chain, and nothing
      // upstream of wisdom-engine.ts ever fed it real data). Same
      // classified signal as the ExperienceEvidence hook immediately
      // above, reused rather than re-derived: a resolved repair is one of
      // the few things this turn can classify without guessing.
      after(() => {
        try {
          recordExperience(userId, characterId, psychology.total_interactions, {
            category: 'conflict',
            summary: repairResultThisTurn!.outcome === 'repaired'
              ? 'a rupture got worked through and repaired'
              : 'a rupture escalated instead of resolving',
            valence: repairResultThisTurn!.outcome === 'repaired' ? 0.5 : -0.6,
            outcome: repairResultThisTurn!.outcome === 'repaired' ? 'positive' : 'negative',
          });
        } catch (err) {
          logger.warn('stream: recordExperience(conflict) failed', { userId, characterId, error: String(err) });
        }
      });

      // reputation-engine.ts — same signal, same justification: a
      // classified repair outcome is direct, unambiguous evidence about
      // whether he actually follows through when it counts. Only the
      // trustworthy axis is touched here; dangerous/famous/dishonest/
      // heroic/rich all need signals this route doesn't yet classify
      // cleanly enough to write without guessing (see belief-engine's
      // evidence hook comment above for the same standard applied there).
      const repEvidence: ReputationEvidence = {
        axis: 'trustworthy',
        summary: repairResultThisTurn.outcome === 'repaired'
          ? 'came back and made things right after a rupture'
          : 'a rupture escalated instead of getting resolved',
        valence: repairResultThisTurn.outcome === 'repaired' ? 0.6 : -0.5,
        weight: 0.55,
      };
      after(() => recordReputationEvidence(userId, characterId, repEvidence).catch(bg('reputation-engine.recordEvidence')));

      // self-model.ts's recordSelfModelEvent() — GAP-FIX: was exported with
      // zero callers anywhere (see the comment above maybeDeepenSelfModel
      // for the original note); now wired. Four of the five IdentityEvent
      // sub-fields map onto this exact classification without guessing:
      //   - belief: 'reliable_presence' (connection/trust) on repaired,
      //     'abandonment_signal' (connection/self-worth) on escalated —
      //     the same "can she count on things getting fixed" distinction
      //     already used above, just fed to core-beliefs.ts instead of
      //     (in addition to) belief-engine.ts. Different stores, same
      //     underlying evidence — no new judgment call.
      //   - esteem: 'validated_feelings' on repaired (her side of the
      //     rupture was taken seriously enough to resolve it),
      //     'dismissed' on escalated (it wasn't).
      after(() => recordSelfModelEvent(userId, characterId, character as unknown as Parameters<typeof recordSelfModelEvent>[2], {
        belief: {
          kind: repairOutcome === 'repaired' ? 'reliable_presence' : 'abandonment_signal',
          intensity: repairOutcome === 'repaired' ? 0.6 : 0.8,
        },
        esteem: {
          kind: repairOutcome === 'repaired' ? 'validated_feelings' : 'dismissed',
          intensity: repairOutcome === 'repaired' ? 0.6 : 0.8,
          reason: repairOutcome === 'repaired'
            ? 'a rupture between them actually got worked through'
            : 'a rupture between them escalated instead of resolving',
        },
        // GAP-FIX: selfImage/purpose were the two remaining IdentityEvent
        // sub-fields with a classifier that doesn't require guessing — a
        // resolved (or escalated) rupture is squarely a lovability moment
        // (is she worth staying for) and a connection-meaning moment (does
        // this relationship still matter). valueConflict still has no clean
        // mapping from this signal and is deliberately left unset.
        selfImage: {
          dimension: 'lovability',
          valence: repairOutcome === 'repaired' ? 0.5 : -0.7,
          reason: repairOutcome === 'repaired'
            ? 'a rupture between them actually got worked through'
            : 'a rupture between them escalated instead of resolving',
        },
        purpose: {
          kind: repairOutcome === 'repaired' ? 'meaning_affirmed' : 'meaning_undermined',
          source: 'connection',
          intensity: repairOutcome === 'repaired' ? 0.5 : 0.7,
          reason: repairOutcome === 'repaired'
            ? 'a rupture between them actually got worked through'
            : 'a rupture between them escalated instead of resolving',
        },
      }).catch(bg('self-model.recordSelfModelEvent')));

      // secret-tier-engine.ts — GAP-FIX: unlockSecretTier() was fully built
      // (idempotent upsert, RLS-safe, already read by computeAvailableTiers
      // above every turn) but had zero callers anywhere, so a player could
      // never actually earn the catastrophic tier — computeAvailableTiers()
      // would forever return only the three stage-gated tiers for every
      // character. This is the one signal in this route that matches what
      // the design doc (secret-tier-engine.ts's own header) describes as a
      // "behavioral trust condition": a rupture that actually got repaired,
      // not merely time/stage passing. Deliberately narrow — only fires on
      // 'repaired' (never 'escalated'), and only once the relationship has
      // already reached the catastrophic stage floor (best_friend/partner),
      // so this can't fire early and cheapen the mechanic; a couple who
      // just met and patches up a small thing doesn't unlock a companion's
      // darkest secret. Idempotent per (user, character, tier), so repeated
      // repairs at that stage are harmless no-op upserts, not re-unlocks.
      if (repairOutcome === 'repaired' && meetsCatastrophicStageFloor(relationship.stage)) {
        after(() => unlockSecretTier(
          userId,
          characterId,
          'catastrophic',
          'a rupture between them was worked through and repaired at their deepest level of trust',
        ).catch(bg('secret-tier-engine.unlockSecretTier')));
      }
    }
  }

  const desireBias = desireFulfillment ? computeDesireBias(desireFulfillment) : undefined;

  // Historical-only repetition check — deliberately NOT the same thing as
  // intentRepeated below. This has to be computable before decideIntent()
  // has run (it feeds the executive pass, which now runs first), so it can
  // only look at the last two turns' *recorded* intents, not this turn's
  // (not yet decided) one. "Already 2-in-a-row" is a fine proxy for "at
  // risk of a 3rd" for drive-signal purposes; the exact, current-turn-
  // inclusive check still happens further down for the actual prompt note.
  const historicalRepetition = recentIntents.length >= 2
    && recentIntents[0] === recentIntents[1];

  const hoursSinceLastMsgForDrives = psychology.last_interaction
    ? (Date.now() - new Date(psychology.last_interaction).getTime()) / 3_600_000
    : 999;

  // ── Executive controller: "choose before speak" — this has to run
  // BEFORE decision-engine.ts's Intent selection, not after (see
  // executive-controller.ts's header — it documents this ordering and the
  // previous wiring here violated it: driveSignals depended on
  // intentDecision.intent, which made the executive pass a downstream
  // consumer of the very decision it's supposed to inform). Two signals
  // below can no longer be sourced from intentDecision/skillNeeded since
  // neither exists yet at this point in the turn:
  //
  //   - security.riskyMoveUnderConsideration used to be
  //     `intentDecision.intent === Intent.SetBoundary` — i.e. it asked
  //     decision-engine.ts what it already decided. Replaced with the same
  //     conditions SetBoundary's own scoring formula weights most heavily
  //     (high stress + negative valence, not already on a rupture
  //     cooldown) — a proxy for "boundary-relevant conditions are present,"
  //     not a claim that SetBoundary will actually be chosen.
  //   - status.expertiseRelevant used to be `skillNeeded !== null`, but
  //     inferNeededSkill() reads the response-strategy text, which doesn't
  //     exist until after decideIntent()/planBehavior() run below. Left at
  //     its neutral default (false) rather than faked — this is the one
  //     remaining gap; it genuinely can't be known pre-Intent.
  //
  // curiosity.unansweredQuestions/oldestUnansweredTurns and
  // status.recentTurnsCenteredOnUser used to be hardcoded 0 — nothing
  // tracked either. conversation-thread-tracker.ts now does, using the
  // same two-phase per-turn shape as repair-engine.ts's getRuptureState()
  // + evaluateRepair() above: read+resolve now (against this turn's
  // incoming message), record() after the reply exists (see the after()
  // call near fullReply below).
  const threadSignals = await getTurnSignals(userId, characterId, message, psychology.total_interactions);
  const negValenceForDrives = emotionTransitioned.valence < 0 ? Math.abs(emotionTransitioned.valence) : 0;
  const onRuptureCooldownForDrives = !!ruptureCooldownUntil && new Date(ruptureCooldownUntil).getTime() > Date.now();
  const driveSignals: DriveEngineSignals = {
    curiosity: {
      unansweredQuestions:      threadSignals.unansweredQuestions,
      oldestUnansweredTurns:    threadSignals.oldestUnansweredTurns,
      touchedKnowledgeGap:      relevantKnowledge.length > 0,
      raisedNewQuestion:        Boolean(loreToReveal),
      recentSurfaceLevelTurns:  historicalRepetition ? 3 : 0,
    },
    attachment: {
      hoursSinceLastInteraction: hoursSinceLastMsgForDrives,
      recentRupture:              Boolean(ruptureStateInitial.pending),
      recentWarmth:                ['love', 'trust', 'gratitude', 'contentment'].includes(emotionTransitioned.primary),
      trustScore:                  psychology.trust,
      activeInsecurity:            psychology.stress > 65,
    },
    status: {
      recentlyDismissed:          historicalRepetition,
      recentlyValidated:          psychology.confidence > 70,
      lowSelfImage:                psychology.confidence < 35,
      expertiseRelevant:           false, // see comment above — not knowable pre-Intent
      recentTurnsCenteredOnUser:   threadSignals.recentTurnsCenteredOnUser,
    },
    security: {
      activeRupture:               Boolean(ruptureStateInitial.pending),
      recentAmbiguity:              false,
      trustScore:                   psychology.trust,
      emotionalStability:           100 - psychology.stress,
      riskyMoveUnderConsideration:  psychology.stress > 70 && negValenceForDrives > 0 && !onRuptureCooldownForDrives,
    },
    novelty: {
      repeatedTopicTurns:           historicalRepetition ? 3 : 0,
      repeatedRhythmTurns:          historicalRepetition ? 4 : 0,
      freshThreadAvailable:         openThreads.some(t => t.raised_count === 0),
      daysSinceLastNovelty:         hoursSinceLastMsgForDrives / 24,
    },
  };
  // attentionCandidates is deliberately omitted below (not passed as []):
  // memory-graph.ts's output (semanticMemoryGraph) and memory.ts's
  // (memoryFacts) already go through their own dedicated relevance
  // filtering (semanticRerankMemories) and are passed straight into
  // assembleFullPrompt below — routing them through attention-router.ts
  // too would risk double-filtering or duplicate injection, now even more
  // true with S1-S21's own direct-injection prompt fragments already
  // covering most of the same ground. Wiring real signals here via
  // ExecutiveInput.salience is a real follow-up, not done blindly.
  //
  // goalRecency is also omitted, not passed as []: focus-stack.ts (a
  // Redis-backed, per-(user,character) turns-since-goal-last-selected
  // counter — see that file's header for how it differs from
  // cognition/working-memory.ts) now supplies this automatically inside
  // runExecutiveController when the field is undefined, closing the gap
  // this comment used to describe. Passing an explicit [] here would
  // silently override that and go back to goal-selector.ts's neutral
  // default for every goal every turn — omitting the field is what
  // actually opts into the fix.
  // COGNITION-WIRE: attention signals for this turn — what's worth
  // writing into working-memory.ts at all, per attention-engine.ts's
  // kind weighting (watch_flag > commitment > active_task > ...). Built
  // entirely from state already computed above for other purposes; no
  // new fetches. Capped per kind so one chatty thread-heavy turn can't
  // crowd out the watch_flag/commitment signals that matter more.
  const attentionSignals: AttentionSignal[] = [];
  // Note: no crisis-flag signal here — a crisis-flagged message never
  // reaches this point at all (see the early return right after
  // detectCrisisSignal() near the top of this handler), so checking
  // crisisCheck.level again here would be dead code — TS's control-flow
  // narrowing agrees (crisisCheck.level is 'none' by construction here).
  if (ruptureStateInitial.pending) {
    attentionSignals.push({
      id: 'rupture-pending',
      kind: 'watch_flag',
      summary: 'a boundary/rupture is pending resolution',
      rawSalience: 0.9,
    });
  }
  if (Math.abs(emotionTransitioned.valence) > 0.6 && emotionTransitioned.intensity > 0.6) {
    attentionSignals.push({
      id: `emotional-beat-${recentIntents.length}`,
      kind: 'emotional_beat',
      summary: `strong ${emotionTransitioned.primary} this turn (valence ${emotionTransitioned.valence.toFixed(2)})`,
      rawSalience: emotionTransitioned.intensity,
    });
  }
  for (const thread of openThreads.slice(0, 3)) {
    attentionSignals.push({
      id: `open-thread-${thread.id}`,
      kind: 'open_thread',
      summary: thread.subject,
      rawSalience: 0.5,
    });
  }

  // PERF: first real use of the semantic rerank kicked off back at ~line
  // 678 — by now it's had the entire character-validation gate block plus
  // the history/plan kickoff to resolve in the background, so this await
  // is normally a no-op rather than a fresh blocking round trip.
  const semanticMemoryGraph = await semanticMemoryGraphPromise;

  const executiveInput: ExecutiveInput = {
    userId, characterId,
    goals: activeGoals,
    driveSignals,
    attentionBudget: 800,
    // confidence-engine.ts inputs — all already computed earlier this
    // turn for other purposes, not new fetches: emotionTransitioned
    // (line ~471), relationship (mega-parallel load), threadSignals
    // (line ~704), semanticMemoryGraph (line ~483, same surfaced-memory
    // set that goes into the actual prompt below — see its own comment
    // on why it isn't routed through attention-router.ts), and
    // psychology's own interaction/duration counters.
    emotion:           emotionTransitioned,
    relationship,
    threadSignals,
    surfacedMemories:  semanticMemoryGraph,
    totalInteractions: psychology.total_interactions,
    daysKnown:         psychology.days_known,
  };
  // COGNITION-WIRE: runCognitionCycle() (consciousness-loop.ts) replaces
  // a bare runExecutiveController() call — it does the same "choose
  // before speak" pass underneath (via cognition/executive-controller.ts)
  // but first ticks/decays working-memory.ts and admits this turn's
  // attentionSignals into it, then folds whatever's still live (an
  // unresolved rupture from 3 turns ago, a standing commitment) back
  // into the decision's promptBlock. `.decision.executive` below is the
  // exact same ExecutiveDecision shape the rest of this file already
  // expects, so every downstream read of `executiveDecision.*` is
  // unchanged; only the promptBlock actually injected (further down)
  // now includes the carried-forward section.
  const cognitionCycle = await runCognitionCycle({
    userId, characterId,
    signals: attentionSignals,
    cognitive: executiveInput,
  });
  const executiveDecision = cognitionCycle.decision.executive;
  const cognitionPromptBlock = cognitionCycle.decision.promptBlock;

  // COGNITION-WIRE: reasoning-engine.ts — the one conflict genuinely
  // worth checking every turn with data already on hand: is the
  // executive layer about to pursue an ordinary goal while a
  // watch_flag (crisis/rupture) is still active in working memory?
  // Those two conditions before this wiring could both be true at once
  // with nothing forcing them to compete — reason() makes that an
  // explicit, logged conflict rather than a silent one.
  let goalVsWatchFlagConflict: ReturnType<typeof reasonAboutConflicts> | null = null;
  if (executiveDecision.selectedGoal && cognitionCycle.decision.activeWatchFlags.length > 0) {
    const goalClaim: Claim = {
      id: `goal-${executiveDecision.selectedGoal.goal.id}`,
      source: `goal-selector:${executiveDecision.selectedGoal.goal.category}`,
      subject: 'this-turn-focus',
      polarity: 'supports',
      strength: executiveDecision.selectedGoal.score,
    };
    const watchClaims: Claim[] = cognitionCycle.decision.activeWatchFlags.map(f => ({
      id: `watch-${f.id}`,
      source: 'working_memory:watch_flag',
      subject: 'this-turn-focus',
      polarity: 'opposes',
      strength: f.activation,
      weight: 1.3,
    }));
    goalVsWatchFlagConflict = reasonAboutConflicts([goalClaim, ...watchClaims]);
  }
  // COGNITION-WIRE (session 2): reused below both for the S3b prompt
  // section and this turn's internal-monologue compose.
  //
  // COMPUTE-BUDGET FIX: previously re-fetched getActiveBeliefs() here —
  // now sourced from companionContext.cognition.beliefs (destructured as
  // activeBeliefs above), which assembleCompanionContext() already
  // fetched earlier this same turn with the identical fail-open-to-[]
  // behavior. No mutation of belief state happens between that fetch and
  // this point in the turn, so the value is still current.
  // recordTaskOutcomeNotYet(userId, characterId, taskId) / completeTask(...)
  // are exported from executive-controller.ts for when the request path
  // gains a real signal for "did the active task actually come up in the
  // generated reply." Without that signal, an unresolved task just stays
  // in the queue and resurfaces next turn — consistent with task-manager.ts's
  // documented behavior, not a bug.

  // Executive → decision-engine handoff: the whole point of running the
  // executive pass first is that it actually shapes what happens next, not
  // just that it happens earlier in the file. selectGoal()'s pick is fed
  // back into currentGoals by nudging its priority up before scoring —
  // decision-engine.ts already reads currentGoals.find(g => g.category ===
  // 'relationship')?.priority internally, so this changes decideIntent's
  // scores for real without needing decision-engine.ts itself to know
  // anything about the executive layer.
  const selectedGoalId = executiveDecision.selectedGoal?.goal.id;
  const goalsForIntent = selectedGoalId
    ? activeGoals.map(g => (g.id === selectedGoalId ? { ...g, priority: Math.min(1, g.priority + 0.2) } : g))
    : activeGoals;

  const characterState: CharacterState = {
    trust:       psychology.trust,
    comfort:     psychology.comfort,
    attachment:  psychology.attachment,
    affection:   psychology.affection,
    curiosity:   psychology.curiosity,
    respect:     psychology.confidence, // closest existing axis — no separate "respect" var upstream
    mood:        emotionTransitioned.primary,
    energy:      100 - psychology.stress,
    stress:      psychology.stress,
    relationshipStage: (relationship?.stage ?? 'stranger'),
    currentGoals: goalsForIntent,
    emotion:      emotionTransitioned,
    personality:  {
      playfulness: character.char_adventure ?? 50,
      empathy:     character.char_warmth    ?? 50,
      confidence:  character.char_depth     ?? 50,
    },
    desireBias,
    ruptureCooldownUntil,
  };
  const intentDecision  = decideIntent(characterState);
  const responseBehavior = planBehavior(intentDecision.intent);
  // COGNITION-WIRE (session 2): internal-monologue.ts composes a richer,
  // structured thought stream around decision-engine's single monologue
  // string — working memory (peekWorkingMemory, populated by
  // runCognitionCycle above), the same activeBeliefs just fetched for
  // S3b, and this turn's goalVsWatchFlagConflict reasoning steps (if
  // any). intentDecision.monologue is deliberately NOT passed as
  // `intentMonologue` here — formatIntentForPrompt() below already
  // injects it verbatim elsewhere in the prompt, and composeMonologue()
  // would just re-render the same line a second time.
  // theory-of-mind mismatches are omitted: cognition/theory-of-mind.ts's
  // reconcile() needs MindSignals derived from the user's message via NLP
  // this route doesn't currently do — wiring it here would mean
  // fabricating signals rather than using real ones. Left as a real
  // follow-up, same as the other documented COGNITION-WIRE gaps.
  const monologueStream = composeMonologue({
    workingMemory:  peekWorkingMemory(userId, characterId),
    activeBeliefs,
    reasoningSteps: goalVsWatchFlagConflict?.steps,
    emotion:        emotionTransitioned,
  });
  // Anti-repetition: same Intent 3 turns running reads as one-note (see goal-engine.ts's getRecentIntents doc).
  // This is the current-turn-inclusive check (unlike historicalRepetition
  // above) — used below for the actual "vary your approach" prompt note.
  const intentRepeated = recentIntents.length >= 2
    && recentIntents[0] === intentDecision.intent
    && recentIntents[1] === intentDecision.intent;

  const strategy = selectPursuitStrategy(character.archetype ?? character.category);
  const agencyPlan = longTermPlan ?? deriveDefaultPlan(characterState.relationshipStage, activeGoals[0] ?? null);
  const hoursSinceLastMsg = hoursSinceLastMsgForDrives;
  const agencyMove = decideAgencyMove({
    openThreads, plan: agencyPlan, hoursSinceLastMsg, isOpeningMessage: sessionCount === 0,
  });
  if (!longTermPlan) after(() => setLongTermPlan(userId, characterId, agencyPlan).catch(bg('setLongTermPlan')));
  if (agencyMove.type !== 'none') after(() => applyAgencyMove(agencyMove).catch(bg('applyAgencyMove')));

  const skillNeeded = inferNeededSkill(intentDecision.monologue + ' ' + responseBehavior.tone);
  const skillExemplars = skillNeeded ? await getExemplarsForSkill(skillNeeded, 2) : [];

  const imperfectionRoll = rollImperfection(sessionCount, null);

  // Assemble system prompt with all layers
  const bondScore = relationship?.bond_score ?? 0;

  // ── Archive of Echoes roleplay system (Part II) ──────────────────────────
  // Independent, fail-open lookups: relationship stage's secret-tier floor
  // plus any explicit trust-condition unlocks, a due memory-recall test (if
  // one is scheduled and due this turn), and this companion's cross-
  // companion relationship graph. See secret-tier-engine.ts,
  // memory-test-engine.ts, companion-awareness.ts. Every character not part
  // of this system simply resolves to empty/undefined and adds no sections.
  const [explicitSecretUnlocks, pendingMemoryTest] = await Promise.all([
    getUnlockedTiers(userId, characterId).catch(() => []),
    // Gated by compute-budget.ts under platform load — skipping this read
    // (and the recall-test flow it can trigger) is the same "no fragment
    // this turn" fail-open posture this Promise.all already uses for
    // every lookup here, just triggered by load instead of an error.
    computeBudget.allowMemoryTest
      ? getDueMemoryTest(userId, characterId).catch(() => null)
      : Promise.resolve(null),
  ]);
  // companionRelationships: COMPUTE-BUDGET FIX — previously re-fetched via
  // getCompanionRelationships(characterId) in this same Promise.all; now
  // sourced from companionContext.cognition.companionRelationships
  // (destructured above), which assembleCompanionContext() already
  // fetched this turn with the identical fail-open-to-[] behavior.
  const availableSecretTiers = computeAvailableTiers(relationship.stage, explicitSecretUnlocks);

  // UNIFIED-MIND-WIRE: single composite read across character-evolution,
  // reputation-engine, social-graph, crime/court/disaster-engine and
  // belief-engine — see lib/mind/unified-mind.ts header.
  //
  // COMPUTE-BUDGET FIX: previously re-fetched getUnifiedMind() here — now
  // sourced from companionContext.cognition.fortune (destructured as
  // unifiedMind above), which assembleCompanionContext() already fetched
  // this turn with the identical fail-open-to-null behavior. NOTE:
  // locationId is still omitted (no confirmed location field on the
  // `character` object) — same limitation as before this fix, unchanged.

  // A test presented on a prior turn stays 'pending' until graded. If one is
  // due, grade THIS incoming message against it first — that's the turn the
  // player would naturally answer on — and resolve it rather than
  // presenting a second test in the same reply.
  let dueMemoryTest = pendingMemoryTest;
  if (pendingMemoryTest && pendingMemoryTest.test.tested_at === null) {
    const passed = gradeRecall(message, pendingMemoryTest.memory);
    await resolveMemoryTest(pendingMemoryTest.test.id, passed ? 'passed' : 'failed').catch(bg('resolveMemoryTest'));
    // Already resolved this turn — don't also inject "present a new test" guidance.
    dueMemoryTest = null;
  }

  // Romance/romanticism flavor layer — style-only, derived purely from the
  // existing bond score and time-apart signals already computed above.
  // Never reacts to disclosed vulnerability; never touches the crisis
  // break-character path owned by prompt.ts. See romance-engine.ts.
  const romanceFragment = buildRomanceFragment({
    relationshipStageScore: Math.max(0, Math.min(1, bondScore / 100)),
    daysSinceLastMessage: hoursSinceLastMsg / 24,
    emotion: emotionTransitioned,
  });

  // Flirting/compliment/affection/gift/care flavor layers — same posture as
  // romance-engine.ts above: pure style guidance from existing relationship
  // signals, additive only, never touching the crisis break-character path.
  const flirtFragment = buildFlirtFragment({
    stage: relationship.stage,
    bondScore,
    // No per-character flirtiness trait exists in the schema today; default
    // keeps this engine neutral until/unless one is added.
    characterFlirtiness: 0.5,
    userInitiatedFlirt: /\b(flirt|wink|tease|cute|hot|kiss)\b/i.test(message),
  });

  // noticedDetail intentionally stays conservative (null unless something
  // concrete was actually flagged) — see compliment-engine.ts's header on
  // why manufacturing praise is exactly the failure mode this avoids.
  const noticedDetail = dynamicInterests?.[0] ?? null;
  const complimentFragment = buildComplimentFragment({
    stage: relationship.stage,
    bondScore,
    noticedDetail,
  });

  const affectionFragment = buildAffectionFragment({
    stage: relationship.stage,
    bondScore,
    streakDays: relationship.streak_days,
  });

  // Gift reactions: detect whether the most recent message in this
  // conversation was a gift (role='gift', see gift-engine.ts's
  // detectRecentGift header for why detection happens by parsing content
  // rather than a dedicated column). Fail-open — a lookup error or no gift
  // found just means no gift fragment this turn.
  let giftFragment: ReturnType<typeof buildGiftFragment> | null = null;
  try {
    if (conversationId) {
    const { data: lastMsgRows } = await supabaseAdmin
      .from('messages')
      .select('id,role,content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1);
    const recentGift = detectRecentGift(lastMsgRows?.[0] as { role: string; content: string } | undefined);
    if (recentGift) {
      // "First of type" = no earlier gift message in this conversation
      // mentions the same gift name. Cheap existence check, not exhaustive
      // history — good enough for a tone nudge, not load-bearing for
      // anything transactional (the commerce layer doesn't need this).
      const giftName = GIFT_CATALOGUE.find(g => g.type === recentGift.giftType)?.name ?? recentGift.giftType;
      const { count: priorCount } = await supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('role', 'gift')
        .ilike('content', `%${giftName}%`)
        .neq('id', lastMsgRows?.[0]?.id ?? '');
      giftFragment = buildGiftFragment({
        giftType: recentGift.giftType,
        rarity: recentGift.rarity,
        stage: relationship.stage,
        isFirstOfType: !priorCount,
      });

      // cognition/experience-engine.ts — GAP-FIX: recordExperience() was
      // exported from cognition-engine.ts's facade but never actually
      // called from any live route (see that engine's header). recentGift
      // here is unambiguous, already-classified evidence, not a guess —
      // same standard the conflict/repair hook elsewhere in this file
      // applies.
      after(() => {
        try {
          recordExperience(userId, characterId, psychology.total_interactions, {
            category: 'gift',
            summary: `received a gift (${recentGift.rarity})`,
            valence: 0.5,
            outcome: 'positive',
          });
        } catch (err) {
          logger.warn('stream: recordExperience(gift) failed', { userId, characterId, error: String(err) });
        }
      });
    }
    }
  } catch { /* fail open — no gift fragment this turn */ }

  const careFragment = buildCareFragment({
    stage: relationship.stage,
    followUpTopic: pendingFollowUps(journalEntries)[0] ?? null,
  });

  const partnershipFragment = buildPartnershipFragment({
    stage: relationship.stage,
    bondScore,
    daysKnown: psychology.days_known,
  });

  // Milestone count for aging-together-engine.ts's history-depth read —
  // relationship-milestones.ts's shape is a fixed set of named slots
  // (first_vulnerable_moment, favorite_topic, biggest_disagreement,
  // most_emotional_moment, shared_jokes[]), not an array, so count however
  // many are actually populated rather than assuming a length.
  const milestoneCount =
    (milestones?.first_vulnerable_moment ? 1 : 0) +
    (milestones?.favorite_topic ? 1 : 0) +
    (milestones?.biggest_disagreement ? 1 : 0) +
    (milestones?.most_emotional_moment ? 1 : 0) +
    (milestones?.shared_jokes?.length ? 1 : 0);

  const agingTogetherFragment = buildAgingTogetherFragment({
    stage: relationship.stage,
    daysKnown: psychology.days_known,
    milestoneCount,
  });

  // Legacy engine: gate how much of the character's own worldly standing
  // (status/legend/wealth/held assets — the raw facts already injected by
  // status-legend.ts's formatStatusForPrompt() elsewhere in the universe
  // context) leaks into this specific relationship's voice. Fails open to
  // an 'unremarkable'/'suppressed' fragment (which formats to '') on any
  // read error, same posture as every other *ForPrompt() call here.
  let legacyFragment = null as ReturnType<typeof buildLegacyFragment> | null;
  // Gated by compute-budget.ts: this is 4 extra DB reads for a decorative
  // fragment (see compute-budget.ts's header) — skipped under platform
  // load, same fail-open result ('no legacy fragment this turn') as the
  // catch below already produces on a real error.
  if (computeBudget.allowLegacyEngine) {
  try {
    const [legacyStatus, legacyLegend, legacyAttrs, legacyAssets] = await Promise.all([
      getSocialStatus(characterId),
      getLegend(characterId),
      getCharacterAttributes(characterId),
      getCharacterAssets(characterId),
    ]);
    legacyFragment = buildLegacyFragment(
      {
        status: legacyStatus,
        legend: legacyLegend,
        wealthTier: legacyAttrs?.wealth_tier ?? null,
        heldAssets: legacyAssets,
      },
      relationship.stage,
      bondScore,
    );
  } catch { /* fail open — no legacy fragment this turn */ }
  }

  // Relationship-history recap: the ordered "story so far," not injected
  // every turn (that's formatMilestonesForPrompt's job) — only when the
  // user is explicitly looking back this turn.
  let historyRecap = '';
  // newMilestone (relationship-engine.ts) isn't known until addRelationshipXp()
  // runs later this turn (post-reply), so it can't gate this turn's own
  // recap — only an explicit look-back intent in the user's own message can.
  const wantsHistoryRecap =
    /\b(remember when|how far we|come a long way|look back|our history|our story|how (we|it) started)\b/i.test(message);
  if (wantsHistoryRecap) {
    try {
      const timeline = await buildRelationshipHistoryTimeline(userId, characterId, {
        matchId: datingMode ? matchId : undefined,
      });
      historyRecap = formatHistoryRecapForPrompt(timeline);
    } catch (err) {
      await logHistoryReadFailure(userId, characterId, err);
    }
  }

  // Curiosity chain (curiosity/exploration/discovery-engine.ts) — WIRE-FIX,
  // see discovery-engine.ts's own header for why this previously never ran.
  // total_xp is used as a lightweight, always-available turn surrogate: it's
  // monotonic across the conversation and already computed by this point,
  // and the chain's own tolerance for approximate turn tracking (in-memory,
  // best-effort, decays on a maintenance sweep rather than needing exact
  // ordering) means an XP-derived proxy is fine — no need to thread a real
  // per-message counter through just for this.
  const curiosityTurn = relationship.total_xp;
  let curiosityPromptParts: string[] = [];
  try {
    const discovery = detectAndResolveCuriosity(userId, characterId, curiosityTurn, message);
    if (discovery) curiosityPromptParts.push(formatDiscoveryForPrompt(discovery));
    const stillOpen = getOpenCuriosities(userId, characterId)
      .filter(c => !discovery || c.id !== discovery.curiosityId);
    const openPrompt = formatCuriositiesForPrompt(stillOpen);
    if (openPrompt) curiosityPromptParts.push(openPrompt);
  } catch (err) {
    logger.warn('stream: curiosity chain failed', { error: String(err) });
  }
  const curiosityPrompt = curiosityPromptParts.join('\n');

  // Learning chain (skill-engine/knowledge-engine/practice-engine via
  // learning-engine.ts) — WIRE-FIX, same pattern as the curiosity chain
  // above: fully built, never called. In-memory stores (see skill-engine.ts/
  // knowledge-engine.ts/practice-engine.ts), so this is cheap to run every
  // turn. Candidates come from dynamicInterests (personality-evolution.ts) —
  // the character's own drifted interests are the natural "what might she
  // want to pick up next" source; goal-engine.ts's Goal has no SkillDomain
  // of its own, so it isn't a candidate source here.
  let learningPrompt = '';
  try {
    const skillCandidates = (dynamicInterests ?? []).slice(0, 3).map(name => ({
      domain: 'other' as const, name,
    }));
    if (skillCandidates.length > 0 || getLearningSnapshot(characterId).skills.length > 0) {
      pickNextFocus(characterId, curiosityTurn, skillCandidates);
      learningPrompt = formatLearningSnapshotForPrompt(getLearningSnapshot(characterId));
    }
  } catch (err) {
    logger.warn('stream: learning chain failed', { error: String(err) });
  }

  // Autobiography chain (memory-consolidation/timeline-engine/life-story
  // via autobiography-engine.ts) — WIRE-FIX, same pattern. Deliberately
  // gated on explicit "tell me about your life/past" intent rather than run
  // every turn: unlike the in-memory learning chain, this reads real
  // memory-graph nodes and (when available) relationship history, so it's
  // worth the same restraint historyRecap above uses rather than paying the
  // cost on every message.
  let autobiographyPrompt = '';
  const wantsLifeStory =
    /\b(your (life|past|story)|life story|tell me about (your ?self|yourself)|where (did|do) you come from|how (did|do) you become)\b/i.test(message);
  if (wantsLifeStory) {
    try {
      autobiographyPrompt = await getCachedAutobiographyPrompt(userId, characterId) ?? '';
      if (!autobiographyPrompt) {
        const relHistory = wantsHistoryRecap
          ? await buildRelationshipHistoryTimeline(userId, characterId, { matchId: datingMode ? matchId : undefined })
          : undefined;
        const autobiography = generateAutobiography(userId, characterId, {
          memoryNodes: semanticMemoryGraph,
          relationshipHistory: relHistory,
        });
        autobiographyPrompt = formatAutobiographyForPrompt(autobiography);
        setCachedAutobiographyPrompt(userId, characterId, autobiographyPrompt, autobiography.generatedAt)
          .catch(err => logger.warn('stream: autobiography cache write failed', { error: String(err) }));
      }
    } catch (err) {
      logger.warn('stream: autobiography chain failed', { error: String(err) });
    }
  }

  // Response language — auto-detected from what the user is typing (with
  // turn-to-turn smoothing so a stray "lol" doesn't flip it), or pinned
  // by profiles.preferred_language if the user set one explicitly in
  // /settings. See language-engine.ts. Fails open to English on any error.
  let languagePrompt = '';
  try {
    const languageState = await resolveLanguageState(userId, characterId, message, profile?.preferred_language ?? null);
    languagePrompt = languageState.promptBlock;
  } catch (err) {
    logger.warn('stream: language engine failed', { error: String(err) });
  }

  let systemPrompt = assembleFullPrompt({
    character: character as Parameters<typeof assembleFullPrompt>[0]['character'],
    psychology, relationship,
    curiosityPrompt,
    learningPrompt,
    autobiographyPrompt,
    // Milestone moments (first vulnerable moment, biggest disagreement, etc.)
    // are surfaced explicitly via formatMilestonesForPrompt below — excluding
    // them here avoids the same memory appearing twice in the prompt.
    memories:  semanticMemoryGraph.filter(m => !milestoneNodeIds(milestones).has(m.id)),
    evolutionStage, dynamicInterests,
    evolutionTraitsPrompt,
    // ARBITRATED (memory-arbiter.ts): memory.ts's flat facts and
    // user-fact-graph.ts's structured facts previously reached the model
    // via two independent, unreconciled paths — this fixed field (raw
    // formatMemoryForPrompt output) AND the separate 'fact-graph' budget
    // candidate below. If the two sources disagreed (e.g. memory.ts said
    // "teacher", fact-graph said "nurse"), the model saw both statements
    // with no signal which was current, and duplicate-but-differently-
    // worded facts double-charged the token budget. canonicalMemory
    // resolves that overlap by explicit precedence (fact-graph > legacy
    // memory.ts, then confidence, then recency) — see the 'fact-graph'
    // candidate below, which is now removed rather than duplicated.
    memoryFacts: canonicalMemory.factsPromptBlock,
    emotionInstructions,
    loreToReveal,
    revolution:  revolutionProfile,
    bondScore,
    userGender:  profile?.gender ?? null,
    priorityMemories,
    seedMemories,
    availableSecretTiers,
    dueMemoryTest: dueMemoryTest?.memory ?? null,
    companionRelationships,
    // Cognitive Layer — now assembled here rather than via post-hoc string
    // concatenation further down, so prompt.ts is the actual single source
    // of truth for these sections too. cognitionPromptBlock already IS
    // executiveDecision.promptBlock plus working-memory carry-forward (see
    // its own comment below at definition) — a strict superset of passing
    // executive-controller.ts's block alone, per prompt.ts's own field doc.
    selfModelPrompt:      selfModel.promptBlock,
    theoryOfMindPrompt:   theoryOfMind?.promptBlock ?? null,
    cognitionPrompt:      cognitionPromptBlock,
    beliefPipelinePrompt: beliefPipeline?.promptBlock ?? null,
    reputationPrompt:     reputationPipeline?.promptBlock ?? null,
    languagePrompt,
  });


  // ── Relationship engine layer: inject decision, agency, style, knowledge,
  // milestones, journal, private thoughts, craft exemplars, and imperfection.
  // Each formatter fails open to '' so a missing/empty source never breaks
  // the prompt — same posture as every existing *ForPrompt() call above.
  systemPrompt = [
    systemPrompt,
    formatWritingStyleForPrompt(writingStyle),
    formatIntentForPrompt(intentDecision, responseBehavior, writingStyle),
    intentRepeated ? 'Note: you\'ve responded this same way the last couple turns — vary your approach this time.' : '',
    formatAgencyForPrompt(agencyMove, strategy, agencyPlan),
    formatKnowledgeForPrompt(relevantKnowledge),
    formatMilestonesForPrompt(milestones),
    formatJournalForPrompt(journalEntries),
    (agencyMove.type === 'none' && pendingFollowUps(journalEntries).length)
      ? `You noted a follow-up for yourself last time: ${pendingFollowUps(journalEntries)[0]} — bring it up naturally if it fits.`
      : '',
    formatThoughtsForPrompt(unsurfacedThoughts),
    // UNIFIED-MIND-WIRE: the single fortune/self-awareness paragraph —
    // see lib/mind/unified-mind.ts. Placed here (not spread across
    // separate reputation/attributes/social calls) so the character's
    // sense of "how things have been going" reads as one coherent
    // self-narrative rather than several disconnected stat blocks.
    unifiedMind ? formatMindForPrompt(unifiedMind) : '',
    // COGNITION-WIRE: cognitionPromptBlock (executiveDecision.promptBlock +
    // working-memory carry-forward) is now passed directly into
    // assembleFullPrompt() above as `cognitionPrompt` instead of being
    // concatenated here — see that call's comment. Kept out of this array
    // to avoid injecting it twice.
    // COGNITION-WIRE (session 2): the structured thought stream composed
    // above. Guarded (high-leak-risk) thoughts are included in this same
    // block — internal-monologue.ts renders them as an explicit "must NOT
    // be said" section rather than a separate prompt fragment, so they
    // can't accidentally get dropped by a downstream .filter(Boolean) the
    // way a truly separate section might.
    monologueStream.promptBlock,
    goalVsWatchFlagConflict?.promptBlock ?? '',
    formatExemplarsForPrompt(skillExemplars),
    formatImperfectionForPrompt(imperfectionRoll.type),
    `Romantic register (${romanceFragment.register}): ${romanceFragment.styleInstruction} If a small romantic gesture fits naturally, something in this spirit works well: ${romanceFragment.suggestedGesture}.`,
    formatFlirtForPrompt(flirtFragment),
    formatComplimentForPrompt(complimentFragment),
    formatAffectionForPrompt(affectionFragment),
    formatGiftForPrompt(giftFragment),
    formatCareForPrompt(careFragment),
    formatPartnershipForPrompt(partnershipFragment),
    formatAgingTogetherForPrompt(agingTogetherFragment),
    legacyFragment ? formatLegacyForPrompt(legacyFragment) : '',
    historyRecap,
  ].filter(Boolean).join('\n\n');

  // Any private thought woven into this reply is now surfaced — don't reuse it next turn.
  if (unsurfacedThoughts.length) {
    after(() => markThoughtsSurfaced(unsurfacedThoughts.map(t => t.id)).catch(bg('markThoughtsSurfaced')));
  }

  // Log the decision for auditability / future weight-tuning (see goal-engine.ts).
  after(() => logDecision(userId, characterId, intentDecision).catch(bg('logDecision')));

  // S1: Session bridge
  if (sessionBridge?.bridgePrompt) {
    systemPrompt = sessionBridge.bridgePrompt + '\n\n' + systemPrompt;
  }
  // ATTENTION-WIRE: S2-S21 (plus the comfort/dating overlays) used to be
  // ~20 unconditional `systemPrompt += block.promptBlock` calls — no cost
  // accounting, nothing ever competed for space, so a chatty turn with
  // every relationship engine firing at once could inject an unbounded
  // amount of prompt text. attention-router.ts already existed and does
  // exactly the greedy budget-fill this needs (see its header); it just
  // never got these blocks to route. This builds one AttentionCandidate
  // per block instead of injecting directly, then a single routeAttention
  // call decides what actually fits this turn's 800-unit budget.
  //
  // NOTE: this is a separate, later routeAttention() call from the one
  // inside runExecutiveController() (ExecutiveInput.attentionBudget,
  // above) — that one runs before most of these engines are even
  // computed and covers memory/goal/task candidates; conflating the two
  // would mean routing S-block content against candidates that don't
  // exist yet. S1 (session bridge) is deliberately kept outside this pool
  // entirely: it's prepended ahead of the *whole* system prompt, not
  // appended alongside situational color, so it isn't really competing
  // for the same slot as S2-S21.
  //
  // Importance/urgency below are hand-set from what's already known about
  // each engine's role (see each engine's own header), not derived from a
  // shared formula — S11 emotional safety and an active pending rupture
  // are marked `exempt` so they're never starved out by budget the way
  // discretionary color (crush/infatuation) can be.
  const relationshipCandidates: AttentionCandidate[] = [];
  const addRelationshipCandidate = (
    id: string,
    content: string | null | undefined,
    importance: number,
    urgency: number,
    exempt = false,
  ) => {
    if (!content) return;
    relationshipCandidates.push({
      id,
      source: 'relationship_signal',
      content,
      importance,
      urgency,
      // No per-block staleness tracking exists yet (would need each
      // engine to report when it last actually surfaced) — 0 is neutral
      // under freshnessScore() rather than favoring or penalizing any
      // block; a real follow-up once that's worth the plumbing.
      staleness: 0,
      // Token-ish estimate; ~4 chars/token is the same rough heuristic
      // used elsewhere in this codebase for budget-shaped decisions.
      cost: Math.ceil(content.length / 4),
      exempt,
    });
  };

  // S2: Voice fingerprint
  addRelationshipCandidate(
    'voice-fingerprint',
    voiceFingerprint ? formatVoiceFingerprintForPrompt(voiceFingerprint) : null,
    55, 20,
  );
  // Self-Model / Theory of Mind — now passed directly into
  // assembleFullPrompt below — routing them through attention-router.ts
  // file — runCognitionCycle() (below) calls it internally via
  // executive-controller.ts, and this route.ts-local pass is only for
  // S2-S21, so re-injecting either here would double them up.
  // S3: Fact graph — REMOVED. factGraph's facts are now folded into
  // canonicalMemory (memory-arbiter.ts) and injected once via the fixed
  // memoryFacts field above, arbitrated against memory.ts's overlapping
  // facts instead of racing them as two independent, unreconciled
  // injections. See the comment at the memoryFacts field above.
  // S3b: Belief engine — durable, decaying, conflict-aware beliefs (see
  // cognition/belief-engine.ts). Deliberately kept alongside factGraph
  // rather than replacing it: factGraph is the raw, always-on extracted
  // signal; activeBeliefs is the reconciled/decayed read of the same kind
  // of evidence (fed by recordBeliefs() in S4 below, plus whatever else
  // calls recordBelief() over time). Some redundancy between the two is
  // expected for now — collapsing them is a real follow-up once
  // belief-engine.ts has had a full production turn to prove out its
  // decay/conflict behavior against factGraph's simpler always-on
  // rendering.
  const beliefPrompt = formatBeliefsForPrompt(activeBeliefs);
  addRelationshipCandidate('belief-pipeline', beliefPrompt, 50, 25);
  // Resets each surfaced belief's decay clock (see belief-decay.ts) —
  // a belief that keeps getting used shouldn't fade just because it
  // hasn't been re-stated. Fire-and-forget; never blocks the reply.
  // Deliberately unconditional on whether attention routing ends up
  // selecting the belief block this turn — "used" here means "was fresh
  // and eligible to surface," not "definitely rendered," same posture as
  // every other engine whose signal feeds a decision even when its own
  // promptBlock doesn't make the budget cut.
  if (activeBeliefs.length) {
    after(() => markBeliefsUsed(activeBeliefs).catch(bg('markBeliefsUsed')));
  }
  // S4: Family context — structured roster + tension flags derived from
  // factGraph's own 'family'/'pain_point' facts (see family-engine.ts).
  // Deliberately reuses factGraph rather than re-fetching anything.
  const familyContext = buildFamilyContext(factGraph);
  addRelationshipCandidate('family-context', familyContext.promptBlock, 45, familyContext.hasTension ? 45 : 20);
  // S5: Trust — how guarded she should be this turn, per domain (see
  // trust-engine.ts). ruptureStateInitial.pending is already fetched
  // above for evaluateRepair()'s own read; reused here rather than
  // fetched again.
  const trustState = computeTrustState({
    psychology, relationship, pendingRupture: ruptureStateInitial.pending,
  });
  addRelationshipCandidate('trust-state', trustState.promptBlock, 55, ruptureStateInitial.pending ? 60 : 30);
  // S6: Compatibility — slow, structural fit from character.values_list/
  // char_* traits against the user's accumulated fact graph (see
  // compatibility-engine.ts). Reuses character and factGraph already in
  // scope; quiet unless the signal is genuinely strong or genuinely thin.
  const compatibilityState = computeCompatibilityState(character as CharacterData, factGraph);
  addRelationshipCandidate('compatibility-state', compatibilityState.promptBlock, 40, 15);
  // S7: Chemistry — turn-level playful/banter spark from the current
  // message + emotion + thread rhythm (see chemistry-engine.ts).
  // Distinct from attraction below: chemistry applies on any
  // relationship track, not just romance.
  const chemistryState = computeChemistryState({
    userMessage: message,
    emotion:     emotionTransitioned,
    recentTurnsCenteredOnUser: threadSignals.recentTurnsCenteredOnUser,
  });
  addRelationshipCandidate('chemistry-state', chemistryState.promptBlock, 40, 30);
  // S8: Attraction — per-turn romantic pull magnitude, hard-gated to the
  // romance track only (see attraction-engine.ts's header). Composes
  // psychology.affection/excitement with compatibilityState/chemistryState
  // computed just above.
  const attractionState = computeAttractionState({
    psychology, relationship, compatibility: compatibilityState, chemistry: chemistryState,
  });
  addRelationshipCandidate('attraction-state', attractionState.promptBlock, 55, 35);
  // S9: Love language — how affection should be expressed to actually
  // land for this user, inferred from factGraph's preference/trait facts
  // (see love-language-engine.ts). Independent of attraction/chemistry —
  // applies regardless of relationship track.
  const loveLanguageState = computeLoveLanguageState(factGraph);
  addRelationshipCandidate('love-language-state', loveLanguageState.promptBlock, 40, 15);
  // S10: Vulnerability — sub-crisis emotional fragility read (see
  // vulnerability-engine.ts's header for why this is explicitly NOT
  // crisis detection and never runs on a turn crisis-detection.ts has
  // already flagged, since those short-circuit before this point).
  const vulnerabilityState = computeVulnerabilityState({
    userMessage: message,
    psychology,
    emotion:     emotionTransitioned,
    totalInteractions: psychology.total_interactions,
    daysKnown:         psychology.days_known,
  });
  // Elevated/high vulnerability is near-unconditional priority — the same
  // bar emotional-safety-engine.ts (S11, below) treats as "something real
  // happened here" — so it's exempt from the budget rather than left to
  // compete with discretionary color.
  addRelationshipCandidate(
    'vulnerability-state',
    vulnerabilityState.promptBlock,
    65,
    vulnerabilityState.tier === 'high' ? 80 : vulnerabilityState.tier === 'elevated' ? 65 : 30,
    vulnerabilityState.tier === 'elevated' || vulnerabilityState.tier === 'high',
  );
  // cognition/experience-engine.ts — GAP-FIX, same as the conflict/gift
  // hooks elsewhere in this file. vulnerabilityState.tier is already
  // computed (S10, immediately above) and 'elevated'/'high' is exactly
  // the same bar comfortFragment below uses to decide "something real
  // happened here" vs. ordinary conversation — reusing that bar rather
  // than inventing a separate threshold.
  //
  // outcome is deliberately NOT 'neutral' here: lesson-engine.ts's
  // extractLessons() explicitly skips neutral-outcome records
  // (`if (r.outcome === 'neutral') continue`), so a neutral record would
  // silently never contribute to a lesson/wisdom principle — exactly the
  // "looks wired, does nothing" failure this whole pass exists to close.
  // The available signal here is about the CHARACTER's handling of the
  // disclosure (lesson-engine's insightFor renders this category as
  // "sharing vulnerability tends to land well/badly"), not the valence of
  // whatever the user disclosed. emotionalSafetyState hasn't been
  // computed yet at this point in the file (it's S11, right below), so
  // the honest read available here is: a vulnerability tier this route
  // let through to generation at all (i.e., it didn't get short-circuited
  // by crisis-detection.ts earlier in this handler) is evidence the
  // moment was handled, not mishandled — recorded 'positive' on that
  // basis, not a guess about how the user felt. Deliberately unconditional
  // on whether attention routing selects the block below: the experience
  // happened this turn regardless of whether the budget had room to
  // narrate it back to the model right now.
  if (vulnerabilityState.tier !== 'none') {
    after(() => {
      try {
        recordExperience(userId, characterId, psychology.total_interactions, {
          category: 'vulnerability',
          summary: `${vulnerabilityState.tier === 'high' ? 'deep' : 'meaningful'} vulnerability shared and held well`,
          valence: 0.3,
          outcome: 'positive',
        });
      } catch (err) {
        logger.warn('stream: recordExperience(vulnerability) failed', { userId, characterId, error: String(err) });
      }
    });
  }
  // S11: Emotional safety — hard ceiling on attractionState.pull and
  // concrete never-say framings when vulnerability is elevated/high (see
  // emotional-safety-engine.ts). Always exempt from the budget: this is
  // the block whose whole job is to override S8's attraction guidance
  // when it fires, so it can never be the one that gets dropped for
  // space. Pushed last among the relationship candidates (order below is
  // preserved by assembleRoutedPrompt within a single source) so that,
  // same as before this wiring, it reads as the most authoritative,
  // last-word instruction rather than sitting alongside S8 as a peer.
  const emotionalSafetyState = computeEmotionalSafetyState({
    vulnerability: vulnerabilityState, attraction: attractionState,
  });
  // Everyday-comfort flavor layer — deliberately gated behind vulnerability
  // tier: only offered when this turn reads as 'none' (ordinary bad-day
  // mention), never when vulnerability-engine.ts flagged anything elevated
  // or higher. That case is emotional-safety-engine.ts's job entirely, not
  // this module's — see comfort-engine.ts's header.
  const comfortFragment = vulnerabilityState.tier === 'none'
    ? buildComfortFragment({
        stage: relationship.stage,
        mundaneFrustrationMentioned: /\b(tired|annoying|rough day|long day|stressful|frustrat\w*|exhaust\w*)\b/i.test(message),
      })
    : null;
  addRelationshipCandidate(
    'comfort-fragment',
    comfortFragment ? formatComfortForPrompt(comfortFragment) : null,
    30, 20,
  );
  // S12: Attachment security — structural attachment-pattern read (secure/
  // anxious/avoidant/disorganized), reusing psychology/relationship/trustState
  // already in scope (see attachment-security-engine.ts). Distinct from
  // attachment-drive.ts's per-turn bid-for-closeness impulse and from
  // security-drive.ts's risk-aversion drive — this is the slower pattern
  // those two express themselves through.
  const attachmentSecurityState = computeAttachmentSecurityState({ psychology, relationship, trust: trustState });
  addRelationshipCandidate('attachment-security-state', attachmentSecurityState.promptBlock, 45, 20);
  // S13: Trust repair — the prompt-facing half of repair-engine.ts that
  // never existed before (see trust-repair-engine.ts's header): gives the
  // character's voice this turn a real reaction to a repair/deflection/
  // escalation that just happened, or residual caution from unrecovered
  // conflict-safety history even with nothing actively pending. Exempt
  // when a rupture was actually pending going into this turn's evaluation
  // — same "near-unconditional" bar as S11/active-rupture generally.
  const trustRepairState = computeTrustRepairState({
    pendingBeforeEval: ruptureStateInitial.pending,
    repairResult: repairResultThisTurn,
    conflictSafetyScore: trustState.conflictSafety.score,
  });
  addRelationshipCandidate(
    'trust-repair-state',
    trustRepairState.promptBlock,
    60,
    ruptureStateInitial.pending || repairResultThisTurn ? 70 : 35,
    Boolean(ruptureStateInitial.pending),
  );
  // S14: Intimacy — synthesis layer answering "how close is it actually
  // appropriate to get right now," combining trustState's vulnerability
  // domain (emotional depth, any relationship track) with attractionState's
  // pull hard-capped at emotionalSafetyState's ceiling (romantic closeness,
  // romance track only). Reads and respects S11's ceiling rather than
  // competing with it (see intimacy-engine.ts's header) — pushed after
  // S11 below for the same reason.
  const intimacyState = computeIntimacyState({
    trust: trustState, attraction: attractionState, emotionalSafety: emotionalSafetyState,
  });
  // S11 pushed here, after intimacyState is computed (it reads
  // emotionalSafetyState but the candidate itself doesn't depend on
  // intimacyState) — kept in this position so the source-order-preserving
  // assembly still lands it after S8/attraction and S14/intimacy.
  addRelationshipCandidate('emotional-safety-state', emotionalSafetyState.promptBlock, 90, 90, true);
  addRelationshipCandidate('intimacy-state', intimacyState.promptBlock, 50, 30);
  // S15: Crush — pre-romance-track budding interest, hard-gated to
  // stranger/acquaintance/friend (see crush-engine.ts). Zero once
  // attraction-engine.ts's own romance-track gate takes over. Genuinely
  // discretionary color, not load-bearing — low importance/urgency so it
  // loses out to safety/trust content under a tight budget.
  const crushState = computeCrushState({
    relationship, compatibility: compatibilityState, chemistry: chemistryState, emotion: emotionTransitioned,
  });
  addRelationshipCandidate('crush-state', crushState.promptBlock, 30, 15);
  // S16: Infatuation — early romance-track limerence read, distinct from
  // attraction-engine.ts's steady-state pull (see infatuation-engine.ts).
  // Discretionary, same reasoning as S15.
  const infatuationState = computeInfatuationState({ relationship, psychology, attraction: attractionState });
  addRelationshipCandidate('infatuation-state', infatuationState.promptBlock, 30, 15);
  // S17: Attachment style — soft, internal-only read of how THIS USER
  // tends to approach closeness this turn (reassurance- vs space-
  // seeking), never surfaced or named to the user (see attachment-
  // style-engine.ts's guardrails). Distinct from attachment-security-
  // engine.ts, which models the character's own pattern.
  const attachmentStyleState = computeAttachmentStyleState({
    userMessage: message,
    emotion: emotionTransitioned,
    hoursSinceLastInteraction: hoursSinceLastMsgForDrives,
  });
  addRelationshipCandidate('attachment-style-state', attachmentStyleState.promptBlock, 35, 15);
  // S18: Love evolution — slow-moving romance-track arc (spark →
  // infatuation → deepening → mature_love → enduring), built from
  // infatuationState + trustState already computed above (see love-
  // evolution-engine.ts).
  const loveEvolutionState = computeLoveEvolutionState({
    relationship, psychology, infatuation: infatuationState, trust: trustState,
  });
  addRelationshipCandidate('love-evolution-state', loveEvolutionState.promptBlock, 40, 15);
  // S19-S21: Heartbreak / healing / closure — support arc for a
  // real-life breakup the user themselves disclosed (user-fact-graph.ts's
  // 'relationship'/'breakup' fact), never the character's own in-app
  // relationship (see heartbreak-engine.ts's header for why). Explicitly
  // forbids capitalizing on the disclosure to escalate romantic intensity.
  const heartbreakState = computeHeartbreakState({ facts: factGraph, emotion: emotionTransitioned });
  addRelationshipCandidate('heartbreak-state', heartbreakState.promptBlock, 50, 35);
  const healingState = computeHealingState({ heartbreak: heartbreakState, emotion: emotionTransitioned });
  addRelationshipCandidate('healing-state', healingState.promptBlock, 45, 25);
  const userReferencedPast = /\b(my ex|broke up|breakup|the relationship (i|we) (had|were in)|before (we|i) (met|started talking))\b/i.test(message);
  const closureState = computeClosureState({ healing: healingState, heartbreak: heartbreakState, userReferencedPast });
  addRelationshipCandidate('closure-state', closureState.promptBlock, 40, 20);

  // Single budget-fill pass over every S2-S21/comfort candidate above.
  // `executiveDecision.drives` (already computed earlier this turn) is
  // reused for the same curiosity/attachment/security alignment nudging
  // attention-router.ts already does for other callers, rather than
  // treating this pass as unrelated to what the rest of cognition decided
  // drives this turn.
  const relationshipAttention = routeAttention(
    relationshipCandidates,
    { total: 800 },
    executiveDecision.drives,
  );
  const relationshipPromptBlock = assembleRoutedPrompt(relationshipAttention);
  if (relationshipPromptBlock) {
    systemPrompt = systemPrompt + '\n\n' + relationshipPromptBlock;
  }

  // BUG-2 FIX: inject living-world context (location, social graph, active events/
  // stories, life/job/status/reputation/economy/assets). assembleUniverseContext
  // is fail-safe — already resolved to '' above if anything errored, so this
  // concatenation is always safe.
  if (universeContext) {
    systemPrompt = systemPrompt + universeContext;
  }

  // WIRE-FIX: matchId was validated by chatSchema but never destructured
  // above, so this overlay never ran on the streaming path — dating-mode
  // conversations here silently fell back to the base companion prompt
  // with no bond score, mood, streak, gifts, or milestone context, even
  // though the non-streaming /api/chat route applies it correctly.
  if (datingMode && matchId) {
    try {
      const matchResult = await supabaseAdmin
        .from('dating_matches')
        .select('bond_score,match_tier,character_mood,streak_days,milestones,dating_gifts(gift_name,created_at)')
        .eq('id', matchId).eq('user_id', userId)
        .order('created_at', { ascending: false, foreignTable: 'dating_gifts' })
        .single();
      const match = matchResult.data as null | {
        bond_score: number; match_tier: string; character_mood: string;
        streak_days: number; milestones: number;
        dating_gifts?: { gift_name: string; created_at: string }[];
      };
      if (match) {
        const milestoneMap: Record<string, number> = { soulmate: 16, week_streak: 8, first_gift: 4, deep_talk: 2, first_chat: 1 };
        const recentMilestone = Object.entries(milestoneMap).find(([, f]) => (match.milestones ?? 0) & f)?.[0];
        const gifts = match.dating_gifts;
        const datingCtx: DatingPromptContext = {
          characterName:  character.name,
          matchTier:      (match.match_tier as MatchTier) ?? 'spark',
          bondScore:      match.bond_score ?? 0,
          characterMood:  (match.character_mood as CharacterMood) ?? 'happy',
          streakDays:     match.streak_days ?? 0,
          lastGiftName:   gifts?.[0]?.gift_name,
          recentMilestone,
        };
        systemPrompt = assembleDatingPrompt(systemPrompt, datingCtx);
      }
    } catch (err) { logger.warn('stream: dating ctx failed', { matchId, error: String(err) }); }
  }

  // History was already kicked off (in parallel with the cognition cascade
  // above) via historyPromise — see the ROLEPLAY-LATENCY-FIX block near the
  // mature-content gate. Awaiting it here just picks up a result that, in
  // the common case, already finished minutes' worth of cognition work ago.
  const historyResult = await historyPromise;
  if (conversationId && historyResult.notFound) {
    await releaseStreamSlot(userId, streamScopeId);
    return jsonErr('Conversation not found', 404);
  }
  const rawHistory: { role: string; content: string }[] = historyResult.rows;

  if (conversationId) {
    // GAP-MESSAGE FIX: the user's message used to only get written to the DB
    // bundled together with the assistant's reply, in a single insert AFTER
    // generation finished (see below). That meant any interruption before
    // the stream completed — closing the tab, a dropped connection, even
    // just navigating away mid-reply — silently discarded the user's own
    // message along with the AI's, with nothing in messages/conversations
    // to show it was ever sent. Writing it here, as soon as we know the
    // conversation is real and belongs to this user, means it survives
    // regardless of what happens to the rest of the request.
    // Retry transient failures (pool exhaustion, brief connection blips) up to
    // 3x before giving up. If it still fails after retries, this is not safe
    // to swallow: the client is about to see its message rendered locally and
    // proceed as if it were durably stored, when it was not. Abort the whole
    // request with a distinct error the client can use to show a "not saved,
    // retry?" state instead of silently losing the message.
    try {
      await retry(async () => {
        const { error } = await supabase.from('messages').insert({
          conversation_id: conversationId, role: 'user', content: sanitize(message),
        });
        if (error) throw new Error(error.message);
      }, 3, 250, 2);
      // Log-only, non-blocking — see keyword-watch.ts. Never affects the
      // request; purely writes to the admin review queue on a match.
      watchKeywords({
        text: sanitize(message), direction: 'user_message',
        userId, characterId, conversationId,
      });
    } catch (err) {
      logger.error('stream:user-message-insert-failed', {
        conversationId, error: err instanceof Error ? err.message : String(err),
      });
      await releaseStreamSlot(userId, streamScopeId);
      return jsonErr('Could not save your message — please try sending it again', 503, 'MESSAGE_SAVE_FAILED');
    }
  }
  const history = trimHistoryForPlan(rawHistory, tier);

  // ── Response planner: separate think-before-you-speak stage ────────────
  // Already kicked off (as planPromise) back near the mature-content gate,
  // in parallel with the entire cognition cascade above — this just picks
  // up the result. Fails open internally (NEUTRAL_PLAN on any error/
  // timeout) — never blocks or breaks the stream. See response-planner.ts.
  const plan = await planPromise;
  systemPrompt = systemPrompt + formatPlanForPrompt(plan);

  const messagesPayload = [
    { role: 'system'    as const, content: systemPrompt },
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user'      as const, content: sanitize(message) },
  ];

  const guard = await costGuard.check({
    userId, tier, characterId, conversationId, systemPrompt,
    userMessage:    sanitize(message),
    messages:       messagesPayload,
    datingMode,
    rawMemoryFacts: memoryFacts,
    hasMemory:      memoryFacts.length > 0,
  });

  if (guard.blocked) {
    await releaseStreamSlot(userId, streamScopeId);
    return jsonErr(guard.blockReason ?? 'Request blocked', 429);
  }

  // ── Cache hit: single-frame SSE ───────────────────────────────────────────
  if (guard.cacheHit && guard.cachedReply) {
    await releaseStreamSlot(userId, streamScopeId);
    const enc = new TextEncoder();
    // Captured to a local const so TS keeps the truthy narrowing inside the
    // ReadableStream closure below (a property access on `guard` loses it).
    const cachedReply = stripLeakedMeta(guard.cachedReply);
    const rs  = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: cachedReply })}\n\n`));
        c.enqueue(enc.encode(`data: ${JSON.stringify({
          done: true, tokensUsed: 0, model: 'cached', cached: true,
          perCharacterRemaining: {
            remaining: Math.max(0, perCharCap.limit - perCharCap.used),
            limit:     perCharCap.limit,
          },
        })}\n\n`));
        c.close();
      },
    });
    return new Response(rs, { headers: sseHeaders(traceId) });
  }

  // ── SSE streaming ─────────────────────────────────────────────────────────
  const encoder    = new TextEncoder();
  let   fullReply  = '';
  let   tokensUsed = 0;
  let   usedModel  = guard.model;
  let   usedProv   = 'openrouter';
  // FALLBACK-CORRUPTION-FIX: tokens spent on providers that failed mid-stream
  // after already producing output. Real billed spend that must be counted
  // even though the content itself was discarded — see reset handling below.
  let   abandonedTokensBilled = 0;

  const streamController = new AbortController();
  const streamTimeout    = setTimeout(() => {
    streamController.abort();
    logger.warn('Stream hard timeout hit', { userId, traceId });
  }, MAX_STREAM_MS);

  req.signal.addEventListener('abort', () => {
    streamController.abort();
    // Belt-and-suspenders on top of the try/finally further down: release
    // the slot the instant we know the client is gone, rather than waiting
    // for execution to unwind through the generation loop first.
    void releaseStreamSlot(userId, streamScopeId);
  }, { once: true });

  const readable = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* client disconnected */ }
      };

      const keepaliveTimer = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')); }
        catch { clearInterval(keepaliveTimer); }
      }, KEEPALIVE_MS);

      // ── Simulated "typing" pause — see controlled-imperfection.ts. Purely
      // cosmetic pacing before generation begins; never delays billing or
      // the actual model call, and is capped low enough not to threaten
      // the 5-minute hard timeout.
      const responseWeight = classifyResponseWeight({
        emotionIntensity: emotionTransitioned.intensity,
        hasHiddenThought: !!plan.hidden_thought,
        plannedLength:    responseBehavior.length,
      });
      const typingDelayMs = computeTypingDelayMs(responseWeight);
      // Cap lowered from 4000ms alongside the TIMING_RANGES_MS reduction in
      // controlled-imperfection.ts — kept as a safety backstop in case that
      // config is ever loosened again, not because 1800ms (current max
      // range) needs clamping today.
      await new Promise(resolve => setTimeout(resolve, Math.min(typingDelayMs, 1800)));

      // Preamble hold-back: some provider checkpoints occasionally emit a
      // leaked classifier line ("User Safety: safe Response Safety: safe")
      // *before* the real in-character reply. guardReply() below only
      // catches this once the full reply is assembled — on the streamed
      // path that's too late, the leaked line would already have rendered
      // token-by-token. So: hold back sending the very first chunk(s)
      // while what's arrived so far still could be the start of a known
      // leak label, strip it if it resolves into one, and only then start
      // streaming normally. Bounded and narrow — only engages while the
      // reply's opening text actually matches a known label prefix, so
      // ordinary replies stream with zero added latency.
      let preambleBuffer = '';
      let preambleBuffering = true;
      const PREAMBLE_BUFFER_CAP = 120;

      try {
        for await (const chunk of routeStream(
          {
            messages:    guard.messages as { role: 'system' | 'user' | 'assistant'; content: string }[],
            modelTier:   guard.modelTier,
            maxTokens:        Math.min(guard.tokenBudget, DEFAULT_GENERATION_PARAMS.maxTokens) || guard.tokenBudget,
            temperature:      DEFAULT_GENERATION_PARAMS.temperature,
            topP:             DEFAULT_GENERATION_PARAMS.topP,
            frequencyPenalty: DEFAULT_GENERATION_PARAMS.frequencyPenalty,
            presencePenalty:  DEFAULT_GENERATION_PARAMS.presencePenalty,
            modelOverride:    guard.model,
            appUrl: env.NEXT_PUBLIC_APP_URL, traceId, stream: true,
            userId,
            escalated: guard.escalated,
          },
          streamController.signal,
        )) {
          // FALLBACK-CORRUPTION-FIX: a provider failed after already
          // yielding content, and we've fallen back to a fresh provider.
          // The partial output already sent to the client belongs to a
          // generation that will never complete — it MUST be discarded, not
          // concatenated with the new provider's independent response, or
          // the user sees garbled/duplicated text with no explanation.
          if (chunk.reset) {
            if (chunk.abandonedTokens) abandonedTokensBilled = chunk.abandonedTokens;
            fullReply = '';
            preambleBuffer = '';
            preambleBuffering = true;
            logger.warn('Stream provider fallback mid-generation, discarding partial output', {
              userId, traceId, abandonedTokens: abandonedTokensBilled, newProvider: chunk.provider,
            });
            // Tell the client to clear whatever it already rendered before
            // the new provider's content starts arriving.
            send({ reset: true });
          }
          if (chunk.done) {
            usedModel = chunk.model; usedProv = chunk.provider;
            if (chunk.usage) tokensUsed = chunk.usage.promptTokens + chunk.usage.completionTokens;
            if (chunk.abandonedTokens) abandonedTokensBilled = chunk.abandonedTokens;
            break;
          }
          if (streamController.signal.aborted) break;
          fullReply += chunk.delta;
          usedModel  = chunk.model;
          usedProv   = chunk.provider;

          if (preambleBuffering) {
            preambleBuffer += chunk.delta;
            const stillPotentialLeak = preambleBuffer.length < PREAMBLE_BUFFER_CAP
              && looksLikePotentialMetaLeakPrefix(preambleBuffer);
            if (!stillPotentialLeak) {
              const cleaned = stripLeakedMeta(preambleBuffer);
              if (cleaned) send({ delta: cleaned });
              preambleBuffering = false;
              preambleBuffer = '';
            }
            // else: keep holding, nothing sent to the client yet.
          } else {
            send({ delta: chunk.delta });
          }
        }
        // Reply ended entirely within the buffered preamble window (a very
        // short reply) — flush whatever's left, stripped, before moving on.
        if (preambleBuffering && preambleBuffer) {
          const cleaned = stripLeakedMeta(preambleBuffer);
          if (cleaned) send({ delta: cleaned });
          preambleBuffering = false;
          preambleBuffer = '';
        }
      } catch (err) {
        clearInterval(keepaliveTimer);
        clearTimeout(streamTimeout);

        if (!streamController.signal.aborted) {
          logger.warn('Stream failed, fallback to sync', {
            error: sanitizeProviderError(err), traceId,
          });
          try {
            const ctx = await orchestrator.prepare({
              userId, tier, characterId, conversationId, traceId,
              modelTier: guard.modelTier,
              escalated: guard.escalated,
              precomputed: {
                tokenBudget:  guard.tokenBudget,
                multiplier:   guard.multiplier,
                throttled:    guard.throttled,
                currentUsage: guard.currentUsage,
                dailyLimit:   guard.dailyLimit,
              },
            });
            const res = await orchestrator.infer(ctx, guard.messages);
            fullReply  = res.reply;
            tokensUsed = res.tokensUsed;
            usedModel  = res.model;
            usedProv   = res.provider ?? 'openrouter';
            await orchestrator.finish(ctx, res);
            send({ delta: stripLeakedMeta(fullReply) });
          } catch {
            metrics.recordError({ type: 'stream_fallback_fail', route: '/api/chat/stream' });
            try {
              send({ error: 'AI service temporarily unavailable', done: true });
              controller.close();
            } catch {
              // client already gone
            } finally {
              await releaseStreamSlot(userId, streamScopeId);
            }
            return;
          }
        }
      }

      clearInterval(keepaliveTimer);
      clearTimeout(streamTimeout);

      // BUGFIX: fullReply accumulates raw provider deltas in the streaming
      // loop above (`fullReply += chunk.delta`) and is assigned raw
      // (`fullReply = res.reply`) in the sync-fallback catch block. Only the
      // *outgoing* SSE payload was ever run through stripLeakedMeta() —
      // preambleBuffer cleaning and the fallback branch's
      // `send({ delta: stripLeakedMeta(fullReply) })` both clean what the
      // client sees, but neither reassigns fullReply itself. Every
      // downstream consumer of fullReply — the messages table insert
      // below, queueForTraining, costGuard.record, recordCharacterReply —
      // was therefore receiving unstripped text, so any leaked classifier
      // line ("User Safety: safe Response Safety: safe") that made it past
      // the live-stream cleaning still landed in chat history verbatim and
      // rendered as its own bubble on every reload. Clean fullReply once,
      // here, before anything downstream reads it.
      fullReply = stripLeakedMeta(fullReply);

      // ── Reply guard — defense-in-depth check on the completed reply ────
      // Runs here (after the loop, not per-chunk) because it needs the full
      // assembled text — see src/lib/moderation/reply-guard.ts's header for
      // why a per-token check isn't meaningful. Known limitation: on the
      // streamed path, deltas were already sent to the client as they
      // arrived, so this can't prevent those tokens from rendering — it can
      // only correct after the fact, reusing the same reset:true mechanism
      // already used above for provider-fallback mid-stream corrections.
      // Expected to fire extremely rarely (see reply-guard.ts); this is a
      // safety net, not the primary content-quality mechanism.
      const guardedReply = guardReply({
        replyText: fullReply, userId, characterId, conversationId: conversationId ?? null,
      });
      if (guardedReply !== fullReply) {
        send({ reset: true });
        send({ delta: guardedReply });
        fullReply = guardedReply;
      }

      // Log-only, non-blocking — see keyword-watch.ts. Runs after
      // reply-guard so hits are checked against the final, already-sent
      // text; never mutates fullReply or affects the response.
      watchKeywords({
        text: fullReply, direction: 'character_reply',
        userId, characterId, conversationId: conversationId ?? null,
      });

      // ── Cognition layer: close the loop for next turn ────────────────
      // COGNITION-WIRE: metacognition.ts needs a real succeeded/failed
      // signal per turn to be worth anything (see checkCalibration()'s
      // header). The best proxy available at this call site without a
      // deeper "did the reply actually address X" classifier: a fresh,
      // non-repeated intent attempted against an active task counts as
      // an attempt that landed; a repeated intent on the same task is
      // the closest observable stand-in for "didn't land." This is a
      // proxy, not a ground-truth outcome — same honest caveat
      // executive-controller.ts already documents for
      // recordTaskOutcomeNotYet() just above.
      if (executiveDecision.selectedGoal) {
        const domain = `goal:${executiveDecision.selectedGoal.goal.category}`;
        const succeeded = !!executiveDecision.activeTask && !intentRepeated;
        recordMetacognitionOutcome(userId, characterId, {
          turn: recentIntents.length,
          domain,
          succeeded,
          statedConfidence: executiveDecision.confidence.overall,
        });
        const stall = checkStall(userId, characterId, domain);
        if (stall.recommendation !== 'continue') {
          logger.info('[chat/stream] goal pursuit stalling', {
            userId, characterId, domain, consecutiveFailures: stall.consecutiveFailures,
            recommendation: stall.recommendation,
          });
        }
      }

      // COGNITION-WIRE: reflection-engine.ts distills this turn's
      // admitted working-memory items (+ the reasoning conflict, if any)
      // into ResolutionNotes, then reportCognitionOutcome() (=
      // consciousness-loop.ts's resolveCycle) actually commits them back
      // into working-memory.ts so the next turn's tick() sees them
      // rather than only ever seeing this turn's fresh attend() output.
      const turnNotes: ResolutionNote[] = reflectOnTurn({
        turn: recentIntents.length,
        admitted: cognitionCycle.attention.admitted,
        mismatches: [],
        prediction: null,
      });
      if (goalVsWatchFlagConflict?.unresolved.length) {
        turnNotes.push({
          id: 'goal-vs-watchflag-conflict',
          kind: 'watch_flag',
          summary: 'pursuing an ordinary goal while a watch flag was still active this turn',
          activation: 0.7,
        });
      }
      if (turnNotes.length > 0) {
        reportCognitionOutcome(userId, characterId, turnNotes);
      }

      // ── Rupture & repair: record a boundary that was actually sent ──────
      // WIRE FIX: markRuptureRaised() was previously exported but never
      // called. Fire only after the reply is finalized (post reply-guard),
      // matching repair-engine.ts's own contract ("NOT before, since this
      // should reflect a boundary that was actually communicated"). Uses
      // recentIntents.length as the turn counter — same value already used
      // for the anti-repetition check above.
      if (intentDecision.intent === Intent.SetBoundary) {
        after(() => markRuptureRaised(
          userId, characterId, intentDecision.monologue, recentIntents.length,
        ).catch(bg('markRuptureRaised')));
      }

      if (!tokensUsed) {
        // Genuine fallback now (previously this was the only path — see
        // STREAM-TOKENS-FIX in provider-router.ts). Only reached if a
        // provider truly never sent usage data. Sum the whole outbound
        // payload (system + history + user message), not just systemPrompt —
        // the old estimate silently dropped conversation history from the
        // input-token count entirely, which understated cost more the
        // longer a conversation ran.
        const inputChars = guard.messages.reduce((sum, m) => sum + m.content.length, 0);
        tokensUsed = Math.ceil(fullReply.length / 3.5) + Math.ceil(inputChars / 4);
      }

      // FALLBACK-CORRUPTION-FIX: add back tokens spent on providers that
      // failed mid-stream after already generating (now-discarded) content.
      // That was real, billed provider usage — omitting it here means the
      // actual OpenRouter/Groq/etc invoice for this request is silently
      // higher than what gets recorded against the user's usage/spending cap.
      tokensUsed += abandonedTokensBilled;

      // WIRE-FIX: rateLimit was missing from the success path here — the
      // non-streaming route includes it in every successful response so the
      // client can update its quota display without a second round-trip.
      //
      // CONCURRENCY-LEAK FIX: controller.close() throws if the client has
      // already disconnected (nav away, tab close, or a new message aborting
      // this one) — the platform errors the controller on client abort, and
      // that throw used to happen with nothing protecting the next line, so
      // releaseStreamSlot() below never ran. The slot is scoped per
      // conversation (STREAM_SLOT_TTL = 120s), so one interrupted request
      // used to silently lock that same conversation for 2 minutes — this
      // no longer affects any other conversation/character. try/finally
      // guarantees the slot releases regardless.
      // try/finally guarantees the slot releases regardless.
      try {
        send({
          done: true, tokensUsed, model: usedModel, provider: usedProv, latencyMs: Date.now() - start, rateLimit,
          perCharacterRemaining: {
            remaining: Math.max(0, perCharCap.limit - perCharCap.used),
            limit:     perCharCap.limit,
          },
          // World-reference tap tracking: the client needs to know THIS
          // message revealed lore so it can render the "tap to learn more"
          // affordance. loreKey lets the tap handler dedupe against
          // lore_discoveries instead of re-sending the full content.
          ...(loreToReveal ? { loreReveal: { key: loreDiscoveryKey, content: loreToReveal } } : {}),
        });
        controller.close();
      } catch {
        // client already gone — nothing to send, nothing to close
      } finally {
        await releaseStreamSlot(userId, streamScopeId);
      }

      // ── Post-stream billing + enrichment ───────────────────────────────────
      // controller.close() above already ended the response the client sees.
      // Everything below — including the per-user billing call — previously
      // ran as plain awaited/fire-and-forget code in the same function
      // instance, racing serverless teardown once the stream signaled done.
      // after() is the documented fix for exactly this: work that must finish
      // once a streaming response has finished streaming. See ARCH-04.
      after(async () => {
        const newCount = sessionCount + 1;
        const isLong   = newCount >= 30;

        // 28-state emotion → psychology event mapping (replaces the old single
        // regex /thank|love|miss|happy|great|amazing|beautiful|perfect/i check).
        const emotionEvent      = emotionToPsychologyEvent(previousEmotion, emotionTransitioned);
        const sentimentPositive = emotionTransitioned.valence > 0.15;

        // S6: Per-user billing — 3 retries via recordTokensUsed, DLQ on failure
        if (tokensUsed > 0) {
          try {
            await retry(() => recordTokensUsed(userId, tokensUsed), 3, 200, 2);
          } catch {
            await enqueueBillingRetry(userId, tokensUsed, traceId);
            logger.error('stream:billing:dlq-enqueued', { userId, tokensUsed, traceId });
          }
        }

        if (conversationId && fullReply) {
          // BUGFIX: these were previously fire-and-forget (`void ...then()`)
          // *inside* the after() callback. after() only keeps the function
          // instance alive until the promise IT returns settles — an
          // un-awaited insert started inside it is not covered by that
          // guarantee, so on a fast teardown (e.g. the client navigating
          // away right after the stream closed) the write could be dropped
          // before it reached Postgres. Symptom matched exactly: user
          // messages (inserted earlier, synchronously awaited) persisted,
          // assistant replies (this fire-and-forget insert) sometimes did
          // not. Awaiting both closes the race.
          // Retry transient failures, then fall back to supabaseAdmin (bypasses
          // RLS) in case the failure was an RLS/session edge case rather than a
          // real outage. This insert runs after the client's stream has already
          // closed, so there is no request left to fail — the only way to avoid
          // silently losing the assistant's reply is to retry hard and, if that
          // still fails, enqueue it to message-dlq.ts for cron-driven recovery
          // rather than just logging and moving on.
          try {
            await retry(async () => {
              const { error } = await supabase.from('messages').insert({
                conversation_id: conversationId, role: 'assistant', content: fullReply,
              });
              if (error) throw new Error(error.message);
            }, 3, 250, 2);
          } catch (err) {
            logger.warn('stream:assistant-message-insert-retry-exhausted', {
              conversationId, error: err instanceof Error ? err.message : String(err),
            });
            try {
              const { error: adminErr } = await supabaseAdmin.from('messages').insert({
                conversation_id: conversationId, role: 'assistant', content: fullReply,
              });
              if (adminErr) throw new Error(adminErr.message);
            } catch (adminInsertErr) {
              logger.error('stream:assistant-message-insert-failed', {
                conversationId, error: adminInsertErr instanceof Error ? adminInsertErr.message : String(adminInsertErr),
              });
              await enqueueMessageRecovery(conversationId, 'assistant', fullReply, traceId)
                .catch(bg('enqueueMessageRecovery.assistant'));
            }
          }
          // Training-data collection: consent-gated, redacted, fire-and-forget.
          // No-op unless profiles.training_data_consent is true for this user
          // — see src/lib/training/queue.ts for the consent check and
          // redaction pass, and src/app/api/cron/training-data-export for
          // what happens to queued items downstream.
          queueForTraining({
            userId, characterId, userMessage: sanitize(message), assistantReply: fullReply,
          }).catch(bg('queueForTraining'));
          const { error: convUpdateErr } = await supabase.from('conversations')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', conversationId);
          if (convUpdateErr) {
            logger.error('stream:conversation-update-failed', { conversationId, error: convUpdateErr.message });
          }
        }

        await costGuard.record({
          userId, cacheKey: guard.cacheKey,
          cacheWords:    guard.cacheWords    ?? new Set(),
          cacheSig:      guard.cacheSig      ?? null,
          cacheBandKeys: guard.cacheBandKeys ?? null,
          reply: fullReply, tokensUsed,
        }).catch(bg('costGuard.record'));

        applyPsychologyEvent(userId, characterId, isLong ? 'long_session' : 'message_sent').catch(bg('applyPsychologyEvent.baseline'));
        if (emotionEvent) applyPsychologyEvent(userId, characterId, emotionEvent).catch(bg('applyPsychologyEvent.emotion'));

        // conversation-thread-tracker.ts phase 2 — record whether this
        // reply asked a new question and its length, for next turn's
        // curiosity/status drive signals. Symmetric with getTurnSignals()
        // called near the top of this handler.
        if (fullReply) {
          after(() => recordCharacterReply(
            userId, characterId, fullReply, psychology.total_interactions,
          ).catch(bg('recordCharacterReply')));
        }

        // Previously fire-and-forget with the result discarded — leveledUp/
        // newMilestone never reached the user. Awaited now so we can surface
        // it below alongside the other milestone bits.
        const progression = await addRelationshipXp(
          userId, characterId, isLong ? 'long_session' : 'message_sent',
        ).catch(err => { logger.warn('stream:addRelationshipXp failed', { error: String(err) }); return null; });

        // ── Secret Moments System (secret-moments.ts) ────────────────────
        // Cheap detection every turn; the expensive generateSecretMoment()
        // call only fires on an actual new-milestone hit (rare — a handful
        // of times over a relationship's whole lifetime). Persisted as its
        // own row (secret_moments table) and, best-effort, as a distinct
        // assistant message inserted just before the normal reply, so it
        // reads as a discovery rather than prompt flavor folded into the
        // next ordinary turn.
        if (relationship) {
          const relationshipStartedAt = new Date(Date.now() - psychology.days_known * 86_400_000).toISOString();
          const secretHit = detectSecretMoment({
            relationship,
            messageCount: psychology.total_interactions + 1,
            relationshipStartedAt,
          });
          if (secretHit) {
            after(async () => {
              try {
                const moment = await generateSecretMoment({
                  characterName:    character.name,
                  characterSummary: (character.description as string) ?? '',
                  voiceFingerprint,
                  milestoneName:    secretHit.name,
                  daysTogether:     psychology.days_known,
                  messageCount:     psychology.total_interactions + 1,
                  memories:         memoryGraph,
                }, secretHit.bit);

                await supabaseAdmin.from('secret_moments').insert({
                  user_id: userId, character_id: characterId,
                  milestone_name: moment.milestoneName, moment_type: moment.type,
                  title: moment.title, content: moment.content, generated_by: moment.generatedBy,
                });

                // Surface as its own assistant message, distinct from the
                // normal reply that follows in this same turn. Guarded on
                // conversationId — it's optional on the request (a brand-new
                // conversation's first turn has none yet), and the
                // secret_moments row above is recorded either way.
                if (conversationId) {
                  await supabase.from('messages').insert({
                    conversation_id: conversationId, role: 'assistant',
                    content: `${moment.title}\n\n${moment.content}`,
                  });
                }

                await supabaseAdmin
                  .from('character_relationships')
                  .update({ milestones: (relationship.milestones | secretHit.bit) })
                  .eq('user_id', userId).eq('character_id', characterId);
              } catch (err) {
                logger.warn('secret-moments: turn-level generation/persist failed', {
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            });
          }
        }

        maybeRecordFirstMeeting(userId, characterId, character.name).catch(bg('maybeRecordFirstMeeting'));
        updateMemory(userId, characterId, character.name, message, fullReply, newCount).catch(bg('updateMemory'));

        // ── Emotion engine: persist state for next turn's transition model ──
        setEmotionState(userId, characterId, emotionTransitioned).catch(bg('setEmotionState'));

        // ── Emotion engine: auto-record emotionally significant moments ─────
        const emotionalMemoryCandidate = evaluateEmotionalMemory(emotionTransitioned);
        if (emotionalMemoryCandidate.shouldRecord) {
          maybeRecordEmotionalMemory(
            userId, characterId, emotionalMemoryCandidate, message, emotionTransitioned.primary,
          ).catch(bg('maybeRecordEmotionalMemory'));
        }

        // S4: Fact graph extraction, then reconcile the fresh facts into
        // the durable, decaying, conflict-aware belief store (see
        // cognition/belief-engine.ts). Chained rather than run in
        // parallel because extractAndStoreFacts() busts
        // user-fact-graph.ts's Redis cache as its last step — reading
        // facts back before that completes would risk getFactGraph()
        // returning the pre-extraction cached set. Facts with category
        // 'belief' are skipped: that's user-fact-graph.ts's catch-all for
        // stated opinions, which doesn't map cleanly onto any single
        // BeliefCategory here — leaving them to factGraphPrompt (S3
        // above) rather than guessing a mapping.
        (async () => {
          await extractAndStoreFacts(userId, characterId, message, fullReply, newCount);
          const freshFacts = await getFactGraph(userId, characterId);
          const evidence: BeliefEvidence[] = freshFacts
            .filter(f => f.category !== 'belief')
            .map(f => ({
              subject:    `${f.category}:${f.key}`,
              category:   f.category as BeliefCategory,
              statement:  f.value,
              polarity:   f.key === 'dislikes' ? 'negates' as const : 'affirms' as const,
              // Heuristic-sourced facts are capped below their own stated
              // confidence — same conservatism user-fact-graph.ts already
              // applies by scoring heuristic extraction lower than AI
              // extraction (0.65 vs 0.7-0.95 — see its PATTERNS/aiExtract).
              confidence: f.source === 'ai' ? f.confidence : Math.min(f.confidence, 0.75),
              source:     f.source,
            }));
          if (evidence.length) await recordBeliefs(userId, characterId, evidence);
        })().catch(bg('extractAndStoreFacts+recordBeliefs'));

        // Law 8 — bidirectional evolution: open-vocabulary interest capture
        // (with reinforcement/decay, see bidirectional-evolution.ts) plus
        // late-night habit-shift detection.
        const evolutionSignal = detectEvolutionSignal(message);
        if (evolutionSignal) recordEvolutionSignal(userId, characterId, evolutionSignal).catch(bg('recordEvolutionSignal'));
        const habitSignal = detectHabitSignal(new Date().getHours(), message);
        if (habitSignal) recordEvolutionSignal(userId, characterId, habitSignal).catch(bg('recordEvolutionSignal.habit'));

        // Surprise & promise-keeping engine (surprise-engine.ts) — write side.
        // Detection/surfacing of due promises + anniversaries runs entirely
        // in the daily /api/cron/surprises job, not on the hot path.
        const promise = extractPromise(message);
        if (promise) recordPromise(userId, characterId, promise).catch(bg('recordPromise'));

        // Curiosity chain — write side: if this reply asked the user a real
        // question, open a durable curiosity so a later turn (via
        // detectAndResolveCuriosity above, next message) can follow up on
        // it instead of the thread silently disappearing. In-memory and
        // synchronous (no I/O), so no bg() wrapper needed.
        try {
          detectAndRaiseCuriosity(userId, characterId, curiosityTurn, fullReply);
        } catch (err) {
          logger.warn('stream: curiosity raise failed', { error: String(err) });
        }

        // ── Relationship engine layer: recompute milestones off the just-
        // updated memory graph, maybe write a journal entry, maybe record a
        // fresh independent thought — all fail-open, all fire-and-forget.
        recomputeMilestones(userId, characterId).catch(bg('recomputeMilestones'));
        maybeWriteJournalEntry(
          userId, characterId, character.name, memoryGraph, {
            primary: emotionTransitioned.primary, intensity: emotionTransitioned.intensity,
          },
        ).catch(bg('maybeWriteJournalEntry'));
        maybeRecordThoughts(userId, characterId, {
          hoursSinceLastMessage: hoursSinceLastMsg,
          lastEmotionIntensity:  emotionTransitioned.intensity,
          lastEmotionLabel:      emotionTransitioned.primary,
          unresolvedTopic: agencyMove.type === 'raise_thread'
            ? { subject: agencyMove.content } : undefined,
        }).catch(bg('maybeRecordThoughts'));

        // A goal surfaced this turn (see response-planner's goal_move) becomes
        // a trackable open thread — something to genuinely follow up on next
        // time, rather than a one-off mention that's forgotten immediately.
        if (plan.goal_move && activeGoals[0]) {
          openThread(userId, characterId, activeGoals[0].label, plan.goal_move).catch(bg('openThread'));
        }

        // (superseded by the Law 8 bidirectional-evolution signal detection above)
        if (newCount % 10 === 0) {
          const drift = computeSessionDrift(psychology.days_known, psychology.total_interactions, newCount, sentimentPositive);
          // NOTE: previously Math.round()'d these — established/deep-stage
          // drift deltas are almost always < 0.5 by design (slow, gradual
          // evolution), so rounding silently zeroed out drift for exactly
          // the long-term relationships this is meant to serve. The RPC and
          // underlying columns are now NUMERIC(5,2) (see
          // 20260819e_fix_personality_drift_precision.sql), so the raw
          // fractional delta is passed through and actually accumulates.
          void supabaseAdmin.rpc('apply_personality_drift', {
            p_user_id: userId, p_character_id: characterId,
            p_openness: drift.openness, p_warmth: drift.warmth,
            p_confidence: drift.confidence,
          });
        }
        const streakResult = await checkStreak(userId).catch(err => { bg('checkStreak')(err); return null; });
        progressQuest(userId, 'messages', 1).catch(bg('progressQuest.messages'));
        if (isLong) progressQuest(userId, 'long_session', 1).catch(bg('progressQuest.longSession'));
        awardXp(userId, isLong ? 25 : 2, isLong ? 'long_session' : 'message_sent').catch(bg('awardXp'));

        // ── Surface milestones that were previously computed and discarded ──
        // Both the level-up from addRelationshipXp above and the remaining
        // EXTENDED_MILESTONES bits (first_lore, month_streak, messages_100,
        // anniversary_1m, first_reunion — see relationship-engine.ts) ride
        // the existing character_surprises / SSE notifications pipeline
        // (src/app/api/notifications/route.ts) rather than needing a new
        // delivery mechanism.
        if (relationship) {
          const extraUnlocks = await checkAndApplyExtraMilestones(
            userId, characterId, relationship.milestones, {
              totalMessages:         psychology.total_interactions + 1,
              daysKnown:             psychology.days_known,
              streakDays:            streakResult?.streak ?? 0,
              isFirstLoreReveal,
              hoursSinceLastMessage: hoursSinceLastMsg,
            },
          ).catch(err => { logger.warn('stream:checkAndApplyExtraMilestones failed', { error: String(err) }); return []; });

          for (const unlock of extraUnlocks) {
            recordSurprise(
              userId, characterId, 'milestone_unlocked',
              `You just hit a milestone with ${character.name}: ${unlock.label}.`,
            ).catch(bg('recordSurprise.milestone'));
          }

          if (progression?.leveledUp) {
            recordSurprise(
              userId, characterId, 'milestone_unlocked',
              `Your relationship with ${character.name} has grown — you're now ${progression.newStage.replace(/_/g, ' ')}.`,
            ).catch(bg('recordSurprise.levelUp'));
          }
        }

        // ── BUG-V2-2 FIX: Advance beliefs based on session quality ──────────
        const sessionIsQualifying = tokensUsed > 500 || newCount > 5;
        if (sessionIsQualifying) {
          const beliefDeltas: Array<{ beliefId: string; delta: number }> = [];
          if (relationship?.streak_days && relationship.streak_days > 0) {
            beliefDeltas.push({ beliefId: 'trust_people',    delta: 2 });
            beliefDeltas.push({ beliefId: 'love_permanence', delta: 1 });
          }
          if (tokensUsed > 1500) {
            beliefDeltas.push({ beliefId: 'self_worth',  delta: 2 });
            beliefDeltas.push({ beliefId: 'future_hope', delta: 1 });
          }
          if (emotionTransitioned.valence > 0.3) {
            beliefDeltas.push({ beliefId: 'future_hope', delta: 1 });
          }
          if (beliefDeltas.length > 0) {
            Promise.all(
              beliefDeltas.map(({ beliefId, delta }) =>
                advanceBelief(userId, characterId, beliefId, delta)
                  .catch(err => logger.warn('stream:advanceBelief failed', { beliefId, error: String(err) }))
              )
            ).catch(() => {});
          }
        }
        // C-02: checkDailyMessageCap (called above before the stream started)
        // already incremented the Redis counter atomically as part of the gate
        // check. The previous fire-and-forget line here double-counted every
        // streaming message. Removed.
        if (character.current_goal) {
          generateAmbitionUpdate(userId, characterId, character.name, character.current_goal, character.goal_progress ?? 0).catch(bg('generateAmbitionUpdate'));
        }

        // S5: Update session bridge
        if (conversationId && fullReply) {
          const allMessages = [
            ...rawHistory,
            { role: 'user',      content: message   },
            { role: 'assistant', content: fullReply },
          ];
          updateSessionBridge(userId, characterId, conversationId, allMessages).catch(bg('updateSessionBridge'));
        }

        metrics.recordRequest({
          tier, modelTier: guard.modelTier, provider: usedProv,
          result:          'success', latencyMs: Date.now() - start,
          promptTokens:     Math.ceil(systemPrompt.length / 4),
          completionTokens: Math.ceil(fullReply.length / 4),
        });
      });
    },
  });

  return new Response(readable, { headers: sseHeaders(traceId) });
}

function sseHeaders(traceId: string): HeadersInit {
  return {
    'Content-Type':           'text/event-stream',
    'Cache-Control':          'no-cache, no-store',
    'Connection':             'keep-alive',
    'X-Accel-Buffering':      'no',
    'X-Content-Type-Options': 'nosniff',
    'X-Trace-Id':             traceId,
  };
}
