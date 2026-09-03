import { generateStructured } from './capability';
/**
 * Character Memory System — Vantrix Silicon Valley
 *
 * Maintains a per-user per-character fact store that persists across sessions.
 * Facts are lightweight strings extracted from AI conversations and stored in
 * Redis with a rolling 30-day TTL.
 *
 * Architecture:
 *   - Key: vantrix:memory:{userId}:{characterId}
 *   - Value: JSON array of MemoryFact objects (capped at MAX_FACTS)
 *   - TTL: 30 days, refreshed on every write
 *
 * The memory is injected into the system prompt as a "What you remember about
 * this user:" section — invisible infrastructure that dramatically increases
 * perceived relationship depth and retention.
 *
 * Fact extraction uses a fast regex heuristic first; an AI extraction pass
 * is done asynchronously on every 5th message to catch richer context.
 */

import { logger }  from '@/lib/logger';
import { redis }              from '@/lib/redis';
import { sanitize } from '@/lib/sanitize';


const MEMORY_TTL   = 60 * 60 * 24 * 30; // 30 days
const MAX_FACTS    = 20;                  // max stored facts per pair
const MIN_INTERVAL = 5;                   // AI extraction every N messages

export interface MemoryFact {
  text:       string;  // e.g. "User's name is Jake"
  source:     'heuristic' | 'ai';
  confidence: number;  // 0–1
  createdAt:  number;
}

function memKey(userId: string, characterId: string): string {
  return `vantrix:memory:${userId}:${characterId}`;
}

// ── Fast heuristic extraction (sync, no API call) ─────────────────────────

