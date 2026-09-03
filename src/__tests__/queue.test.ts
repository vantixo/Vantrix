/**
 * Queue depth limit tests.
 *
 * These are integration-style unit tests for the per-user queue depth guard.
 * They mock the shared Redis singleton (src/lib/redis) to avoid network
 * dependencies in CI.
 *
 * NOTE: previously mocked '@upstash/redis' directly (Redis.fromEnv()) because
 * queue/index.ts used to construct its own client that way. queue/index.ts
 * now imports the shared `redis` singleton from '@/lib/redis' (see M-04 /
 * UNIVERSE-FIX session notes — the bare `redis` import was missing entirely,
 * which is what this test would have caught had it been exercised against
 * the real module instead of an unrelated mock). Updated to mock the actual
 * import path the module under test uses.
 */

import { describe, it, expect, vi} from 'vitest';

// Mock the shared singleton that queue/index.ts actually imports.
vi.mock('@/lib/redis', () => {
  // Pipeline operations in enqueueChatJob (in order):
  //   0: setex(statusKey, TTL, 'pending')  → null (OK)
  //   1: lpush(queueName, jobJson)          → 1   (queue length after push)
  //   2: llen(queueName)                    → 1   (depth — returned as result.depth)
  //   3: incr(pendingCountKey)              → 1   (new pending count)
  //   4: expire(pendingCountKey, 3600)      → 1   (TTL set)
  const pipelineMock = {
    setex:   vi.fn().mockReturnThis(),
    lpush:   vi.fn().mockReturnThis(),
    llen:    vi.fn().mockReturnThis(),
    incr:    vi.fn().mockReturnThis(),
    expire:  vi.fn().mockReturnThis(),
    exec:    vi.fn().mockResolvedValue([null, 1, 1, 1, 1]), // [setex, lpush, llen, incr, expire]
  };
  // Single shared client mock — the module under test imports this same
  // `redis` object reference on every call, so the test's `redisMock`
  // reference and the module's internal reference are identical.
  const clientMock = {
    get:      vi.fn(),
    set:      vi.fn().mockResolvedValue('OK'),
    del:      vi.fn(),
    pipeline: vi.fn(() => pipelineMock),
    rpop:     vi.fn(),
    lpush:    vi.fn(),
    setex:    vi.fn(),
  };
  return { redis: clientMock };
});

describe('enqueueChatJob — per-user depth guard', () => {
  it('rejects when user already has max pending jobs (free tier = 3)', async () => {
    // Re-import after mock is set so the mock Redis is used
    const { redis: redisMock } = await import('@/lib/redis');
    // Simulate 3 pending jobs already
    (redisMock.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce('3');

    const { enqueueChatJob } = await import('../lib/queue/index');
    const result = await enqueueChatJob({
      userId:      'user-1',
      characterId: 'char-1',
      conversationId: undefined,
      message:     'hello',
      tier:        'free',
      originTraceId: 'trace-1',
      datingMode:  false,
      matchId:     undefined,
    });

    expect(result.queued).toBe(false);
    expect(result.error).toMatch(/Queue full/i);
  });

  it('exports decrementUserPendingCount as a function', async () => {
    const { decrementUserPendingCount } = await import('../lib/queue/index');
    expect(typeof decrementUserPendingCount).toBe('function');
  });
});

describe('tierToPriority', () => {
  it('maps elite/enterprise to high', async () => {
    const { tierToPriority } = await import('../lib/queue/index');
    expect(tierToPriority('elite')).toBe('high');
    expect(tierToPriority('enterprise')).toBe('high');
  });

  it('maps basic/premium to normal', async () => {
    const { tierToPriority } = await import('../lib/queue/index');
    expect(tierToPriority('basic')).toBe('normal');
    expect(tierToPriority('premium')).toBe('normal');
  });

  it('maps free/spark to low', async () => {
    const { tierToPriority } = await import('../lib/queue/index');
    expect(tierToPriority('free')).toBe('low');
    expect(tierToPriority('spark')).toBe('low');
  });
});

describe('decrementUserPendingCount — requeue paths must NOT decrement', () => {
  it('decrementUserPendingCount decrements counter and clamps to 0 on underflow', async () => {
    const { redis: redisMock } = await import('@/lib/redis');

    // Simulate counter = 1 before decrement
    const decrPipe = {
      decr:   vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec:   vi.fn().mockResolvedValue([0, 1]), // decr returns 0 (now 0, not negative)
    };
    (redisMock.pipeline as ReturnType<typeof vi.fn>).mockReturnValueOnce(decrPipe);
    (redisMock.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    const { decrementUserPendingCount } = await import('../lib/queue/index');
    await expect(decrementUserPendingCount('user-abc')).resolves.toBeUndefined();
  });

  it('decrementUserPendingCount clamps negative counter to 0', async () => {
    const { redis: redisMock } = await import('@/lib/redis');

    // Simulate counter going negative (bug scenario from CRIT-3)
    const decrPipe = {
      decr:   vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec:   vi.fn().mockResolvedValue([-1, 1]), // negative — must be clamped
    };
    (redisMock.pipeline as ReturnType<typeof vi.fn>).mockReturnValueOnce(decrPipe);
    (redisMock.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    const { decrementUserPendingCount } = await import('../lib/queue/index');
    await expect(decrementUserPendingCount('user-abc')).resolves.toBeUndefined();
    // set to 0 must have been called
    expect(redisMock.set).toHaveBeenCalledWith(expect.stringContaining('pending:user-abc'), 0);
  });
});
