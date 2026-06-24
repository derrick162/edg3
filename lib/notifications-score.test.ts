/**
 * R19 T6 — score-change notification must compare against the most recent PRIOR score, not
 * strictly yesterday's. On days the user didn't load the dashboard there's no yesterday row,
 * so the old yesterday-only lookup found nothing and never fired (e.g. 54 → 60 over a weekend
 * gap went unnoticed). Real in-memory DB so the actual getPrior SQL is exercised.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

process.env.DB_PATH = ':memory:';

const { getDb, calendarScoreQueries, notificationQueries } = await import('./db');
const { maybeCreateScoreChangeNotif } = await import('./notifications');

const TODAY = '2026-06-24';

afterAll(() => { delete process.env.DB_PATH; });

function makeUser(): void {
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
}

function seedScore(date: string, edgeScore: number): void {
  calendarScoreQueries.upsert(1, date, { edgeScore, focusScore: edgeScore, energyScore: edgeScore, focusDrivers: [], energyDrivers: [] });
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['notifications', 'calendar_scores', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  makeUser();
});

describe('R19 T6 — maybeCreateScoreChangeNotif uses getPrior', () => {
  it('fires off the most recent prior row when yesterday has no score (gap)', () => {
    seedScore('2026-06-21', 54); // 3 days ago, no rows in between
    maybeCreateScoreChangeNotif(1, 60, TODAY);
    const notifs = notificationQueries.listRecent(1);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe('score_change');
    expect(notifs[0].body).toContain('from 54 to 60');
  });

  it('no prior row at all → no notification', () => {
    maybeCreateScoreChangeNotif(1, 60, TODAY);
    expect(notificationQueries.listRecent(1)).toHaveLength(0);
  });

  it('delta < 3 → no notification', () => {
    seedScore('2026-06-23', 58);
    maybeCreateScoreChangeNotif(1, 60, TODAY); // delta = 2
    expect(notificationQueries.listRecent(1)).toHaveLength(0);
  });

  it('prefers the nearest prior row when several exist', () => {
    seedScore('2026-06-20', 40);
    seedScore('2026-06-23', 55); // nearest prior
    maybeCreateScoreChangeNotif(1, 61, TODAY);
    expect(notificationQueries.listRecent(1)[0].body).toContain('from 55 to 61');
  });

  it('today\'s own row is not treated as prior (getPrior is strictly date < today)', () => {
    seedScore(TODAY, 60);     // today already saved
    seedScore('2026-06-22', 50);
    maybeCreateScoreChangeNotif(1, 60, TODAY);
    // prior is the 06-22 row (50), delta 10 → fires; today's row must not be the baseline (would be delta 0)
    expect(notificationQueries.listRecent(1)[0].body).toContain('from 50 to 60');
  });
});
