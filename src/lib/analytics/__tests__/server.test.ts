import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PostHog } from 'posthog-node';

const mockCapture = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);

vi.mock('posthog-node', () => ({
  PostHog: vi.fn().mockImplementation(function (this: unknown) {
    return { capture: mockCapture, flush: mockFlush };
  }),
}));

describe('analytics/server', () => {
  const ORIGINAL_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  beforeEach(() => {
    vi.resetModules();
    mockCapture.mockReset();
    mockFlush.mockReset().mockResolvedValue(undefined);
    vi.mocked(PostHog).mockClear();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = ORIGINAL_KEY;
  });

  it('no-ops without ever constructing a client when NEXT_PUBLIC_POSTHOG_KEY is unset', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const { captureEvent } = await import('../server');

    await expect(
      captureEvent('user-1', 'subscription_activated', {
        tier: 'premium', provider: 'stripe', billing_interval: 'monthly',
        amount: 19.99, currency: 'USD', is_trial: false, is_renewal: false,
      })
    ).resolves.toBeUndefined();

    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('captures with the given distinctId, event name, and properties, then flushes', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
    const { captureEvent } = await import('../server');

    await captureEvent('user-42', 'subscription_activated', {
      tier: 'elite', provider: 'paystack', billing_interval: 'annual',
      amount: 199.99, currency: 'NGN', is_trial: false, is_renewal: true,
    });

    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: 'user-42',
      event: 'subscription_activated',
      properties: {
        tier: 'elite', provider: 'paystack', billing_interval: 'annual',
        amount: 199.99, currency: 'NGN', is_trial: false, is_renewal: true,
      },
    });
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it('never throws when capture() itself throws — swallows and logs instead', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
    mockCapture.mockImplementation(() => { throw new Error('posthog capture blew up'); });
    const { captureEvent } = await import('../server');

    await expect(
      captureEvent('user-1', 'signup_completed', { method: 'email' })
    ).resolves.toBeUndefined();
  });

  it('never throws when flush() rejects — swallows and logs instead', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
    mockFlush.mockRejectedValue(new Error('network down'));
    const { captureEvent } = await import('../server');

    await expect(
      captureEvent('user-1', 'signup_completed', { method: 'google' })
    ).resolves.toBeUndefined();
  });

  it('reuses the same client across multiple calls instead of constructing one per event', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
    const { captureEvent } = await import('../server');

    await captureEvent('user-1', 'signup_completed', { method: 'email' });
    await captureEvent('user-2', 'signup_completed', { method: 'email' });

    expect(PostHog).toHaveBeenCalledTimes(1);
  });
});
