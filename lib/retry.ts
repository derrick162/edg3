/**
 * Small async retry helper with exponential backoff.
 *
 * Used by the Vapi webhook (T1-1) to survive transient failures — a network blip or a
 * Vapi 5xx while fetching the call transcript shouldn't lose the call's data. The sleep
 * is injectable so tests run instantly without real timers.
 */

export interface RetryOptions {
  /** Total number of tries (not counting as "retries beyond the first"). Default 3. */
  attempts?: number;
  /** First backoff delay in ms; doubles each subsequent retry. Default 200. */
  baseDelayMs?: number;
  /** Label for log lines on retry. */
  label?: string;
  /** Called before each backoff sleep — for tests/metrics. */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
  /** Injectable sleep (tests pass a no-op to avoid real delays). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Run `fn`, retrying on rejection up to `attempts` times with exponential backoff.
 * Returns the first success; throws the last error if all attempts fail.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.floor(opts.attempts ?? 3));
  const baseDelayMs = Math.max(0, opts.baseDelayMs ?? 200);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = i === attempts - 1;
      if (isLast) break;
      const delayMs = baseDelayMs * Math.pow(2, i);
      opts.onRetry?.(i + 1, err, delayMs);
      if (opts.label) {
        console.warn(`[retry] ${opts.label} failed (attempt ${i + 1}/${attempts}) — retrying in ${delayMs}ms`);
      }
      await sleep(delayMs);
    }
  }
  throw lastErr;
}
