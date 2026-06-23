/**
 * R22 — userQueries.getLanguage / setLanguage. Real in-memory better-sqlite3.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

const { getDb, userQueries } = await import('./db');

afterAll(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = ORIGINAL_DB_PATH;
});

function makeUser(id: number): void {
  getDb().prepare(
    "INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (?, ?, ?, 'x', 1)",
  ).run(id, `u${id}@e.com`, `User${id}`);
}

beforeEach(() => {
  getDb().prepare('DELETE FROM users').run();
  makeUser(1);
});

describe('userQueries language (R22)', () => {
  it("defaults to 'en' for a new user", () => {
    expect(userQueries.getLanguage(1)).toBe('en');
  });

  it("persists 'yue' after setLanguage", () => {
    userQueries.setLanguage(1, 'yue');
    expect(userQueries.getLanguage(1)).toBe('yue');
  });

  it("getLanguage falls back to 'en' for an unknown user", () => {
    expect(userQueries.getLanguage(999)).toBe('en');
  });
});
