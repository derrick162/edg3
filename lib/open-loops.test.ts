/**
 * Integration tests for openLoopQueries (lib/db.ts).
 *
 * Uses the in-memory SQLite pattern so every test gets a fresh isolated DB.
 * Verifies: insert + list (decrypted), user isolation, resolve, dismiss, prune,
 * and encryption-at-rest (stored value differs from plaintext).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── In-memory DB isolation ────────────────────────────────────────────────────

vi.resetModules();
process.env.DB_PATH = ':memory:';
// Set a test key so encryptField() actually encrypts (it's a no-op without one).
process.env.DATA_ENCRYPTION_KEY = 'test-key-32-bytes-padding-here!!';

const db = await import('./db');
const { openLoopQueries } = db;

// ── Seed users (required by FK) ───────────────────────────────────────────────

function seedUser(id: number, email = `u${id}@test.com`) {
  db.getDb().prepare(
    `INSERT OR IGNORE INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)`
  ).run(id, email, `User ${id}`, 'hash');
}

beforeEach(() => {
  db.getDb().prepare('DELETE FROM open_loops').run();
  db.getDb().prepare('DELETE FROM users').run();
  seedUser(1);
  seedUser(2);
});

// ── 1. insert + list ──────────────────────────────────────────────────────────

describe('openLoopQueries — insert + list', () => {
  it('inserts a loop and lists it decrypted', () => {
    openLoopQueries.insert(1, {
      description: 'Send the deck to Faiza',
      type: 'commitment_made',
      source: 'call',
    });
    const loops = openLoopQueries.list(1);
    expect(loops).toHaveLength(1);
    expect(loops[0].description).toBe('Send the deck to Faiza');
    expect(loops[0].type).toBe('commitment_made');
    expect(loops[0].source).toBe('call');
    expect(loops[0].status).toBe('open');
    expect(loops[0].dueDate).toBeNull();
    expect(loops[0].resolvedAt).toBeNull();
  });

  it('stores description encrypted (raw DB value != plaintext)', () => {
    openLoopQueries.insert(1, {
      description: 'Reply to the credit collector',
      type: 'awaiting_you',
      source: 'email',
    });
    const raw = db.getDb().prepare('SELECT description FROM open_loops WHERE user_id = 1').get() as { description: string };
    expect(raw.description).not.toBe('Reply to the credit collector');
    expect(raw.description).toMatch(/^enc:1:/);
  });

  it('inserts with a due_date', () => {
    openLoopQueries.insert(1, {
      description: 'Bill due',
      type: 'deadline',
      source: 'email',
      due_date: '2026-06-20',
    });
    const loops = openLoopQueries.list(1);
    expect(loops[0].dueDate).toBe('2026-06-20');
  });

  it('lists only open loops when status filter applied', () => {
    openLoopQueries.insert(1, { description: 'A', type: 'commitment_made', source: 'call' });
    openLoopQueries.insert(1, { description: 'B', type: 'awaiting_you',    source: 'email' });
    const id = openLoopQueries.list(1)[0].id;
    openLoopQueries.resolve(1, id);

    const open = openLoopQueries.list(1, 'open');
    expect(open).toHaveLength(1);
    expect(open[0].description).toBe('B');
  });
});

// ── 2. user isolation ─────────────────────────────────────────────────────────

describe('openLoopQueries — user isolation', () => {
  it('list returns only the requesting user\'s loops', () => {
    openLoopQueries.insert(1, { description: 'user1 task', type: 'commitment_made', source: 'call' });
    openLoopQueries.insert(2, { description: 'user2 task', type: 'awaiting_you',    source: 'email' });
    expect(openLoopQueries.list(1)).toHaveLength(1);
    expect(openLoopQueries.list(1)[0].description).toBe('user1 task');
    expect(openLoopQueries.list(2)[0].description).toBe('user2 task');
  });

  it('resolve ignores loops belonging to a different user', () => {
    openLoopQueries.insert(2, { description: 'other user loop', type: 'commitment_made', source: 'call' });
    const id = openLoopQueries.list(2)[0].id;
    openLoopQueries.resolve(1, id); // user 1 tries to resolve user 2's loop
    expect(openLoopQueries.list(2, 'open')).toHaveLength(1); // still open
  });

  it('dismiss ignores loops belonging to a different user', () => {
    openLoopQueries.insert(2, { description: 'other loop', type: 'awaiting_you', source: 'email' });
    const id = openLoopQueries.list(2)[0].id;
    openLoopQueries.dismiss(1, id);
    expect(openLoopQueries.list(2, 'open')).toHaveLength(1);
  });
});

// ── 3. resolve + dismiss ──────────────────────────────────────────────────────

describe('openLoopQueries — resolve + dismiss', () => {
  it('resolve sets status=done and resolvedAt', () => {
    openLoopQueries.insert(1, { description: 'Done item', type: 'commitment_made', source: 'call' });
    const id = openLoopQueries.list(1)[0].id;
    openLoopQueries.resolve(1, id);
    const all = openLoopQueries.list(1);
    expect(all[0].status).toBe('done');
    expect(all[0].resolvedAt).not.toBeNull();
  });

  it('dismiss sets status=dismissed and resolvedAt', () => {
    openLoopQueries.insert(1, { description: 'Skip this', type: 'deadline', source: 'calendar' });
    const id = openLoopQueries.list(1)[0].id;
    openLoopQueries.dismiss(1, id);
    const all = openLoopQueries.list(1);
    expect(all[0].status).toBe('dismissed');
    expect(all[0].resolvedAt).not.toBeNull();
  });
});

// ── 4. prune ─────────────────────────────────────────────────────────────────

describe('openLoopQueries — prune', () => {
  it('prune deletes done/dismissed rows with old resolved_at, keeps open rows', () => {
    openLoopQueries.insert(1, { description: 'Open loop', type: 'awaiting_you', source: 'email' });
    openLoopQueries.insert(1, { description: 'Old done', type: 'commitment_made', source: 'call' });
    openLoopQueries.insert(1, { description: 'Recent done', type: 'deadline', source: 'calendar' });

    const rows = openLoopQueries.list(1);
    openLoopQueries.resolve(1, rows[1].id);
    openLoopQueries.resolve(1, rows[2].id);

    // Backdate one resolved_at to 31 days ago to simulate old resolved loop
    db.getDb().prepare(
      `UPDATE open_loops SET resolved_at = datetime('now', '-31 days') WHERE id = ?`
    ).run(rows[1].id);

    openLoopQueries.prune();

    const remaining = openLoopQueries.list(1);
    // 'Old done' pruned; 'Open loop' + 'Recent done' remain
    expect(remaining).toHaveLength(2);
    expect(remaining.map(r => r.description)).not.toContain('Old done');
    expect(remaining.map(r => r.description)).toContain('Open loop');
  });
});