const NAME_RE    = /(?:my name(?:'s| is) |call me |i'm |i am )([A-Z][a-z]{1,20})/gi;
const PREF_RE    = /i (?:love|hate|really like|enjoy|prefer|can't stand) ([^.!?,]{4,60})/gi;
const FACT_RE    = /i(?:'m| am) (?:a |an )?([^.!?,]{4,50}) (?:years? old|from|who|that|and)/gi;
const WORK_RE    = /(?:i work (?:as|at)|my job is|i'm a) ([^.!?,]{4,40})/gi;
const LOCATION_RE = /(?:i live in|i'm from|i'm based in) ([^.!?,]{3,40})/gi;

// Exported for regression testing (Phase B audit persistent-injection fix) —
// see src/lib/ai/__tests__/persistent-fact-injection.test.ts. Pure function,
// safe to export.
export function heuristicExtract(text: string): MemoryFact[] {
  const facts: MemoryFact[] = [];
  const now = Date.now();

  const addMatch = (match: RegExpExecArray, label: string) => {
    // SEC FIX (Phase B audit, 2026-08-06): PREF_RE/FACT_RE/WORK_RE/LOCATION_RE
    // capture up to 60 chars of arbitrary non-.!?, text straight from the
    // raw, unsanitized user message — e.g. "I love <payload>" captures
    // <payload> verbatim. Unlike the current turn's message (run through
    // sanitize() before reaching the model, stripping injection patterns),
    // this captured text is PERSISTED as a memory fact and re-injected raw
    // into the system prompt on every future turn via
    // formatMemoryForPrompt() — a durable, cross-session prompt-injection
    // vector that bypasses the current-turn sanitization entirely.
    // sanitize() here closes that: same injection-pattern stripping,
    // applied before persistence instead of only at read time.
    const raw = match[1]?.trim();
    if (raw && raw.length > 2) {
      const safe = sanitize(raw, 200);
      if (safe) facts.push({ text: `${label}: ${safe}`, source: 'heuristic', confidence: 0.7, createdAt: now });
    }
  };

  let m: RegExpExecArray | null;
  NAME_RE.lastIndex = 0;
  while ((m = NAME_RE.exec(text)) !== null) addMatch(m, "User's name");

  PREF_RE.lastIndex = 0;
  while ((m = PREF_RE.exec(text)) !== null) addMatch(m, 'User preference');

  FACT_RE.lastIndex = 0;
  while ((m = FACT_RE.exec(text)) !== null) addMatch(m, 'User fact');

  WORK_RE.lastIndex = 0;
  while ((m = WORK_RE.exec(text)) !== null) addMatch(m, 'User occupation');

  LOCATION_RE.lastIndex = 0;
  while ((m = LOCATION_RE.exec(text)) !== null) addMatch(m, 'User location');

  return facts;
}

// ── AI extraction (async, called every MIN_INTERVAL messages) ────────────

async function aiExtract(
  userMessage: string,
  aiReply: string,
  characterName: string,
): Promise<MemoryFact[]> {
  const now = Date.now();

  const parsed = await generateStructured<string[]>({
    caller: 'memory',
    maxTokens: 200,
    temperature: 0.1,
    system: `You extract memorable facts about a user from conversation snippets. 
Output ONLY a JSON array of short fact strings (max 8, each under 60 chars).
Facts must be about the USER (not ${characterName}). Only include concrete, reusable facts.
Example: ["User's name is Alex", "User likes hiking", "User works as a nurse", "User is from Tokyo"]
If no notable facts, output an empty array: []`,
    // SEC FIX (Phase B audit, 2026-08-06): sanitize() strips
    // prompt-injection patterns before this reaches a second,
    // typically-cheaper LLM call — the main chat call already does
    // this for `message`, but this is a separate embedding of the
    // same raw text into a different prompt, so it needs its own
    // pass rather than relying on the caller having sanitized it
    // for an unrelated purpose.
    user: `User said: "${sanitize(userMessage, 500)}"\n${characterName} replied: "${aiReply.slice(0, 300)}"`,
  });

  if (!parsed || !Array.isArray(parsed)) return [];

  return parsed
    .filter((s): s is string => typeof s === 'string' && s.length > 3 && s.length < 80)
    .slice(0, 8)
    // SEC FIX (Phase B audit, 2026-08-06): same persistence-time
    // sanitization as heuristicExtract's addMatch() above — whatever
    // this extraction model returns is stored verbatim and re-injected
    // into every future system prompt via formatMemoryForPrompt(), so it
    // needs the same injection-pattern stripping applied before storage,
    // not just at the input side above.
    .map(text => sanitize(text, 100))
    .filter(text => text.length > 3)
    .map(text => ({ text, source: 'ai' as const, confidence: 0.9, createdAt: now }));
}

// ── Public API ────────────────────────────────────────────────────────────

/** Load all stored facts for a user-character pair */
export async function getMemory(userId: string, characterId: string): Promise<MemoryFact[]> {
  try {
    const raw = await redis.get<string>(memKey(userId, characterId));
    if (!raw) return [];
    return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) as MemoryFact[];
  } catch (err) {
    logger.warn('[memory] Operation failed, returning empty', { error: String(err) });
    return [];
  }
}

/** Format memory for injection into the system prompt */
export function formatMemoryForPrompt(facts: MemoryFact[]): string {
  if (!facts.length) return '';
  const lines = facts
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12)
    .map(f => `- ${f.text}`);
  return `\nWhat you remember about this user:\n${lines.join('\n')}`;
}

/**
 * Extract and persist new facts from a conversation exchange.
 * Called asynchronously (non-blocking) after every AI response.
 *
 * @param messageCount - total messages in this session (triggers AI extraction every MIN_INTERVAL)
 */
export async function updateMemory(
  userId:        string,
  characterId:   string,
  characterName: string,
  userMessage:   string,
  aiReply:       string,
  messageCount:  number,
): Promise<void> {
  try {
    const key = memKey(userId, characterId);

    // Load existing facts
    const existing = await getMemory(userId, characterId);
    const existingTexts = new Set(existing.map(f => f.text.toLowerCase()));

    // Extract new facts — heuristic always, AI on cadence
    const newFacts: MemoryFact[] = heuristicExtract(userMessage);

    if (messageCount % MIN_INTERVAL === 0) {
      const aiFacts = await aiExtract(userMessage, aiReply, characterName);
      newFacts.push(...aiFacts);
    }

    // Deduplicate against existing
    const unique = newFacts.filter(f => !existingTexts.has(f.text.toLowerCase()));
    if (!unique.length) {
      // Still refresh TTL
      if (existing.length) await redis.expire(key, MEMORY_TTL);
      return;
    }

    // Merge, cap at MAX_FACTS (keep highest confidence)
    const merged = [...existing, ...unique]
      .sort((a, b) => b.confidence - a.confidence || b.createdAt - a.createdAt)
      .slice(0, MAX_FACTS);

    await redis.set(key, JSON.stringify(merged), { ex: MEMORY_TTL });

    logger.info('Memory updated', {
      userId, characterId,
      addedFacts: unique.length,
      totalFacts: merged.length,
    });

  } catch (err) {
    // Memory is non-critical — never throw
    logger.warn('Memory update failed', { userId, characterId, error: String(err) });
  }
}

/** Clear all memory for a user-character pair (user-facing reset) */
export async function clearMemory(userId: string, characterId: string): Promise<void> {
  await redis.del(memKey(userId, characterId));
}

/** Get all character memory keys for a user (for GDPR export) */
export async function getUserMemoryKeys(userId: string): Promise<string[]> {
  try {
    const keys = await redis.keys(`vantrix:memory:${userId}:*`);
    return keys as string[];
  } catch {
    return [];
  }
}
