import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGet = vi.fn();

vi.mock('@vercel/edge-config', () => ({
  createClient: () => ({ get: mockGet }),
}));

describe('flags', () => {
  const ORIGINAL_EDGE_CONFIG = process.env.EDGE_CONFIG;

  beforeEach(() => {
    vi.resetModules();
    mockGet.mockReset();
  });

  afterEach(() => {
    process.env.EDGE_CONFIG = ORIGINAL_EDGE_CONFIG;
  });

  it('falls back to the registered default when EDGE_CONFIG is unset (never calls Edge Config)', async () => {
    delete process.env.EDGE_CONFIG;
    const { isFeatureEnabled, FLAG_REGISTRY } = await import('../index');

    const result = await isFeatureEnabled('chat_video_generation_enabled');

    expect(result).toBe(FLAG_REGISTRY.chat_video_generation_enabled.default);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('falls back to the default when the Edge Config read throws — never propagates the error', async () => {
    process.env.EDGE_CONFIG = 'https://edge-config.vercel.com/ecfg_test?token=fake';
    mockGet.mockRejectedValue(new Error('network down'));
    const { isFeatureEnabled, FLAG_REGISTRY } = await import('../index');

    const result = await isFeatureEnabled('chat_video_generation_enabled');

    expect(result).toBe(FLAG_REGISTRY.chat_video_generation_enabled.default);
  });

  it('returns a plain boolean value verbatim, overriding the default', async () => {
    process.env.EDGE_CONFIG = 'https://edge-config.vercel.com/ecfg_test?token=fake';
    mockGet.mockResolvedValue(false);
    const { isFeatureEnabled } = await import('../index');

    expect(await isFeatureEnabled('chat_video_generation_enabled')).toBe(false);
  });

  it('honors enabled: false as a hard kill switch regardless of rolloutPercent', async () => {
    process.env.EDGE_CONFIG = 'https://edge-config.vercel.com/ecfg_test?token=fake';
    mockGet.mockResolvedValue({ enabled: false, rolloutPercent: 100 });
    const { isFeatureEnabled } = await import('../index');

    expect(await isFeatureEnabled('chat_video_generation_enabled', { userId: 'user-1' })).toBe(false);
  });

  it('treats rolloutPercent >= 100 as fully on when no userId is given', async () => {
    process.env.EDGE_CONFIG = 'https://edge-config.vercel.com/ecfg_test?token=fake';
    mockGet.mockResolvedValue({ rolloutPercent: 100 });
    const { isFeatureEnabled } = await import('../index');

    expect(await isFeatureEnabled('chat_video_generation_enabled')).toBe(true);
  });

  it('treats rolloutPercent < 100 as off when no userId is given (no bucket to assign)', async () => {
    process.env.EDGE_CONFIG = 'https://edge-config.vercel.com/ecfg_test?token=fake';
    mockGet.mockResolvedValue({ rolloutPercent: 50 });
    const { isFeatureEnabled } = await import('../index');

    expect(await isFeatureEnabled('chat_video_generation_enabled')).toBe(false);
  });

  it('deterministically buckets the same userId the same way on repeated calls', async () => {
    process.env.EDGE_CONFIG = 'https://edge-config.vercel.com/ecfg_test?token=fake';
    mockGet.mockResolvedValue({ rolloutPercent: 50 });
    const { isFeatureEnabled, __clearFlagCache } = await import('../index');

    const first = await isFeatureEnabled('chat_video_generation_enabled', { userId: 'stable-user' });
    __clearFlagCache();
    const second = await isFeatureEnabled('chat_video_generation_enabled', { userId: 'stable-user' });

    expect(first).toBe(second);
  });

  it('spreads users roughly proportionally to rolloutPercent across many ids', async () => {
    process.env.EDGE_CONFIG = 'https://edge-config.vercel.com/ecfg_test?token=fake';
    mockGet.mockResolvedValue({ rolloutPercent: 30 });
    const { isFeatureEnabled, __clearFlagCache } = await import('../index');

    let enabledCount = 0;
    const total = 2000;
    for (let i = 0; i < total; i++) {
      __clearFlagCache();
      if (await isFeatureEnabled('chat_video_generation_enabled', { userId: `user-${i}` })) enabledCount++;
    }

    const ratio = enabledCount / total;
    expect(ratio).toBeGreaterThan(0.22);
    expect(ratio).toBeLessThan(0.38);
  });

  it('rejects at 0% and accepts at 100% for every user, regardless of hash', async () => {
    process.env.EDGE_CONFIG = 'https://edge-config.vercel.com/ecfg_test?token=fake';
    const { isFeatureEnabled, __clearFlagCache } = await import('../index');

    mockGet.mockResolvedValue({ rolloutPercent: 0 });
    __clearFlagCache();
    expect(await isFeatureEnabled('chat_video_generation_enabled', { userId: 'anyone' })).toBe(false);

    mockGet.mockResolvedValue({ rolloutPercent: 100 });
    __clearFlagCache();
    expect(await isFeatureEnabled('chat_video_generation_enabled', { userId: 'anyone' })).toBe(true);
  });

  it('caches a resolved value for CACHE_TTL_MS instead of reading Edge Config on every call', async () => {
    process.env.EDGE_CONFIG = 'https://edge-config.vercel.com/ecfg_test?token=fake';
    mockGet.mockResolvedValue(true);
    const { isFeatureEnabled } = await import('../index');

    await isFeatureEnabled('chat_video_generation_enabled');
    await isFeatureEnabled('chat_video_generation_enabled');
    await isFeatureEnabled('chat_video_generation_enabled');

    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
