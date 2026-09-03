/**
 * Retry utility tests.
 *
 * Critical coverage: CircuitOpenError must NOT be retried.
 * Previously, retry() had no guard — CircuitOpenError (status 503) would
 * exhaust all 3 attempts + ~900ms backoff before propagating. The fix
 * re-throws immediately on instanceof CircuitOpenError.
 */

import { describe, it, expect} from 'vitest';
import { retry } from '../lib/network/retry';
import { CircuitOpenError } from '../lib/errors';

describe('retry — CircuitOpenError guard', () => {
  it('does not retry on CircuitOpenError — propagates immediately', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new CircuitOpenError('openrouter', 30);
    };

    await expect(retry(fn, 3, 10, 2)).rejects.toBeInstanceOf(CircuitOpenError);
    // Must have been called exactly once — no retries attempted
    expect(calls).toBe(1);
  });

  it('retries on generic errors up to attempt limit', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error('transient');
    };

    await expect(retry(fn, 3, 1, 1)).rejects.toThrow('transient');
    expect(calls).toBe(3);
  });

  it('succeeds without retry when fn resolves on first call', async () => {
    let calls = 0;
    const fn = async () => { calls++; return 'ok'; };
    const result = await retry(fn, 3, 1, 1);
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('succeeds on second attempt after one transient failure', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls === 1) throw new Error('first fail');
      return 'recovered';
    };
    const result = await retry(fn, 3, 1, 1);
    expect(result).toBe('recovered');
    expect(calls).toBe(2);
  });

  it('custom shouldRetry predicate aborts retry when it returns false', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error('stop me');
    };
    const shouldRetry = (_err: unknown) => false;
    await expect(retry(fn, 3, 1, 1, shouldRetry)).rejects.toThrow('stop me');
    expect(calls).toBe(1);
  });
});
