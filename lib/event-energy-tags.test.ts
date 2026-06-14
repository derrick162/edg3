/**
 * Integration tests for eventEnergyTagQueries using an in-memory SQLite DB.
 * Verifies schema, upsert semantics, getMany batching, and user isolation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadDb() {
  vi.resetModules();
  process.env.DB_PATH = ':memory:';
  const mod = await import('./db');
  const userId = Number(mod.userQueries.create('tag-test@example.com', 'Tag Tester', 'hash').lastInsertRowid);
  return { ...mod, userId };
}

const TAG: { type: string; demand: 'high' | 'med' | 'low'; titleHash: string } = {
  type: 'deep-work',
  demand: 'high',
  titleHash: 'abc123',
};

// ── get ───────────────────────────────────────────────────────────────────────

describe('eventEnergyTagQueries — get', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  beforeEach(async () => { db = await loadDb(); });

  it('returns undefined when no tag exists', () => {
    expect(db.eventEnergyTagQueries.get(db.userId, 'evt_001')).toBeUndefined();
  });

  it('returns the tag after upsert', () => {
    db.eventEnergyTagQueries.upsert(db.userId, 'evt_001', TAG);
    const row = db.eventEnergyTagQueries.get(db.userId, 'evt_001');
    expect(row).toBeDefined();
    expect(row!.user_id).toBe(db.userId);
    expect(row!.google_event_id).toBe('evt_001');
    expect(row!.type).toBe('deep-work');
    expect(row!.demand).toBe('high');
    expect(row!.title_hash).toBe('abc123');
  });

  it('does not return another user\'s tag', () => {
    const userId2 = Number(db.userQueries.create('u2@example.com', 'U2', 'h2').lastInsertRowid);
    db.eventEnergyTagQueries.upsert(userId2, 'evt_001', TAG);
    expect(db.eventEnergyTagQueries.get(db.userId, 'evt_001')).toBeUndefined();
  });
});

// ── upsert ────────────────────────────────────────────────────────────────────

describe('eventEnergyTagQueries — upsert', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  beforeEach(async () => { db = await loadDb(); });

  it('overwrites an existing tag (same user + event id)', () => {
    db.eventEnergyTagQueries.upsert(db.userId, 'evt_001', TAG);
    db.eventEnergyTagQueries.upsert(db.userId, 'evt_001', {
      type: 'admin',
      demand: 'low',
      titleHash: 'def456',
    });
    const row = db.eventEnergyTagQueries.get(db.userId, 'evt_001');
    expect(row!.type).toBe('admin');
    expect(row!.demand).toBe('low');
    expect(row!.title_hash).toBe('def456');
  });

  it('inserts independent tags for different event ids', () => {
    db.eventEnergyTagQueries.upsert(db.userId, 'evt_001', TAG);
    db.eventEnergyTagQueries.upsert(db.userId, 'evt_002', { type: 'meeting', demand: 'med', titleHash: 'xyz' });
    expect(db.eventEnergyTagQueries.get(db.userId, 'evt_001')!.type).toBe('deep-work');
    expect(db.eventEnergyTagQueries.get(db.userId, 'evt_002')!.type).toBe('meeting');
  });

  it('inserts independent tags for the same event id across users', () => {
    const userId2 = Number(db.userQueries.create('u2@example.com', 'U2', 'h2').lastInsertRowid);
    db.eventEnergyTagQueries.upsert(db.userId, 'shared_evt', TAG);
    db.eventEnergyTagQueries.upsert(userId2, 'shared_evt', { type: 'admin', demand: 'low', titleHash: 'zzz' });
    expect(db.eventEnergyTagQueries.get(db.userId, 'shared_evt')!.type).toBe('deep-work');
    expect(db.eventEnergyTagQueries.get(userId2, 'shared_evt')!.type).toBe('admin');
  });
});

// ── getMany ───────────────────────────────────────────────────────────────────

describe('eventEnergyTagQueries — getMany', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  beforeEach(async () => { db = await loadDb(); });

  it('returns empty array for empty eventIds list', () => {
    expect(db.eventEnergyTagQueries.getMany(db.userId, [])).toEqual([]);
  });

  it('returns only cached ids (misses not included)', () => {
    db.eventEnergyTagQueries.upsert(db.userId, 'evt_001', TAG);
    const rows = db.eventEnergyTagQueries.getMany(db.userId, ['evt_001', 'evt_999']);
    expect(rows).toHaveLength(1);
    expect(rows[0].google_event_id).toBe('evt_001');
  });

  it('returns all matching ids', () => {
    db.eventEnergyTagQueries.upsert(db.userId, 'evt_A', TAG);
    db.eventEnergyTagQueries.upsert(db.userId, 'evt_B', { type: 'admin', demand: 'low', titleHash: 'h2' });
    db.eventEnergyTagQueries.upsert(db.userId, 'evt_C', { type: 'meeting', demand: 'med', titleHash: 'h3' });
    const rows = db.eventEnergyTagQueries.getMany(db.userId, ['evt_A', 'evt_C']);
    expect(rows).toHaveLength(2);
    const ids = rows.map(r => r.google_event_id).sort();
    expect(ids).toEqual(['evt_A', 'evt_C']);
  });

  it('excludes other users\' tags even when event ids match', () => {
    const userId2 = Number(db.userQueries.create('u2@example.com', 'U2', 'h2').lastInsertRowid);
    db.eventEnergyTagQueries.upsert(userId2, 'evt_001', TAG);
    expect(db.eventEnergyTagQueries.getMany(db.userId, ['evt_001'])).toHaveLength(0);
  });
});
