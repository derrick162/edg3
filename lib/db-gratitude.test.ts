/**
 * R20 — gratitudeQueries: create / getByDate / getRecent. Real in-memory better-sqlite3.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

const { getDb, gratitudeQueries, userQueries } = await import('./db');

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
  getDb().prepare('DELETE FROM gratitude_entries').run();
  getDb().prepare('DELETE FROM users').run();
  makeUser(1);
});

describe('gratitudeQueries (R20)', () => {
  it('create + getByDate returns the saved items', () => {
    gratitudeQueries.create(1, '2026-06-22', 'my health', 'the sunshine', 'coffee');
    const row = gratitudeQueries.getByDate(1, '2026-06-22');
    expect(row?.item_1).toBe('my health');
    expect(row?.item_2).toBe('the sunshine');
    expect(row?.item_3).toBe('coffee');
    expect(row?.user_id).toBe(1);
  });

  it('getByDate returns undefined when no entry exists for that date', () => {
    gratitudeQueries.create(1, '2026-06-22', 'a', 'b', 'c');
    expect(gratitudeQueries.getByDate(1, '2026-06-23')).toBeUndefined();
  });

  it('getRecent returns entries newest-date first, respecting the limit', () => {
    gratitudeQueries.create(1, '2026-06-20', 'a', 'b', 'c');
    gratitudeQueries.create(1, '2026-06-21', 'd', 'e', 'f');
    gratitudeQueries.create(1, '2026-06-22', 'g', 'h', 'i');
    const recent = gratitudeQueries.getRecent(1, 2);
    expect(recent).toHaveLength(2);
    expect(recent[0].entry_date).toBe('2026-06-22');
    expect(recent[1].entry_date).toBe('2026-06-21');
  });
});

describe('userQueries gratitude quote (R21)', () => {
  it('returns defaults (off, resilience) for a new user', () => {
    expect(userQueries.getGratitudeQuote(1)).toEqual({ quoteEnabled: false, quoteTheme: 'resilience' });
  });

  it('persists the enabled flag + theme after setGratitudeQuote', () => {
    userQueries.setGratitudeQuote(1, true, 'rebuilding');
    expect(userQueries.getGratitudeQuote(1)).toEqual({ quoteEnabled: true, quoteTheme: 'rebuilding' });
  });
});
