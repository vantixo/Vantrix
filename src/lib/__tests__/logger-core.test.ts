import { describe, it, expect } from 'vitest';
import { redact, buildLogEntry } from '../logger-core';

describe('logger-core redact()', () => {
  it('redacts exact-match sensitive keys, case-insensitively', () => {
    const result = redact({ password: 'hunter2', Token: 'abc', SECRET: 'xyz' }) as Record<string, unknown>;
    expect(result.password).toBe('[REDACTED]');
    expect(result.Token).toBe('[REDACTED]');
    expect(result.SECRET).toBe('[REDACTED]');
  });

  it('redacts nested sensitive keys recursively', () => {
    const result = redact({ user: { id: '123', apiKey: 'sk_live_abc' } }) as { user: Record<string, unknown> };
    expect(result.user.id).toBe('123');
    expect(result.user.apiKey).toBe('[REDACTED]');
  });

  it('redacts sensitive keys inside arrays', () => {
    const result = redact([{ password: 'a' }, { password: 'b' }]) as Record<string, unknown>[];
    expect(result[0].password).toBe('[REDACTED]');
    expect(result[1].password).toBe('[REDACTED]');
  });

  it('does not redact legitimate in-app currency fields that happen to contain "token" — exact match only, not substring', () => {
    const result = redact({ tokenCost: 10, tokensUsed: 25, tokenCredit: 100, tokenBudget: 5 }) as Record<string, unknown>;
    expect(result.tokenCost).toBe(10);
    expect(result.tokensUsed).toBe(25);
    expect(result.tokenCredit).toBe(100);
    expect(result.tokenBudget).toBe(5);
  });

  it('redacts the additional hardened variants (session/bearer/id tokens, client/api secrets, DOB)', () => {
    const result = redact({
      sessionToken: 'a', bearerToken: 'b', idToken: 'c', jwt: 'd',
      clientSecret: 'e', apiSecret: 'f', privateKey: 'g',
      dob: '2000-01-01', dateOfBirth: '2000-01-01',
    }) as Record<string, unknown>;
    for (const v of Object.values(result)) expect(v).toBe('[REDACTED]');
  });

  it('leaves non-sensitive data untouched', () => {
    const result = redact({ userId: 'abc', characterId: 'def', count: 3 }) as Record<string, unknown>;
    expect(result).toEqual({ userId: 'abc', characterId: 'def', count: 3 });
  });
});

describe('buildLogEntry', () => {
  it('produces valid JSON with level, message, ts, and redacted meta', () => {
    const entry = JSON.parse(buildLogEntry('error', 'test message', { password: 'secret', userId: '1' }));
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('test message');
    expect(entry.ts).toBeTruthy();
    expect(entry.password).toBe('[REDACTED]');
    expect(entry.userId).toBe('1');
  });

  it('merges request-context extras (requestId, userId) alongside meta', () => {
    const entry = JSON.parse(buildLogEntry('info', 'msg', { foo: 'bar' }, { requestId: 'req-1', userId: 'u-1' }));
    expect(entry.requestId).toBe('req-1');
    expect(entry.userId).toBe('u-1');
    expect(entry.foo).toBe('bar');
  });
});
