/**
 * Bi-temporal fact tests for factQueries.
 *
 * Strategy: mock better-sqlite3 so getDb() returns a controlled fake. Tests verify that
 * upsertFact retires the old row and inserts a new one (instead of UPDATE in place),
 * retire() sets valid_until, and getAll/getByCategory filter on valid_until IS NULL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── better-sqlite3 mock ──────────────────────────────────────────────────────
const m = vi.hoisted(() => {
  const run = vi.fn();
  const get = vi.fn<() => unknown>(() => undefined);
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

// Mock encryption so statements pass through without transformation
vi.mock('./crypto', () => ({
  encryptField: (v: string) => v,
  decryptField: (v: string) => v,
  encryptNullable: (v: string | null) => v,
  decryptNullable: (v: string | null) => v,
}));

import { factQueries } from './db';

beforeEach(() => {
  vi.resetAllMocks();
  m.prepare.mockReturnValue({ run: m.run, get: m.get, all: m.all });
  m.all.mockReturnValue([]);
  m.get.mockReturnValue(undefined);
});

describe('factQueries — bi-temporal (T1)', () => {
  describe('retire()', () => {
    it('updates valid_until to NOW for the given fact row', () => {
      factQueries.retire(1, 42);
      expect(m.prepare).toHaveBeenCalledWith(
        expect.stringContaining('valid_until')
      );
      expect(m.run).toHaveBeenCalledWith(42, 1);
    });

    it('passes userId and id in the right order (id first, userId second)', () => {
      factQueries.retire(7, 99);
      expect(m.run).toHaveBeenCalledWith(99, 7);
    });
  });

  describe('getAll() — active-only filter', () => {
    it('queries with valid_until IS NULL', () => {
      factQueries.getAll(1);
      expect(m.prepare).toHaveBeenCalledWith(
        expect.stringContaining('valid_until IS NULL')
      );
    });

    it('does not include retired facts in the result set', () => {
      m.all.mockReturnValue([
        { id: 1, user_id: 1, category: 'goal', statement: 'current goal', entity: null, learned_at: '2026-06-01', confidence: 'high', source_briefing_id: null, valid_from: null, valid_until: null },
      ]);
      const facts = factQueries.getAll(1);
      expect(facts).toHaveLength(1);
      expect(facts[0].statement).toBe('current goal');
    });
  });

  describe('getByCategory() — active-only filter', () => {
    it('queries with valid_until IS NULL', () => {
      factQueries.getByCategory(1, 'goal');
      expect(m.prepare).toHaveBeenCalledWith(
        expect.stringContaining('valid_until IS NULL')
      );
    });
  });

  describe('upsertFact() — bi-temporal conflict resolution', () => {
    it('retires existing low-conf fact and inserts new one when statement changes', () => {
      // Simulate existing active low-conf fact found by entity lookup
      m.get.mockReturnValue({
        id: 10,
        statement: 'gym is at 6am',
        confidence: 'low',
      });

      factQueries.upsertFact(1, 'preference', 'gym is at 7am', 'gym schedule', 'low');

      const prepareCalls = m.prepare.mock.calls.map(([sql]) => sql as string);

      // Should have called retire (UPDATE facts SET valid_until=...)
      expect(prepareCalls.some(s => s.includes('valid_until') && s.includes('UPDATE'))).toBe(true);
      // Should have called INSERT (not UPDATE the statement in place)
      expect(prepareCalls.some(s => s.includes('INSERT INTO facts') && s.includes('valid_from'))).toBe(true);
    });

    it('does not retire when existing statement is identical (no-op)', () => {
      m.get.mockReturnValue({
        id: 10,
        statement: 'gym is at 7am',
        confidence: 'low',
      });

      factQueries.upsertFact(1, 'preference', 'gym is at 7am', 'gym schedule', 'low');

      const prepareCalls = m.prepare.mock.calls.map(([sql]) => sql as string);
      // Should NOT retire since statement is the same
      expect(prepareCalls.some(s => s.includes('valid_until') && s.includes('UPDATE'))).toBe(false);
    });

    it('does not overwrite high-confidence existing fact', () => {
      m.get.mockReturnValue({
        id: 10,
        statement: 'User explicitly set this',
        confidence: 'high',
      });

      factQueries.upsertFact(1, 'preference', 'new extraction overwrite attempt', 'gym schedule', 'low');

      const prepareCalls = m.prepare.mock.calls.map(([sql]) => sql as string);
      // Should not retire or insert when high-conf existing fact found
      expect(prepareCalls.some(s => s.includes('valid_until') && s.includes('UPDATE'))).toBe(false);
      expect(prepareCalls.some(s => s.includes('INSERT INTO facts'))).toBe(false);
    });

    it('inserts with valid_from when no existing fact found', () => {
      m.get.mockReturnValue(undefined);

      factQueries.upsertFact(1, 'goal', 'Close Series A by Q3', null, 'high');

      const prepareCalls = m.prepare.mock.calls.map(([sql]) => sql as string);
      expect(prepareCalls.some(s => s.includes('INSERT INTO facts') && s.includes('valid_from'))).toBe(true);
    });

    it('entity lookup includes valid_until IS NULL to only check active facts', () => {
      factQueries.upsertFact(1, 'person', 'Sarah is the CFO', 'Sarah', 'high');

      const prepareCalls = m.prepare.mock.calls.map(([sql]) => sql as string);
      expect(prepareCalls.some(s => s.includes('LOWER(entity)') && s.includes('valid_until IS NULL'))).toBe(true);
    });
  });
});
