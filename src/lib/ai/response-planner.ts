/**
 * src/lib/ai/response-planner.ts
 *
 * The "true separate stage" planning call. Runs BEFORE the main generation
 * LLM call, on a cheap/fast model (NANO tier — free-tier OpenRouter model,
 * see model-router.ts), and produces a small structured plan covering four
 * pipeline stages in one round trip:
 *
 *   Life Simulation  — what this character is plausibly doing/feeling
 *                       right now, outside this conversation
 *   Goal Planner      — whether/how their current_goal should surface in
 *                       THIS specific reply (not just background drift)
 *   Hidden Thoughts    — a private thought the character has but wouldn't
 *                       say out loud, decided in advance rather than
 *                       improvised inline mid-response
 *   Response Planner  — the actual strategy for this reply: what emotional
 *                       beat to hit, what to lead with, what to avoid
 *
 * Design notes:
 *   - Single planning call, not four — four separate LLM round trips per
 *     message would be prohibitive on both latency and cost. One small
 *     JSON-structured call gets the real benefit (a distinct think-before-
 *     you-speak stage) without 4x-ing inference cost.
 *   - Fails OPEN. If the planning call errors, times out, or returns
 *     unparseable JSON, callers get sensible neutral defaults and the main
 *     response generation proceeds completely normally — a broken planner
 *     must never break or block the actual chat reply.
 *   - Short hard timeout (PLANNER_TIMEOUT_MS) so a slow planning call can
 *     never meaningfully add to perceived response latency beyond a bounded
 *     ceiling.
 */

import { routeCompletion } from '@/lib/ai/provider-router';
import { logger }          from '@/lib/logger';
import type { EmotionalState } from '@/lib/ai/emotion-engine';

const PLANNER_TIMEOUT_MS = 2500;
const PLANNER_MAX_TOKENS = 220;

export interface ResponsePlan {
  life_context:       string;  // what they're plausibly doing/feeling right now
  goal_move:          string;  // how (if at all) current_goal should surface this reply — '' if not
  hidden_thought:      string;  // a private thought for this reply — '' if none needed
  response_strategy:  string;  // the concrete plan for this reply: lead with X, hit emotional beat Y, avoid Z
}

export const NEUTRAL_PLAN: ResponsePlan = {
  life_context:      '',
  goal_move:         '',
  hidden_thought:     '',
  response_strategy: 'Respond naturally in character, guided by the rest of the system prompt.',
};

export interface PlanInput {
  characterName:    string;
  characterSummary: string;   // short: personality + occupation + current_goal, already truncated by caller
  recentMessages:   Array<{ role: 'user' | 'assistant'; content: string }>; // last few turns, most-recent last
  emotion:          EmotionalState;
  relationshipStage?: string;
  traceId?:         string;
}

/** Format the plan into the small prompt-injection block prompt.ts consumes. */
export function formatPlanForPrompt(plan: ResponsePlan): string {
  const lines: string[] = ['\n── Before You Reply (internal plan — do not restate this to the user) ──'];
  if (plan.life_context)      lines.push(`Right now, plausibly: ${plan.life_context}`);
  if (plan.goal_move)         lines.push(`Let your goal surface this way, if it fits naturally: ${plan.goal_move}`);
  if (plan.hidden_thought)     lines.push(`A private thought you're holding (use the [thought] tag convention if it comes out): ${plan.hidden_thought}`);
  lines.push(`Your plan for this specific reply: ${plan.response_strategy}`);
  return lines.join('\n');
}

function buildPlannerPrompt(input: PlanInput): string {
  const history = input.recentMessages
    .slice(-4)
    .map(m => `${m.role === 'user' ? 'User' : input.characterName}: ${m.content.slice(0, 300)}`)
    .join('\n');

  return [
    `You are the internal planning layer for a character named ${input.characterName} in a chat app.`,
    `Character: ${input.characterSummary}`,
    input.relationshipStage ? `Relationship stage with this user: ${input.relationshipStage}` : '',
    `Detected user emotion: ${input.emotion.primary} (intensity ${(input.emotion.intensity * 10).toFixed(0)}/10)`,
    '\nRecent conversation:',
    history || '(start of conversation)',
    '\nOutput ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:',
    '{"life_context": string, "goal_move": string, "hidden_thought": string, "response_strategy": string}',
    'Keep every field to one short sentence. Use "" for any field that genuinely does not apply to this specific turn — do not force one in.',
    '"response_strategy" is required and must always be filled: name the concrete emotional beat or move this specific reply should make.',
  ].filter(Boolean).join('\n');
}

function parsePlan(raw: string): ResponsePlan | null {
  try {
    // Strip accidental markdown fences defensively — some free-tier models
    // wrap JSON in ```json blocks despite instructions not to.
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const parsed  = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || parsed === null) return null;

    return {
      life_context:      typeof parsed.life_context      === 'string' ? parsed.life_context.slice(0, 200)      : '',
      goal_move:         typeof parsed.goal_move         === 'string' ? parsed.goal_move.slice(0, 200)         : '',
      hidden_thought:     typeof parsed.hidden_thought     === 'string' ? parsed.hidden_thought.slice(0, 200)     : '',
      response_strategy: typeof parsed.response_strategy === 'string' && parsed.response_strategy
        ? parsed.response_strategy.slice(0, 250)
        : NEUTRAL_PLAN.response_strategy,
    };
  } catch {
    return null;
  }
}

/**
 * Runs the planning stage. Never throws — always resolves, falling back to
 * NEUTRAL_PLAN on any failure (timeout, provider error, unparseable JSON).
 */
export async function planResponse(input: PlanInput): Promise<ResponsePlan> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), PLANNER_TIMEOUT_MS);

  try {
    const response = await routeCompletion({
      messages: [
        { role: 'system', content: buildPlannerPrompt(input) },
        { role: 'user',   content: 'Produce the JSON plan now.' },
      ],
      modelTier:   'NANO',
      maxTokens:   PLANNER_MAX_TOKENS,
      temperature: 0.4,
      traceId:     input.traceId,
      signal:      controller.signal,
    });

    const plan = parsePlan(response.reply);
    if (!plan) {
      logger.warn('response-planner: unparseable plan JSON, falling back to neutral', {
        character: input.characterName, raw: response.reply.slice(0, 200),
      });
      return NEUTRAL_PLAN;
    }
    return plan;

  } catch (err) {
    // Fail open — a broken planner must never break the actual chat reply.
    logger.warn('response-planner: planning call failed, falling back to neutral', {
      character: input.characterName,
      error: err instanceof Error ? err.message : String(err),
    });
    return NEUTRAL_PLAN;
  } finally {
    clearTimeout(timeout);
  }
}
