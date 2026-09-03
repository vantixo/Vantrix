// src/lib/__tests__/logger-sentry.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Phase A gap-fix regression: logger.error() must forward to Sentry
// (sampled, prod-only, redacted, non-blocking) without ever throwing or
// recursing back through logger.error itself. See logger.ts for context.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureMessage = vi.fn();
const setUser = vi.fn();
const setTag = vi.fn();
const setExtras = vi.fn();
const setLevel = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  withScope: (cb: (scope: unknown) => void) =>
    cb({ setUser, setTag, setExtras, setLevel }),
  captureMessage,
}));

function setNodeEnv(value: string) {
  vi.stubEnv('NODE_ENV', value);
}

describe('logger.error → Sentry forwarding', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('never forwards to Sentry outside production, regardless of sample rate', async () => {
    setNodeEnv('test');
    process.env.SENTRY_ERROR_LOG_SAMPLE_RATE = '1';
    const { logger } = await import('../logger');
    logger.error('boom');
    await new Promise(process.nextTick);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('forwards to Sentry in production when sampled in', async () => {
    setNodeEnv('production');
    process.env.SENTRY_ERROR_LOG_SAMPLE_RATE = '1'; // always sample
    const { logger } = await import('../logger');
    logger.error('db write failed', { userId: 'u1', secret: 'shh' });
    await new Promise(process.nextTick);
    expect(captureMessage).toHaveBeenCalledWith('db write failed');
    // meta must be redacted before it reaches Sentry, same as console output
    expect(setExtras).toHaveBeenCalledWith(
      expect.objectContaining({ secret: '[REDACTED]' })
    );
  });

  it('does not forward when sampled out', async () => {
    setNodeEnv('production');
    process.env.SENTRY_ERROR_LOG_SAMPLE_RATE = '0'; // never sample
    const { logger } = await import('../logger');
    logger.error('minor issue');
    await new Promise(process.nextTick);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('a failing Sentry import/call never throws out of logger.error', async () => {
    setNodeEnv('production');
    process.env.SENTRY_ERROR_LOG_SAMPLE_RATE = '1';
    captureMessage.mockImplementation(() => {
      throw new Error('sentry down');
    });
    const { logger } = await import('../logger');
    expect(() => logger.error('critical failure')).not.toThrow();
    await new Promise(process.nextTick);
    // the fallback path logs to console directly, not back through logger.error
    expect(console.error).toHaveBeenCalled();
  });
});
