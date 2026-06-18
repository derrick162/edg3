/**
 * Tests for the withRetry helper (T1-1 — webhook retry with exponential backoff).
 * Uses an injected no-op sleep so backoff is verified without real timers.
 */
import { describe, it, expect, vi } from 'vitest';
import { withRetry } from './retry';

const noSleep = () => Promise.resolve();

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await withRetry(fn, { sleep: noSleep });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds on a later attempt', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return 'recovered';
    });
    const result = await withRetry(fn, { attempts: 3, sleep: noSleep });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting all attempts', async () => {
    const fn = vi.fn(async () => { throw new Error('always fails'); });
    await expect(withRetry(fn, { attempts: 3, sleep: noSleep })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses exponential backoff delays (base, 2x, 4x ...)', async () => {
    const delays: number[] = [];
    const fn = vi.fn(async () => { throw new Error('x'); });
    await expect(withRetry(fn, {
      attempts: 4,
      baseDelayMs: 100,
      sleep: async (ms: number) => { delays.push(ms); },
    })).rejects.toThrow();
    // 3 sleeps between 4 attempts: 100, 200, 400
    expect(delays).toEqual([100, 200, 400]);
  });

  it('calls onRetry before each backoff with attempt number and delay', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn(async () => { throw new Error('boom'); });
    await expect(withRetry(fn, { attempts: 2, baseDelayMs: 50, sleep: noSleep, onRetry })).rejects.toThrow();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 50);
  });

  it('attempts=1 means no retry — single try', async () => {
    const fn = vi.fn(async () => { throw new Error('once'); });
    await expect(withRetry(fn, { attempts: 1, sleep: noSleep })).rejects.toThrow('once');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
