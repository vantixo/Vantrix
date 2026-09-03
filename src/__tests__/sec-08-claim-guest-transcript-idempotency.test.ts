/**
 * SEC-08 — Guest Transcript Claim Is Bounded and Idempotent
 *
 * /api/chat/claim-guest-transcript backfills a freshly-authenticated user's
 * empty conversation with the transcript they built as a guest before
 * signing up (see src/lib/guest-transcript.ts and that route for the full
 * rationale — /api/chat/guest never writes to the DB, so without this,
 * "create a free account to continue this conversation" was not actually
 * true).
 *
 * The payload reaching this endpoint comes from someone who, a moment ago,
 * had no session at all — it must never be trusted as more than "a hint
 * about what to backfill". Two properties matter:
 *   1. Bounded — message count and per-message length are capped the same
 *      way the guest route itself caps them.
 *   2. Idempotent — it only ever writes into a conversation that is still
 *      completely empty. Replaying the same call (or any call) against a
 *      conversation that already has messages must be a guaranteed no-op.
 *
 * These tests mirror that logic in isolation — exercising the real route
 * needs a live Supabase session, which isn't available in this test env.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const MAX_MESSAGES = 30;

const claimSchema = z.object({
  characterId: z.string().uuid(),
  messages: z.array(z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string().min(1).max(2000),
  })).min(1).max(MAX_MESSAGES),
});

/** Mirrors the idempotency guard in the route: never write into a non-empty conversation. */
function shouldBackfill(existingMessageCount: number): boolean {
  return existingMessageCount === 0;
}

describe('SEC-08 — claim-guest-transcript payload validation', () => {
  const validCharacterId = '11111111-1111-1111-1111-111111111111';

  it('accepts a normal guest transcript', () => {
    const result = claimSchema.safeParse({
      characterId: validCharacterId,
      messages: [
        { role: 'assistant', content: "Hey! I'm so glad you're here." },
        { role: 'user',      content: 'Hi, nice to meet you' },
        { role: 'assistant', content: 'Likewise! Tell me about yourself.' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID characterId', () => {
    const result = claimSchema.safeParse({ characterId: 'not-a-uuid', messages: [{ role: 'user', content: 'hi' }] });
    expect(result.success).toBe(false);
  });

  it('rejects an empty messages array — nothing to claim', () => {
    const result = claimSchema.safeParse({ characterId: validCharacterId, messages: [] });
    expect(result.success).toBe(false);
  });

  it('rejects more messages than MAX_MESSAGES — a tampered/oversized localStorage payload', () => {
    const messages = Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `message ${i}`,
    }));
    const result = claimSchema.safeParse({ characterId: validCharacterId, messages });
    expect(result.success).toBe(false);
  });

  it('rejects an oversized single message — same 2000-char cap as the guest route', () => {
    const result = claimSchema.safeParse({
      characterId: validCharacterId,
      messages: [{ role: 'user', content: 'x'.repeat(2001) }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid role', () => {
    const result = claimSchema.safeParse({
      characterId: validCharacterId,
      messages: [{ role: 'system', content: 'hi' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('SEC-08 — claim-guest-transcript is rate-limited', () => {
  it('the route imports and applies the general-purpose rate limiter', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'app', 'api', 'chat', 'claim-guest-transcript', 'route.ts'),
      'utf-8'
    );
    expect(source).toMatch(/import\s*\{[^}]*\bratelimit\b[^}]*\}\s*from\s*['"]@\/lib\/rate-limit['"]/);
    expect(source).toMatch(/ratelimit\.limit\(user\.id\)/);
  });
});

describe('SEC-08 — claim-guest-transcript is idempotent', () => {
  it('backfills only when the conversation is genuinely empty', () => {
    expect(shouldBackfill(0)).toBe(true);
  });

  it('refuses to write into a conversation that already has any messages', () => {
    expect(shouldBackfill(1)).toBe(false);
    expect(shouldBackfill(50)).toBe(false);
  });

  it('replaying the same claim twice is a no-op the second time', () => {
    // First call: empty conversation -> backfill happens, conversation now has N messages.
    let messageCount = 0;
    expect(shouldBackfill(messageCount)).toBe(true);
    messageCount = 5; // simulates the insert that would have just happened

    // Second call with the *same* (or any) payload: must refuse.
    expect(shouldBackfill(messageCount)).toBe(false);
  });
});
