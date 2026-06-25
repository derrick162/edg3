/**
 * R33 schema (Security T2) — users.work_schedule column + getWorkSchedule helper.
 */
import { describe, it, expect, afterAll } from 'vitest';

process.env.DB_PATH = ':memory:';

const { getDb, getWorkSchedule } = await import('./db');

afterAll(() => { delete process.env.DB_PATH; });

describe('R33 — work_schedule column + getWorkSchedule', () => {
  it('users table has a work_schedule column', () => {
    const cols = (getDb().prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map(c => c.name);
    expect(cols).toContain('work_schedule');
  });

  it('column defaults to 9am–6pm Mon–Fri JSON for a new user', () => {
    getDb().prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (10, 'w@e.com', 'W', 'x', 1)").run();
    const u = getDb().prepare('SELECT work_schedule FROM users WHERE id = 10').get() as { work_schedule: string };
    expect(JSON.parse(u.work_schedule)).toEqual({ start: 9, end: 18, days: [1, 2, 3, 4, 5] });
  });

  it('getWorkSchedule parses stored JSON', () => {
    expect(getWorkSchedule({ work_schedule: '{"start":7,"end":15,"days":[1,2,3]}' })).toEqual({ start: 7, end: 15, days: [1, 2, 3] });
  });

  it('getWorkSchedule falls back to the default on null/corrupt JSON', () => {
    const def = { start: 9, end: 18, days: [1, 2, 3, 4, 5] };
    expect(getWorkSchedule({ work_schedule: null })).toEqual(def);
    expect(getWorkSchedule({ work_schedule: 'not json' })).toEqual(def);
    expect(getWorkSchedule({})).toEqual(def);
  });
});
