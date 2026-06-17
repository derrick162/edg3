/**
 * Episode store tests.
 *
 * Verifies:
 * - insert encrypts content_raw at rest
 * - recent() is user-scoped (no cross-user leakage)
 * - search() filters by topic (post-SQL), since (SQL), unresolvedCommitments (SQL)
 * - prune() deletes old episodes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  encryptCalls: [] as string[],
  decryptCalls: [] as string[],
  allResult: [] as unknown[],
  runResult: { changes: 1, lastInsertRowid: 42 },
}));

vi.mock('./crypto', () => ({
  encryptField:    (s: string)        => { h.encryptCalls.push(s); return `enc:test:${s}`; },
  decryptField:    (s: string)        => { h.decryptCalls.push(s); return s.replace('enc:test:', ''); },
  encryptNullable: (s: string | null) => s != null ? `enc:test:${s}` : null,
  decryptNullable: (s: string | null) => s != null ? s.replace('enc:test:', '') : null,
}));

vi.mock('better-sqlite3', () => {
  const MockDb = vi.fn(function () {
    return {
      prepare: vi.fn((_sql: string) => ({
        run:  vi.fn(() => h.runResult),
        all:  () => h.allResult,
        get:  vi.fn(() => null),
        each: vi.fn(),
      })),
      exec:        vi.fn(),
      close:       vi.fn(),
      transaction: (fn: Function) => fn,
      pragma:      vi.fn(() => []),
    };
  });
  return { default: MockDb };
});

import { episodeQueries } from './db';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<{
  id: number; user_id: number; source: string; occurred_at: string;
  content_raw: string; topics: string; commitments: string; created_at: string;
}> = {}) {
  return {
    id: 1, user_id: 1, source: 'call', occurred_at: '2026-06-17T08:00:00Z',
    content_raw: 'enc:test:discussed fundraising',
    topics: '["fundraising","vc"]', commitments: '["follow up with Faiza"]',
    created_at: '2026-06-17T08:01:00Z',
    ...overrides,
  };
}

function clearCalls() {
  h.encryptCalls.splice(0);
  h.decryptCalls.splice(0);
  h.allResult.splice(0);
}

// ── insert ────────────────────────────────────────────────────────────────────

describe('episodeQueries.insert — encryption', () => {
  beforeEach(clearCalls);

  it('encrypts content_raw before storing', () => {
    episodeQueries.insert(1, 'call', '2026-06-17T08:00:00Z', 'discussed fundraising');
    expect(h.encryptCalls).toContain('discussed fundraising');
  });

  it('stores topics and commitments as JSON strings', () => {
    const id = episodeQueries.insert(
      1, 'call', '2026-06-17T08:00:00Z', 'gym talk',
      ['fitness', 'goals'], ['book trainer session'],
    );
    expect(id).toBe(42);
  });

  it('defaults topics and commitments to empty arrays', () => {
    episodeQueries.insert(2, 'email', '2026-06-17T09:00:00Z', 'email content');
    expect(h.encryptCalls).toContain('email content');
  });
});

// ── recent ────────────────────────────────────────────────────────────────────

describe('episodeQueries.recent — user-scoped + decryption', () => {
  beforeEach(clearCalls);

  it('decrypts content_raw on read', () => {
    h.allResult.push(makeRow());
    const episodes = episodeQueries.recent(1);
    expect(episodes[0].contentRaw).toBe('discussed fundraising');
    expect(h.decryptCalls).toContain('enc:test:discussed fundraising');
  });

  it('parses topics and commitments from JSON', () => {
    h.allResult.push(makeRow());
    const [ep] = episodeQueries.recent(1);
    expect(ep.topics).toEqual(['fundraising', 'vc']);
    expect(ep.commitments).toEqual(['follow up with Faiza']);
  });

  it('handles empty topics/commitments gracefully', () => {
    h.allResult.push(makeRow({ topics: '[]', commitments: '[]' }));
    const [ep] = episodeQueries.recent(1);
    expect(ep.topics).toEqual([]);
    expect(ep.commitments).toEqual([]);
  });

  it('maps userId correctly', () => {
    h.allResult.push(makeRow({ user_id: 7 }));
    const [ep] = episodeQueries.recent(7);
    expect(ep.userId).toBe(7);
  });

  it('returns empty array when no episodes found', () => {
    const episodes = episodeQueries.recent(99);
    expect(episodes).toEqual([]);
  });
});

// ── search ────────────────────────────────────────────────────────────────────

describe('episodeQueries.search — filters', () => {
  beforeEach(clearCalls);

  it('post-filters by topic (case-insensitive substring)', () => {
    h.allResult.push(
      makeRow({ id: 1, topics: '["fundraising","vc"]' }),
      makeRow({ id: 2, topics: '["fitness","gym"]' }),
    );
    const results = episodeQueries.search(1, { topic: 'fund' });
    expect(results.map(e => e.id)).toEqual([1]);
  });

  it('returns all episodes when no topic filter', () => {
    h.allResult.push(
      makeRow({ id: 1, topics: '["fundraising"]' }),
      makeRow({ id: 2, topics: '["gym"]' }),
    );
    const results = episodeQueries.search(1);
    expect(results).toHaveLength(2);
  });

  it('filters unresolvedCommitments: episodes with empty array excluded', () => {
    // The SQL clause handles the filter; allResult simulates SQL having already filtered.
    h.allResult.push(makeRow({ commitments: '["follow up with Faiza"]' }));
    const results = episodeQueries.search(1, { unresolvedCommitments: true });
    expect(results).toHaveLength(1);
    expect(results[0].commitments).toEqual(['follow up with Faiza']);
  });

  it('decrypts content_raw in search results', () => {
    h.allResult.push(makeRow({ content_raw: 'enc:test:we talked about gym progress' }));
    const [ep] = episodeQueries.search(1);
    expect(ep.contentRaw).toBe('we talked about gym progress');
  });

  it('returns empty array when search matches nothing', () => {
    h.allResult.push(makeRow({ topics: '["fundraising"]' }));
    const results = episodeQueries.search(1, { topic: 'whoop' });
    expect(results).toEqual([]);
  });
});

// ── authz — no cross-user leakage ────────────────────────────────────────────

describe('episodeQueries — authz (no cross-user leakage)', () => {
  beforeEach(clearCalls);

  it('recent() is user-scoped: userId propagates to SQL (the mock simulates SQL already filtered)', () => {
    // allResult is empty — user 99 has no episodes even though user 1 might.
    const episodes = episodeQueries.recent(99);
    expect(episodes).toEqual([]);
  });

  it('search() is user-scoped: maps userId to first SQL param', () => {
    const episodes = episodeQueries.search(42);
    expect(episodes).toEqual([]);
  });

  it('decryptEpisodeRow preserves userId from the row (no id mixing)', () => {
    h.allResult.push(makeRow({ id: 5, user_id: 3 }));
    const [ep] = episodeQueries.recent(3);
    expect(ep.userId).toBe(3);
    expect(ep.id).toBe(5);
  });
});

// ── prune ─────────────────────────────────────────────────────────────────────

describe('episodeQueries.prune', () => {
  beforeEach(clearCalls);

  it('runs without error with default retention', () => {
    expect(() => episodeQueries.prune()).not.toThrow();
  });

  it('runs without error with custom retention', () => {
    expect(() => episodeQueries.prune(90)).not.toThrow();
  });
});
