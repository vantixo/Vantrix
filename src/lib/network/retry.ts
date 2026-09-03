/**
 * Exponential backoff retry with jitter.
 *
 * CircuitOpenError guard: if the circuit is OPEN, every retry attempt will
 * also throw CircuitOpenError — wasting 900ms+ of backoff before propagating
 * an error that will not change until the circuit timeout expires. We check
 * instanceof CircuitOpenError and re-throw immediately before any delay.
 *
 * @param fn        Async function to retry
 * @param attempts  Max attempts (default 3)
 * @param baseMs    Base delay in ms (default 300)
 * @param factor    Exponential factor (default 2) — delays: 300, 600, 1200…
 * @param shouldRetry Optional predicate — return false to abort retry early
 */
import { CircuitOpenError } from '@/lib/errors';

export async function retry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseMs = 300,
  factor = 2,
  shouldRetry?: (err: unknown) => boolean,
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Never retry an open circuit — the state won't change until timeout.
      // Retrying burns ~900ms of backoff for no reason.
      if (err instanceof CircuitOpenError) throw err;

      // Caller-supplied predicate can abort further retries
      if (shouldRetry && !shouldRetry(err)) throw err;

      if (i === attempts - 1) break;

      const delay = baseMs * Math.pow(factor, i) + Math.random() * 100;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError;
}

/**
 * Retry only on network/5xx errors. Don't retry 4xx (client errors).
 * Also inherits the CircuitOpenError guard from retry().
 */
export async function retryOnTransient<T>(
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  return retry(
    async () => {
      try {
        return await fn();
      } catch (err: unknown) {
        if (err instanceof Error && 'statusCode' in err) {
          const status = (err as { statusCode: number }).statusCode;
          if (status >= 400 && status < 500) throw err;
        }
        throw err;
      }
    },
    attempts,
  );
}
