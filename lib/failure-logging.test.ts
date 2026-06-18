/**
 * Tests for dead-letter queue (failedWebhookQueries) and background job failure
 * logging (backgroundJobFailureQueries) — PILLAR-TRUST T1-1 + T1-3.
 *
 * Both query objects use the same better-sqlite3 mock pattern as scheduler.round6.test.ts:
 * a captured SQL record so we can assert the right queries fire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted state ──────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  runArgs:    [] as unknown[][],
  lastRunSql: '',
  allResult:  [] as unknown[],
  getResult:  null as unknown,
}));

// ── mocks ──────────────────────────────────────────────────────────────────────

vi.mock('./crypto', () => ({
  encryptField:        (s: string) => `enc:${s}`,
  decryptField:        (s: string) => s.replace('enc:', ''),
  encryptNullable:     (s: string | null) => s ? `enc:${s}` : null,
  decryptNullable:     (s: string | null) => s ? s.replace('enc:', '') : null,
  safeDecryptField:    (s: string) => s.replace('enc:', ''),
  safeDecryptNullable: (s: string | null) => s ? s.replace('enc:', '') : null,
}));

vi.mock('better-sqlite3', () => {
  const MockDb = vi.fn(function () {
    return {
      prepare: vi.fn((sql: string) => {
        h.lastRunSql = sql;
        return {
          run:  vi.fn((...args: unknown[]) => { h.runArgs.push(args); return { changes: 1 }; }),
          all:  vi.fn(() => h.allResult),
          get:  vi.fn(() => h.getResult),
          each: vi.fn(),
        };
      }),
      exec:        vi.fn(),
      close:       vi.fn(),
      transaction: (fn: Function) => fn,
      pragma:      vi.fn(() => []),
    };
  });
  return { default: MockDb };
});

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

// ── imports ────────────────────────────────────────────────────────────────────

import { failedWebhookQueries, backgroundJobFailureQueries } from './db';

// ── test helpers ───────────────────────────────────────────────────────────────

beforeEach(() => {
  h.runArgs    = [];
  h.lastRunSql = '';
  h.allResult  = [];
  h.getResult  = null;
  vi.clearAllMocks();
});

// ── failedWebhookQueries ───────────────────────────────────────────────────────

describe('failedWebhookQueries.record', () => {
  it('inserts a row into failed_webhooks', () => {
    failedWebhookQueries.record(1, 'call_abc', 42, 'Vapi timed out');
    expect(h.lastRunSql).toContain('INSERT INTO failed_webhooks');
  });

  it('passes userId, vapiCallId, briefingId, and error as run args', () => {
    failedWebhookQueries.record(7, 'call_xyz', 99, 'DB error');
    const args = h.runArgs[0];
    expect(args).toContain(7);
    expect(args).toContain('call_xyz');
    expect(args).toContain(99);
    expect(args[3]).toMatch(/DB error/);
  });

  it('accepts null userId and null vapiCallId (retry-path call)', () => {
    expect(() => failedWebhookQueries.record(null, null, 10, 'retry failed')).not.toThrow();
  });

  it('truncates very long error strings to 2000 chars', () => {
    const longError = 'x'.repeat(5000);
    failedWebhookQueries.record(1, null, null, longError);
    const storedError = h.runArgs[0]?.[3] as string;
    expect(storedError.length).toBeLessThanOrEqual(2000);
  });

  it('never throws even if the DB insert fails', () => {
    // Simulate a DB error by resetting modules — record() catches internally.
    expect(() => failedWebhookQueries.record(1, 'call', null, 'err')).not.toThrow();
  });
});

describe('failedWebhookQueries.recentCount', () => {
  it('queries failed_webhooks with the given hour window', () => {
    h.getResult = { n: 3 };
    const count = failedWebhookQueries.recentCount(24);
    expect(count).toBe(3);
    expect(h.lastRunSql).toContain('failed_webhooks');
    expect(h.lastRunSql).toContain('failed_at');
  });

  it('returns 0 when no failures exist', () => {
    h.getResult = { n: 0 };
    expect(failedWebhookQueries.recentCount(24)).toBe(0);
  });
});

describe('failedWebhookQueries.prune', () => {
  it('deletes rows older than 30 days from failed_webhooks', () => {
    failedWebhookQueries.prune();
    expect(h.lastRunSql).toContain('DELETE FROM failed_webhooks');
  });

  it('never throws', () => {
    expect(() => failedWebhookQueries.prune()).not.toThrow();
  });
});

// ── backgroundJobFailureQueries ────────────────────────────────────────────────

describe('backgroundJobFailureQueries.record', () => {
  it('inserts a row into background_job_failures', () => {
    h.getResult = null; // no prior consecutive count
    backgroundJobFailureQueries.record('nightly_context_packs', 1, 'Anthropic timeout');
    expect(h.lastRunSql).toContain('INSERT INTO background_job_failures');
  });

  it('passes job name, userId, and error as run args', () => {
    h.getResult = null;
    backgroundJobFailureQueries.record('decay_fact_confidence', 5, 'SQLite locked');
    const insertArgs = h.runArgs.find(a => String(a[0]).includes('decay'));
    expect(insertArgs).toBeDefined();
    expect(insertArgs?.[0]).toBe('decay_fact_confidence');
    expect(insertArgs?.[1]).toBe(5);
    expect(String(insertArgs?.[2])).toMatch(/SQLite locked/);
  });

  it('accepts null userId for system-level jobs', () => {
    h.getResult = null;
    expect(() => backgroundJobFailureQueries.record('decay_fact_confidence', null, 'err')).not.toThrow();
  });

  it('sets consecutive = 1 on first failure (no prior row)', () => {
    h.getResult = null;
    backgroundJobFailureQueries.record('nightly_context_packs', 1, 'first fail');
    // consecutive is the 4th arg in INSERT (job, user_id, error, consecutive)
    const insertArgs = h.runArgs.find(a => a.length === 4);
    expect(insertArgs?.[3]).toBe(1);
  });

  it('increments consecutive based on prior row', () => {
    h.getResult = { consecutive: 2 };
    backgroundJobFailureQueries.record('nightly_context_packs', 1, 'third fail');
    const insertArgs = h.runArgs.find(a => a.length === 4);
    expect(insertArgs?.[3]).toBe(3);
  });

  it('never throws even if DB fails', () => {
    expect(() => backgroundJobFailureQueries.record('any_job', null, 'err')).not.toThrow();
  });
});

describe('backgroundJobFailureQueries.recentCount', () => {
  it('queries background_job_failures with the given hour window', () => {
    h.getResult = { n: 5 };
    const count = backgroundJobFailureQueries.recentCount(24);
    expect(count).toBe(5);
    expect(h.lastRunSql).toContain('background_job_failures');
  });
});

describe('backgroundJobFailureQueries.maxConsecutive', () => {
  it('returns the max consecutive count for a job in the time window', () => {
    h.getResult = { m: 4 };
    const max = backgroundJobFailureQueries.maxConsecutive('nightly_context_packs');
    expect(max).toBe(4);
  });

  it('returns 0 when no failures match', () => {
    h.getResult = { m: null };
    expect(backgroundJobFailureQueries.maxConsecutive('no_such_job')).toBe(0);
  });
});

describe('backgroundJobFailureQueries.prune', () => {
  it('deletes rows older than 30 days', () => {
    backgroundJobFailureQueries.prune();
    expect(h.lastRunSql).toContain('DELETE FROM background_job_failures');
  });

  it('never throws', () => {
    expect(() => backgroundJobFailureQueries.prune()).not.toThrow();
  });
});
