/**
 * Tests for auditLogQueries (#7 — hardened audit log).
 *
 * Strategy: mock better-sqlite3 at the module level so getDb() returns a
 * controlled fake DB. This lets us test the SQL generation and argument
 * passing without a real file-based database, consistent with how the other
 * lib/ tests work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── better-sqlite3 mock ──────────────────────────────────────────────────────
// better-sqlite3 is called as `new Database(path)`, so the mock must be a
// constructable function (a class). Arrow functions are NOT constructable.

const m = vi.hoisted(() => {
  const run = vi.fn();
  const get = vi.fn();
  const all = vi.fn<() => unknown[]>(() => []);
  const prepare = vi.fn(() => ({ run, get, all }));
  const exec = vi.fn();
  const pragma = vi.fn();
  return { run, get, all, prepare, exec, pragma };
});

vi.mock('better-sqlite3', () => {
  class MockDatabase {
    prepare = m.prepare;
    exec    = m.exec;
    pragma  = m.pragma;
  }
  return { default: MockDatabase };
});

// ── import under test (AFTER mock is set up) ─────────────────────────────────

import { auditLogQueries, type AuditEntry } from './db';

// ── reset mocks between tests ─────────────────────────────────────────────────

beforeEach(() => {
  // resetAllMocks() resets both call history AND implementations (unlike clearAllMocks
  // which only clears history). This ensures a throwing m.run from one test can't bleed
  // into the next test by silently suppressing record()'s try/catch.
  vi.resetAllMocks();
  m.prepare.mockReturnValue({ run: m.run, get: m.get, all: m.all });
  m.all.mockReturnValue([]);
  m.get.mockReturnValue(undefined);
});

// ── fixtures ──────────────────────────────────────────────────────────────────

const entry: AuditEntry = {
  userId: 1,
  briefingId: 42,
  action: 'createEvent',
  argsJson: '{"title":"Meeting"}',
  resultText: 'Event created',
  ok: true,
};

// ── record ────────────────────────────────────────────────────────────────────

describe('auditLogQueries.record', () => {
  it('calls run with the correct 8 positional arguments', () => {
    auditLogQueries.record(entry);
    expect(m.run).toHaveBeenCalledWith(
      1,           // userId
      42,          // briefingId
      'createEvent',
      '{"title":"Meeting"}',
      'Event created',
      1,           // ok=true → 1
      null,        // snapshotBefore (not provided)
      null,        // snapshotAfter (not provided)
    );
  });

  it('encodes ok=false as integer 0', () => {
    auditLogQueries.record({ ...entry, ok: false });
    const args = m.run.mock.calls[0] as unknown[];
    expect(args[5]).toBe(0);
  });

  it('stores snapshotBefore and snapshotAfter when provided', () => {
    auditLogQueries.record({
      ...entry,
      snapshotBefore: '{"id":"ev1","summary":"Old"}',
      snapshotAfter:  '{"id":"ev1","summary":"New"}',
    });
    const args = m.run.mock.calls[0] as unknown[];
    expect(args[6]).toBe('{"id":"ev1","summary":"Old"}');
    expect(args[7]).toBe('{"id":"ev1","summary":"New"}');
  });

  it('coerces undefined briefingId to null', () => {
    auditLogQueries.record({ ...entry, briefingId: undefined });
    const args = m.run.mock.calls[0] as unknown[];
    expect(args[1]).toBeNull();
  });

  it('coerces undefined resultText to null', () => {
    const { resultText: _, ...noResult } = entry;
    auditLogQueries.record(noResult);
    const args = m.run.mock.calls[0] as unknown[];
    expect(args[4]).toBeNull();
  });

  it('does NOT throw when the DB run() throws', () => {
    m.run.mockImplementation(() => { throw new Error('db fault'); });
    expect(() => auditLogQueries.record(entry)).not.toThrow();
  });

  it('does NOT throw when prepare() throws', () => {
    m.prepare.mockImplementation(() => { throw new Error('prepare fault'); });
    expect(() => auditLogQueries.record(entry)).not.toThrow();
  });

  it('prunes old rows when Math.random < 0.01', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.005);
    auditLogQueries.record(entry);
    // Two prepare calls: INSERT + DELETE prune
    const sqls = m.prepare.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls.some(s => s.includes('DELETE FROM audit_log'))).toBe(true);
  });

  it('skips the prune when Math.random >= 0.01', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // Reset call count after module-load schema exec calls
    m.prepare.mockClear();
    auditLogQueries.record(entry);
    const sqls = m.prepare.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls.every((s: string) => !s.includes('DELETE FROM audit_log'))).toBe(true);
  });
});

// ── recent ────────────────────────────────────────────────────────────────────

describe('auditLogQueries.recent', () => {
  it('prepares a SELECT WHERE user_id query', () => {
    m.prepare.mockClear();
    auditLogQueries.recent(7, 5);
    const sqls = m.prepare.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls.some(s => s.includes('WHERE user_id = ?'))).toBe(true);
    expect(m.all).toHaveBeenCalledWith(7, 5);
  });

  it('defaults limit to 20', () => {
    m.prepare.mockClear();
    auditLogQueries.recent(7);
    expect(m.all).toHaveBeenCalledWith(7, 20);
  });

  it('returns the rows from all()', () => {
    const rows: unknown[] = [{ id: 1, action: 'createEvent' }];
    m.all.mockReturnValue(rows);
    expect(auditLogQueries.recent(1, 1)).toEqual(rows);
  });
});

// ── recentAll ─────────────────────────────────────────────────────────────────

describe('auditLogQueries.recentAll', () => {
  it('prepares a SELECT ORDER BY id DESC query', () => {
    m.prepare.mockClear();
    auditLogQueries.recentAll(50);
    const sqls = m.prepare.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls.some(s => s.includes('ORDER BY id DESC LIMIT ?'))).toBe(true);
    expect(m.all).toHaveBeenCalledWith(50);
  });

  it('defaults limit to 100', () => {
    m.prepare.mockClear();
    auditLogQueries.recentAll();
    expect(m.all).toHaveBeenCalledWith(100);
  });
});

// ── successCount ──────────────────────────────────────────────────────────────

describe('auditLogQueries.successCount', () => {
  it('returns the integer count from get()', () => {
    m.get.mockReturnValue({ n: 7 });
    expect(auditLogQueries.successCount(1, 30)).toBe(7);
  });

  it('queries WHERE ok = 1', () => {
    m.get.mockReturnValue({ n: 0 });
    m.prepare.mockClear();
    auditLogQueries.successCount(1, 30);
    const sqls = m.prepare.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls.some(s => s.includes('ok = 1'))).toBe(true);
  });
});
