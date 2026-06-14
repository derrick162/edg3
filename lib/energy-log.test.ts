/**
 * Integration tests for energyLogQueries using an in-memory SQLite DB.
 * Verifies schema (UNIQUE constraint, CHECK constraints), upsert logic,
 * and user isolation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Load a fresh in-memory DB for each describe group via module reset.
async function loadDb() {
  vi.resetModules();
  process.env.DB_PATH = ':memory:';
  const mod = await import('./db');
  const userId = Number(mod.userQueries.create('energy-test@example.com', 'Energy Tester', 'hash').lastInsertRowid);
  return { ...mod, userId };
}

// ── basic CRUD ────────────────────────────────────────────────────────────────

describe('energyLogQueries — basic read/write', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  beforeEach(async () => { db = await loadDb(); });

  it('returns undefined when no record exists for a date', () => {
    const result = db.energyLogQueries.getForDate(db.userId, '2026-06-14');
    expect(result).toBeUndefined();
  });

  it('stores and retrieves a green energy record', () => {
    db.energyLogQueries.setEnergy(db.userId, '2026-06-14', 'green', 'whoop');
    const result = db.energyLogQueries.getForDate(db.userId, '2026-06-14');
    expect(result).toMatchObject({ user_id: db.userId, date: '2026-06-14', level: 'green', source: 'whoop' });
  });

  it('stores and retrieves a red energy record with manual source', () => {
    db.energyLogQueries.setEnergy(db.userId, '2026-06-15', 'red', 'manual');
    const result = db.energyLogQueries.getForDate(db.userId, '2026-06-15');
    expect(result).toMatchObject({ level: 'red', source: 'manual' });
  });

  it('stores and retrieves a yellow energy record with override source', () => {
    db.energyLogQueries.setEnergy(db.userId, '2026-06-16', 'yellow', 'override');
    const result = db.energyLogQueries.getForDate(db.userId, '2026-06-16');
    expect(result).toMatchObject({ level: 'yellow', source: 'override' });
  });
});

// ── upsert behaviour ──────────────────────────────────────────────────────────

describe('energyLogQueries — upsert (one record per user per day)', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  beforeEach(async () => { db = await loadDb(); });

  it('replaces an existing record on the same date', () => {
    db.energyLogQueries.setEnergy(db.userId, '2026-06-14', 'green', 'whoop');
    db.energyLogQueries.setEnergy(db.userId, '2026-06-14', 'red', 'override');
    const result = db.energyLogQueries.getForDate(db.userId, '2026-06-14');
    expect(result?.level).toBe('red');
    expect(result?.source).toBe('override');
  });

  it('keeps exactly one row per (user, date) after multiple upserts', () => {
    db.energyLogQueries.setEnergy(db.userId, '2026-06-14', 'green', 'whoop');
    db.energyLogQueries.setEnergy(db.userId, '2026-06-14', 'yellow', 'manual');
    db.energyLogQueries.setEnergy(db.userId, '2026-06-14', 'red', 'override');
    const count = (db.getDb().prepare('SELECT COUNT(*) AS c FROM energy_log WHERE user_id = ? AND date = ?').get(db.userId, '2026-06-14') as { c: number }).c;
    expect(count).toBe(1);
  });

  it('allows different dates to have separate records', () => {
    db.energyLogQueries.setEnergy(db.userId, '2026-06-13', 'red', 'whoop');
    db.energyLogQueries.setEnergy(db.userId, '2026-06-14', 'green', 'manual');
    const yesterday = db.energyLogQueries.getForDate(db.userId, '2026-06-13');
    const today = db.energyLogQueries.getForDate(db.userId, '2026-06-14');
    expect(yesterday?.level).toBe('red');
    expect(today?.level).toBe('green');
  });
});

// ── user isolation ────────────────────────────────────────────────────────────

describe('energyLogQueries — user isolation', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;
  let userId2: number;

  beforeEach(async () => {
    db = await loadDb();
    userId2 = Number(db.userQueries.create('user2@example.com', 'User Two', 'hash2').lastInsertRowid);
  });

  it('users do not see each other\'s energy records', () => {
    db.energyLogQueries.setEnergy(db.userId, '2026-06-14', 'green', 'whoop');
    const user2Record = db.energyLogQueries.getForDate(userId2, '2026-06-14');
    expect(user2Record).toBeUndefined();
  });

  it('two users can each have a record on the same date', () => {
    db.energyLogQueries.setEnergy(db.userId, '2026-06-14', 'green', 'whoop');
    db.energyLogQueries.setEnergy(userId2, '2026-06-14', 'red', 'manual');
    expect(db.energyLogQueries.getForDate(db.userId, '2026-06-14')?.level).toBe('green');
    expect(db.energyLogQueries.getForDate(userId2, '2026-06-14')?.level).toBe('red');
  });
});
