/**
 * S3 — multi-user isolation. Two users share the DB; verify no data bleeds between them on read,
 * and that deleting one user's account leaves the other's data fully intact. Real in-memory DB.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

process.env.DB_PATH = ':memory:';

const { getDb, factQueries, briefingQueries, episodeQueries, deleteUserData } = await import('./db');

afterAll(() => { delete process.env.DB_PATH; });

function makeUser(id: number): void {
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (?, ?, ?, 'x', 1)").run(id, `u${id}@e.com`, `User ${id}`);
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['facts', 'briefings', 'episodes', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  makeUser(1);
  makeUser(2);
  // User 1 data
  factQueries.upsertFact(1, 'goal', "User1 wants to ship", 'project1', 'high');
  briefingQueries.create(1, 'u1 briefing', new Date().toISOString());
  episodeQueries.insert(1, 'call', new Date().toISOString(), 'u1 transcript', ['topic1'], []);
  // User 2 data
  factQueries.upsertFact(2, 'goal', "User2 wants to raise", 'project2', 'high');
  briefingQueries.create(2, 'u2 briefing', new Date().toISOString());
  episodeQueries.insert(2, 'call', new Date().toISOString(), 'u2 transcript', ['topic2'], []);
});

describe('S3 — multi-user data isolation', () => {
  it('fact reads are scoped — user 1 never sees user 2 facts', () => {
    const f1 = factQueries.getAll(1);
    expect(f1).toHaveLength(1);
    expect(f1[0].statement).toContain('User1');
    expect(f1.some(f => f.statement.includes('User2'))).toBe(false);
  });

  it('briefing + episode reads are scoped per user (one row each, no cross-bleed)', () => {
    expect(briefingQueries.getRecent(1, 30)).toHaveLength(1);
    expect(briefingQueries.getRecent(2, 30)).toHaveLength(1);
    // episode search is user-scoped (its WHERE always begins with user_id = ?)
    expect(episodeQueries.search(1, { limit: 10 })).toHaveLength(1);
    expect(episodeQueries.search(2, { limit: 10 })).toHaveLength(1);
  });

  it('deleting user 1 removes ALL their rows and leaves user 2 fully intact', () => {
    deleteUserData(1);
    const db = getDb();
    for (const t of ['facts', 'briefings', 'episodes']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = 1`).get() as { n: number }).n).toBe(0);
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = 2`).get() as { n: number }).n).toBe(1);
    }
    // user 2 row itself survives; user 1 is gone
    expect((db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = 1').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = 2').get() as { n: number }).n).toBe(1);
    expect(factQueries.getAll(2)).toHaveLength(1);
  });
});
