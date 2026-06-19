/**
 * Round 8 (M4-4) — peopleModelQueries tests (real in-memory better-sqlite3).
 * Verifies upsert/get/list/delete + that the PII fields round-trip through encrypt-on-write /
 * decrypt-on-read, and that partial upserts preserve prior fields (COALESCE).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

const { getDb, peopleModelQueries, USER_SCOPED_DELETE_ORDER } = await import('./db');

afterAll(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = ORIGINAL_DB_PATH;
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM people_models').run();
  db.prepare('DELETE FROM users').run();
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'u@test.com', 'U', 'h', 1)").run();
});

describe('peopleModelQueries', () => {
  it('upserts and reads back all fields (round-trips through encrypt/decrypt)', () => {
    peopleModelQueries.upsert(1, 'Sarah', {
      goals: 'close the Series A',
      communicationStyle: 'direct, prefers bullet points',
      relationshipState: 'warm, recurring 1:1s',
      lastInteraction: '2026-06-18',
      healthScore: 0.8,
    });
    const m = peopleModelQueries.getForUser(1, 'Sarah')!;
    expect(m.person_name).toBe('Sarah');
    expect(m.goals).toBe('close the Series A');
    expect(m.communication_style).toBe('direct, prefers bullet points');
    expect(m.relationship_state).toBe('warm, recurring 1:1s');
    expect(m.last_interaction).toBe('2026-06-18');
    expect(m.health_score).toBe(0.8);
  });

  it('returns undefined for an unknown person', () => {
    expect(peopleModelQueries.getForUser(1, 'Nobody')).toBeUndefined();
  });

  it('keeps one row per (user, person) — upsert updates, not duplicates', () => {
    peopleModelQueries.upsert(1, 'Sarah', { goals: 'v1' });
    peopleModelQueries.upsert(1, 'Sarah', { goals: 'v2' });
    const n = (getDb().prepare('SELECT COUNT(*) AS n FROM people_models WHERE user_id = 1').get() as { n: number }).n;
    expect(n).toBe(1);
    expect(peopleModelQueries.getForUser(1, 'Sarah')!.goals).toBe('v2');
  });

  it('partial upsert preserves prior fields (COALESCE)', () => {
    peopleModelQueries.upsert(1, 'Sarah', { goals: 'raise', communicationStyle: 'direct', healthScore: 0.9 });
    // Update only relationship_state — goals/communicationStyle/healthScore must survive.
    peopleModelQueries.upsert(1, 'Sarah', { relationshipState: 'cooling off' });
    const m = peopleModelQueries.getForUser(1, 'Sarah')!;
    expect(m.goals).toBe('raise');
    expect(m.communication_style).toBe('direct');
    expect(m.relationship_state).toBe('cooling off');
    expect(m.health_score).toBe(0.9);
  });

  it('defaults health_score to 1.0 when not provided', () => {
    peopleModelQueries.upsert(1, 'Bob', { goals: 'ship it' });
    expect(peopleModelQueries.getForUser(1, 'Bob')!.health_score).toBe(1.0);
  });

  it('listForUser returns all the user models (decrypted)', () => {
    peopleModelQueries.upsert(1, 'Sarah', { goals: 'a' });
    peopleModelQueries.upsert(1, 'Bob', { goals: 'b' });
    const names = peopleModelQueries.listForUser(1).map(m => m.person_name).sort();
    expect(names).toEqual(['Bob', 'Sarah']);
  });

  it('deleteForUser removes the row', () => {
    peopleModelQueries.upsert(1, 'Sarah', { goals: 'a' });
    peopleModelQueries.deleteForUser(1, 'Sarah');
    expect(peopleModelQueries.getForUser(1, 'Sarah')).toBeUndefined();
  });

  it('is registered for account deletion (in USER_SCOPED_DELETE_ORDER)', () => {
    expect(USER_SCOPED_DELETE_ORDER).toContain('people_models');
  });
});
