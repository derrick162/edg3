/**
 * R19 T1 — briefingQueries.countCompleted: the first-call signal (0 = introduce yourself).
 * Real in-memory better-sqlite3.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

const { getDb, briefingQueries } = await import('./db');

afterAll(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = ORIGINAL_DB_PATH;
});

function makeUser(id: number): void {
  getDb().prepare(
    "INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (?, ?, ?, 'x', 1)",
  ).run(id, `u${id}@e.com`, `User${id}`);
}
function addBriefing(userId: number, status: string): void {
  getDb().prepare(
    "INSERT INTO briefings (user_id, content, status, scheduled_for) VALUES (?, 'c', ?, datetime('now'))",
  ).run(userId, status);
}

beforeEach(() => {
  getDb().prepare('DELETE FROM briefings').run();
  getDb().prepare('DELETE FROM users').run();
});

describe('briefingQueries.countCompleted (R19 T1)', () => {
  it('returns 0 when the user has no completed calls', () => {
    makeUser(1);
    addBriefing(1, 'pending');
    addBriefing(1, 'failed');
    addBriefing(1, 'missed');
    expect(briefingQueries.countCompleted(1)).toBe(0);
  });

  it('counts only this user\'s completed calls', () => {
    makeUser(1);
    makeUser(2);
    addBriefing(1, 'completed');
    addBriefing(1, 'completed');
    addBriefing(1, 'pending');
    addBriefing(2, 'completed'); // bystander — must not count toward user 1
    expect(briefingQueries.countCompleted(1)).toBe(2);
    expect(briefingQueries.countCompleted(2)).toBe(1);
  });
});
