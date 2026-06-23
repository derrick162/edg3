/**
 * R23 T1 — currentOpenCallMemoryText: rich memory block for open / inbound calls.
 * Real in-memory better-sqlite3.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

const { getDb, factQueries, openLoopQueries, briefingQueries } = await import('./db');
const { currentOpenCallMemoryText } = await import('./callMemory');

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
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['gratitude_entries', 'open_loops', 'facts', 'fact_history', 'briefings', 'users']) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* table may not exist */ }
  }
  db.pragma('foreign_keys = ON');
  makeUser(1);
});

describe('currentOpenCallMemoryText (R23 T1)', () => {
  it('returns an empty string when there is no memory at all', () => {
    expect(currentOpenCallMemoryText(1)).toBe('');
  });

  it('includes all fact categories grouped under WHAT EDGE KNOWS', () => {
    factQueries.upsertFact(1, 'goal', 'Raise the seed round', null, 'high');
    factQueries.upsertFact(1, 'person', 'is the lead investor', 'Sarah', 'high');
    factQueries.upsertFact(1, 'preference', 'Prefers mornings for deep work', null, 'high');
    const text = currentOpenCallMemoryText(1);
    expect(text).toContain('WHAT EDGE KNOWS ABOUT YOU:');
    expect(text).toContain('Goals: Raise the seed round');
    expect(text).toContain('People: Sarah: is the lead investor');
    expect(text).toContain('Preferences: Prefers mornings for deep work');
  });

  it('includes open commitments and recent call notes', () => {
    openLoopQueries.insert(1, { description: 'Send the deck to Sarah', type: 'commitment_made', source: 'call' });
    const b = briefingQueries.create(1, 'Morning briefing content here', '2026-06-21T14:00:00Z') as { lastInsertRowid: number };
    briefingQueries.update(b.lastInsertRowid, { status: 'completed', user_response: 'Felt good about the day' });

    const text = currentOpenCallMemoryText(1);
    expect(text).toContain('OPEN COMMITMENTS');
    expect(text).toContain('Send the deck to Sarah');
    expect(text).toContain('RECENT CALL NOTES');
    expect(text).toContain('Felt good about the day');
  });

  it('omits the recent-calls section when no completed calls exist', () => {
    briefingQueries.create(1, 'pending content', '2026-06-21T14:00:00Z'); // status defaults to 'pending'
    expect(currentOpenCallMemoryText(1)).not.toContain('RECENT CALL NOTES');
  });
});
