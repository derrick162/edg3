/**
 * Round 5 — bi-temporal fact schema + pattern_cache encryption tests.
 *
 * Verifies:
 *   - factQueries.retire() sets valid_until, is user-scoped, never affects already-retired rows
 *   - factQueries.getAll() filters active-only by default; returns all when includeRetired:true
 *   - factQueries.getByCategory() same
 *   - factQueries.upsertFact() conflict detection only matches active facts (valid_until IS NULL)
 *   - patternCacheQueries.get() decrypts patterns on read
 *   - patternCacheQueries.upsert() encrypts patterns on write
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted state ──────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  encryptCalls: [] as string[],
  decryptCalls: [] as string[],
  allResult: [] as unknown[],
  getResult: null as unknown,
  runResult: { changes: 1, lastInsertRowid: 99 },
  allSqls: [] as string[],   // every prepare() call in order
  lastSql: '',
  lastRunArgs: [] as unknown[],
}));

// ── mocks ──────────────────────────────────────────────────────────────────────

vi.mock('./crypto', () => ({
  encryptField:        (s: string)        => { h.encryptCalls.push(s); return `enc:test:${s}`; },
  decryptField:        (s: string)        => { h.decryptCalls.push(s); return s.replace('enc:test:', ''); },
  encryptNullable:     (s: string | null) => s != null ? `enc:test:${s}` : null,
  decryptNullable:     (s: string | null) => s != null ? s.replace('enc:test:', '') : null,
  safeDecryptField:    (s: string)        => { h.decryptCalls.push(s); return s.replace('enc:test:', ''); },
  safeDecryptNullable: (s: string | null) => s != null ? s.replace('enc:test:', '') : null,
}));

vi.mock('better-sqlite3', () => {
  const MockDb = vi.fn(function () {
    return {
      prepare: vi.fn((sql: string) => {
        h.lastSql = sql;
        h.allSqls.push(sql);
        return {
          run:  vi.fn((...args: unknown[]) => { h.lastRunArgs = args; return h.runResult; }),
          all:  (_: unknown) => h.allResult,
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

import { factQueries, patternCacheQueries } from './db';

// ── helpers ────────────────────────────────────────────────────────────────────

function clearCalls() {
  h.encryptCalls.splice(0);
  h.decryptCalls.splice(0);
  h.allResult.splice(0);
  h.getResult = null;
  h.lastSql = '';
  h.allSqls.splice(0);
  h.lastRunArgs = [];
}

function makeFact(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, user_id: 10, category: 'goal', statement: 'enc:test:raise $500k',
    entity: null, learned_at: '2026-06-01T00:00:00Z', confidence: 'high',
    source_briefing_id: null, source: null,
    valid_from: '2026-06-01T00:00:00Z', valid_until: null,
    ...overrides,
  };
}

// ── factQueries.retire ─────────────────────────────────────────────────────────

describe('factQueries.retire', () => {
  beforeEach(clearCalls);

  it('calls UPDATE with valid_until = datetime(now) scoped to userId', () => {
    factQueries.retire(10, 42);
    expect(h.lastSql).toMatch(/UPDATE facts SET valid_until/);
    expect(h.lastSql).toMatch(/AND user_id/);
    // Args: factId, userId (order matches the WHERE clause)
    expect(h.lastRunArgs).toContain(42);
    expect(h.lastRunArgs).toContain(10);
  });

  it('includes AND valid_until IS NULL guard to avoid double-retiring', () => {
    factQueries.retire(10, 42);
    expect(h.lastSql).toMatch(/valid_until IS NULL/);
  });
});

// ── factQueries.getAll — active-only filter ────────────────────────────────────

describe('factQueries.getAll — active-only default', () => {
  beforeEach(clearCalls);

  it('default call uses valid_until IS NULL filter', () => {
    h.allResult.push(makeFact());
    factQueries.getAll(10);
    expect(h.lastSql).toMatch(/valid_until IS NULL/);
  });

  it('includeRetired:false also uses valid_until IS NULL filter', () => {
    h.allResult.push(makeFact());
    factQueries.getAll(10, { includeRetired: false });
    expect(h.lastSql).toMatch(/valid_until IS NULL/);
  });

  it('includeRetired:true omits the valid_until filter', () => {
    h.allResult.push(makeFact(), makeFact({ valid_until: '2026-06-10T00:00:00Z' }));
    factQueries.getAll(10, { includeRetired: true });
    expect(h.lastSql).not.toMatch(/valid_until IS NULL/);
  });

  it('decrypts statement on each returned row', () => {
    h.allResult.push(makeFact({ statement: 'enc:test:raise $500k' }));
    const facts = factQueries.getAll(10);
    expect(facts[0].statement).toBe('raise $500k');
    expect(h.decryptCalls).toContain('enc:test:raise $500k');
  });
});

// ── factQueries.getByCategory — active-only filter ────────────────────────────

describe('factQueries.getByCategory — active-only default', () => {
  beforeEach(clearCalls);

  it('default call uses valid_until IS NULL filter', () => {
    h.allResult.push(makeFact());
    factQueries.getByCategory(10, 'goal');
    expect(h.lastSql).toMatch(/valid_until IS NULL/);
  });

  it('includeRetired:true omits the valid_until filter', () => {
    h.allResult.push(makeFact(), makeFact({ valid_until: '2026-06-05T00:00:00Z' }));
    factQueries.getByCategory(10, 'goal', { includeRetired: true });
    expect(h.lastSql).not.toMatch(/valid_until IS NULL/);
  });

  it('decrypts statement on read', () => {
    h.allResult.push(makeFact({ statement: 'enc:test:priority statement' }));
    const facts = factQueries.getByCategory(10, 'goal');
    expect(facts[0].statement).toBe('priority statement');
  });
});

// ── factQueries.upsertFact — conflict detection is active-only ─────────────────

describe('factQueries.upsertFact — conflict detection (active only)', () => {
  beforeEach(clearCalls);

  it('entity-based lookup includes valid_until IS NULL in SELECT', () => {
    h.getResult = null; // no existing active fact → insert path
    factQueries.upsertFact(10, 'person', 'Alice is a friend', 'Alice');
    // allSqls[0] is the SELECT to find existing active facts
    const selectSql = h.allSqls.find(s => s.includes('SELECT') && s.includes('entity'));
    expect(selectSql).toMatch(/valid_until IS NULL/);
  });

  it('no-entity lookup includes valid_until IS NULL in SELECT', () => {
    h.allResult.splice(0); // no existing active facts → insert path
    factQueries.upsertFact(10, 'goal', 'raise $500k');
    const selectSql = h.allSqls.find(s => s.includes('SELECT') && s.includes('entity IS NULL'));
    expect(selectSql).toMatch(/valid_until IS NULL/);
  });
});

// ── patternCacheQueries — encryption at rest ───────────────────────────────────

describe('patternCacheQueries — encryption at rest', () => {
  beforeEach(clearCalls);

  it('upsert encrypts patterns JSON before storing', () => {
    const patterns = JSON.stringify([{ pattern: 'Morning peak energy', sampleDays: 12 }]);
    patternCacheQueries.upsert(5, patterns);
    expect(h.encryptCalls).toContain(patterns);
  });

  it('get decrypts patterns on read', () => {
    const raw = 'enc:test:[{"pattern":"Morning peak energy"}]';
    h.getResult = { patterns: raw };
    const result = patternCacheQueries.get(5);
    expect(result).toBe('[{"pattern":"Morning peak energy"}]');
    expect(h.decryptCalls).toContain(raw);
  });

  it('get returns null when no row exists', () => {
    h.getResult = null;
    const result = patternCacheQueries.get(5);
    expect(result).toBeNull();
  });

  it('get handles legacy plaintext rows transparently', () => {
    // decryptField mock strips 'enc:test:' prefix — plaintext passes through unchanged
    const plaintext = '[{"pattern":"old plaintext"}]';
    h.getResult = { patterns: plaintext };
    const result = patternCacheQueries.get(5);
    expect(result).toBe(plaintext);
  });
});
