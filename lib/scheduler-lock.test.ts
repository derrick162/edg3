/**
 * T0-4 — single-instance scheduler lock tests.
 *
 * Uses a REAL in-memory better-sqlite3 DB (not a mock) because the lock's correctness
 * depends on actual SQLite upsert + WHERE atomicity — exactly what a mock can't verify.
 * DB_PATH=':memory:' makes getDb() build the full schema (incl. scheduler_lock) in RAM.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

const { schedulerLockQueries, getDb } = await import('./db');

afterAll(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = ORIGINAL_DB_PATH;
});

beforeEach(() => {
  getDb().prepare('DELETE FROM scheduler_lock').run();
});

describe('schedulerLockQueries.acquire', () => {
  it('grants the lock to the first acquirer', () => {
    expect(schedulerLockQueries.acquire('dispatch', 'A', 55)).toBe(true);
  });

  it('blocks a second holder while the lock is held', () => {
    expect(schedulerLockQueries.acquire('dispatch', 'A', 55)).toBe(true);
    expect(schedulerLockQueries.acquire('dispatch', 'B', 55)).toBe(false);
  });

  it('lets the same holder refresh its own lock', () => {
    expect(schedulerLockQueries.acquire('dispatch', 'A', 55)).toBe(true);
    expect(schedulerLockQueries.acquire('dispatch', 'A', 55)).toBe(true);
  });

  it('treats different lock names as independent', () => {
    expect(schedulerLockQueries.acquire('dispatch', 'A', 55)).toBe(true);
    expect(schedulerLockQueries.acquire('other', 'B', 55)).toBe(true);
  });
});

describe('schedulerLockQueries — expiry + reclaim', () => {
  it('lets another holder reclaim an expired lock', () => {
    expect(schedulerLockQueries.acquire('dispatch', 'A', 55)).toBe(true);
    // Force the lock to expire (simulate a crashed holder past TTL).
    getDb().prepare("UPDATE scheduler_lock SET expires_at = datetime('now', '-1 minute') WHERE lock_name = 'dispatch'").run();
    expect(schedulerLockQueries.acquire('dispatch', 'B', 55)).toBe(true);
    // B now owns it; A is blocked.
    expect(schedulerLockQueries.acquire('dispatch', 'A', 55)).toBe(false);
  });
});

describe('schedulerLockQueries.currentHolder', () => {
  it('returns null when no lock is held', () => {
    expect(schedulerLockQueries.currentHolder('dispatch')).toBeNull();
  });

  it('names the current holder while the lock is held', () => {
    expect(schedulerLockQueries.acquire('dispatch', 'A', 55)).toBe(true);
    const held = schedulerLockQueries.currentHolder('dispatch');
    expect(held?.holder).toBe('A');
    expect(held?.expires_at).toBeTruthy();
  });

  it('reflects the new holder after an expired lock is reclaimed', () => {
    expect(schedulerLockQueries.acquire('dispatch', 'A', 55)).toBe(true);
    getDb().prepare("UPDATE scheduler_lock SET expires_at = datetime('now', '-1 minute') WHERE lock_name = 'dispatch'").run();
    expect(schedulerLockQueries.acquire('dispatch', 'B', 55)).toBe(true);
    expect(schedulerLockQueries.currentHolder('dispatch')?.holder).toBe('B');
  });
});

describe('schedulerLockQueries.release', () => {
  it('frees the lock for another holder', () => {
    expect(schedulerLockQueries.acquire('dispatch', 'A', 55)).toBe(true);
    schedulerLockQueries.release('dispatch', 'A');
    expect(schedulerLockQueries.acquire('dispatch', 'B', 55)).toBe(true);
  });

  it('does not stomp a lock held by a different holder', () => {
    expect(schedulerLockQueries.acquire('dispatch', 'A', 55)).toBe(true);
    // B tries to release a lock it does not hold → no-op.
    schedulerLockQueries.release('dispatch', 'B');
    expect(schedulerLockQueries.acquire('dispatch', 'B', 55)).toBe(false); // A still holds it
  });
});
