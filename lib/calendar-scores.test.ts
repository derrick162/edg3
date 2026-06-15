/**
 * Integration tests for calendarScoreQueries and energyProfileQueries.
 * Uses in-memory SQLite so schema + queries are exercised end-to-end.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadDb() {
  vi.resetModules();
  process.env.DB_PATH = ':memory:';
  const mod = await import('./db');
  const userId = Number(mod.userQueries.create('score-test@example.com', 'Score Tester', 'hash').lastInsertRowid);
  return { ...mod, userId };
}

const BASE_SCORES = {
  edgeScore: 65,
  focusScore: 7,
  energyScore: 6,
  focusDrivers: ['P1 has 2h block', 'P2 at 0h — add one'],
  energyDrivers: ['Deep work in peak window'],
};

// ── calendarScoreQueries ──────────────────────────────────────────────────────

describe('calendarScoreQueries — upsert + getLatest', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  beforeEach(async () => { db = await loadDb(); });

  it('returns undefined when no scores exist', () => {
    expect(db.calendarScoreQueries.getLatest(db.userId)).toBeUndefined();
  });

  it('inserts a score row and retrieves it via getLatest', () => {
    db.calendarScoreQueries.upsert(db.userId, '2026-06-14', BASE_SCORES);
    const row = db.calendarScoreQueries.getLatest(db.userId);
    expect(row).toBeDefined();
    expect(row!.edge_score).toBe(65);
    expect(row!.focus_score).toBe(7);
    expect(row!.energy_score).toBe(6);
    expect(JSON.parse(row!.focus_drivers!)).toEqual(BASE_SCORES.focusDrivers);
    expect(JSON.parse(row!.energy_drivers!)).toEqual(BASE_SCORES.energyDrivers);
    expect(row!.date).toBe('2026-06-14');
    expect(row!.user_id).toBe(db.userId);
  });

  it('overwrites on conflict (upsert semantics)', () => {
    db.calendarScoreQueries.upsert(db.userId, '2026-06-14', BASE_SCORES);
    db.calendarScoreQueries.upsert(db.userId, '2026-06-14', {
      edgeScore: 85,
      focusScore: 9,
      energyScore: 8,
      focusDrivers: ['Updated'],
      energyDrivers: ['Also updated'],
    });
    const row = db.calendarScoreQueries.getLatest(db.userId);
    expect(row!.focus_score).toBe(9);
    expect(row!.energy_score).toBe(8);
  });

  it('getLatest returns the most recent date when multiple exist', () => {
    db.calendarScoreQueries.upsert(db.userId, '2026-06-13', { ...BASE_SCORES, focusScore: 4 });
    db.calendarScoreQueries.upsert(db.userId, '2026-06-14', { ...BASE_SCORES, focusScore: 8 });
    db.calendarScoreQueries.upsert(db.userId, '2026-06-12', { ...BASE_SCORES, focusScore: 2 });
    expect(db.calendarScoreQueries.getLatest(db.userId)!.focus_score).toBe(8);
  });
});

describe('calendarScoreQueries — getRange', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  beforeEach(async () => { db = await loadDb(); });

  it('returns empty array when no rows in range', () => {
    db.calendarScoreQueries.upsert(db.userId, '2026-06-14', BASE_SCORES);
    expect(db.calendarScoreQueries.getRange(db.userId, '2026-06-01', '2026-06-10')).toHaveLength(0);
  });

  it('returns rows within the date range inclusive, ordered by date ascending', () => {
    db.calendarScoreQueries.upsert(db.userId, '2026-06-10', { ...BASE_SCORES, focusScore: 3 });
    db.calendarScoreQueries.upsert(db.userId, '2026-06-12', { ...BASE_SCORES, focusScore: 5 });
    db.calendarScoreQueries.upsert(db.userId, '2026-06-14', { ...BASE_SCORES, focusScore: 7 });
    db.calendarScoreQueries.upsert(db.userId, '2026-06-16', { ...BASE_SCORES, focusScore: 9 });

    const rows = db.calendarScoreQueries.getRange(db.userId, '2026-06-11', '2026-06-14');
    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBe('2026-06-12');
    expect(rows[1].date).toBe('2026-06-14');
  });

  it('excludes rows from other users', () => {
    const userId2 = Number(db.userQueries.create('other@example.com', 'Other', 'hash2').lastInsertRowid);
    db.calendarScoreQueries.upsert(db.userId, '2026-06-14', BASE_SCORES);
    db.calendarScoreQueries.upsert(userId2, '2026-06-14', { ...BASE_SCORES, focusScore: 1 });
    const rows = db.calendarScoreQueries.getRange(db.userId, '2026-06-14', '2026-06-14');
    expect(rows).toHaveLength(1);
    expect(rows[0].focus_score).toBe(7);
  });
});

// ── energyProfileQueries ──────────────────────────────────────────────────────

describe('energyProfileQueries — get + upsert', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  beforeEach(async () => { db = await loadDb(); });

  it('returns undefined when no profile exists', () => {
    expect(db.energyProfileQueries.get(db.userId)).toBeUndefined();
  });

  it('creates a profile and retrieves it', () => {
    db.energyProfileQueries.upsert(db.userId, { peakStart: 9, peakEnd: 11, troughStart: 14, troughEnd: 16 });
    const p = db.energyProfileQueries.get(db.userId);
    expect(p).toBeDefined();
    expect(p!.peak_start).toBe(9);
    expect(p!.peak_end).toBe(11);
    expect(p!.trough_start).toBe(14);
    expect(p!.trough_end).toBe(16);
    expect(p!.user_id).toBe(db.userId);
  });

  it('overwrites on upsert (one row per user)', () => {
    db.energyProfileQueries.upsert(db.userId, { peakStart: 9, peakEnd: 11, troughStart: 14, troughEnd: 16 });
    db.energyProfileQueries.upsert(db.userId, { peakStart: 8, peakEnd: 10, troughStart: 13, troughEnd: 15 });
    const p = db.energyProfileQueries.get(db.userId);
    expect(p!.peak_start).toBe(8);
    expect(p!.peak_end).toBe(10);
    expect(p!.trough_start).toBe(13);
    expect(p!.trough_end).toBe(15);
  });

  it('does not leak profiles across users', () => {
    const userId2 = Number(db.userQueries.create('u2@example.com', 'U2', 'hash2').lastInsertRowid);
    db.energyProfileQueries.upsert(db.userId, { peakStart: 9, peakEnd: 11, troughStart: 14, troughEnd: 16 });
    db.energyProfileQueries.upsert(userId2, { peakStart: 7, peakEnd: 9, troughStart: 12, troughEnd: 14 });
    expect(db.energyProfileQueries.get(db.userId)!.peak_start).toBe(9);
    expect(db.energyProfileQueries.get(userId2)!.peak_start).toBe(7);
  });
});
