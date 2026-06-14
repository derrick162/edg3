/**
 * Integration tests for focusMilestoneQueries using an in-memory SQLite DB.
 * Verifies schema, CRUD, done/completed_at lifecycle, and user isolation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadDb() {
  vi.resetModules();
  process.env.DB_PATH = ':memory:';
  const mod = await import('./db');
  // Seed user + priority so FK constraints pass.
  const userId = Number(mod.userQueries.create('fm-test@example.com', 'FM Tester', 'hash').lastInsertRowid);
  const weekOf = '2026-06-09';
  const priorityId = Number(mod.priorityQueries.create(userId, 'Ship EDG3', weekOf, 1).lastInsertRowid);
  return { ...mod, userId, priorityId, weekOf };
}

// ── listForUser / create ───────────────────────────────────────────────────────

describe('focusMilestoneQueries — listForUser + create', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  beforeEach(async () => { db = await loadDb(); });

  it('returns empty array when no milestones exist', () => {
    expect(db.focusMilestoneQueries.listForUser(db.userId)).toEqual([]);
  });

  it('creates a milestone and retrieves it via listForUser', () => {
    const result = db.focusMilestoneQueries.create(db.userId, db.priorityId, 'Launch MVP');
    expect(result.changes).toBe(1);
    const milestones = db.focusMilestoneQueries.listForUser(db.userId);
    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({
      user_id: db.userId,
      priority_id: db.priorityId,
      title: 'Launch MVP',
      done: 0,
      sort_order: 0,
      completed_at: null,
    });
  });

  it('creates multiple milestones and returns all of them', () => {
    db.focusMilestoneQueries.create(db.userId, db.priorityId, 'Milestone A');
    db.focusMilestoneQueries.create(db.userId, db.priorityId, 'Milestone B');
    db.focusMilestoneQueries.create(db.userId, db.priorityId, 'Milestone C');
    expect(db.focusMilestoneQueries.listForUser(db.userId)).toHaveLength(3);
  });
});

// ── listForPriority ───────────────────────────────────────────────────────────

describe('focusMilestoneQueries — listForPriority', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;
  let priorityId2: number;

  beforeEach(async () => {
    db = await loadDb();
    priorityId2 = Number(db.priorityQueries.create(db.userId, 'Raise Round', db.weekOf, 2).lastInsertRowid);
  });

  it('returns only milestones for the given priority', () => {
    db.focusMilestoneQueries.create(db.userId, db.priorityId, 'P1 task');
    db.focusMilestoneQueries.create(db.userId, priorityId2, 'P2 task');
    const p1 = db.focusMilestoneQueries.listForPriority(db.userId, db.priorityId);
    expect(p1).toHaveLength(1);
    expect(p1[0].title).toBe('P1 task');
  });

  it('returns empty array when no milestones for that priority', () => {
    db.focusMilestoneQueries.create(db.userId, db.priorityId, 'Only P1');
    expect(db.focusMilestoneQueries.listForPriority(db.userId, priorityId2)).toEqual([]);
  });
});

// ── markDone / markUndone ─────────────────────────────────────────────────────

describe('focusMilestoneQueries — markDone / markUndone', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;
  let milestoneId: number;

  beforeEach(async () => {
    db = await loadDb();
    milestoneId = Number(db.focusMilestoneQueries.create(db.userId, db.priorityId, 'Finish schema').lastInsertRowid);
  });

  it('markDone marks a milestone done and records completed_at', () => {
    db.focusMilestoneQueries.markDone(milestoneId, db.userId);
    const m = db.focusMilestoneQueries.listForUser(db.userId)[0];
    expect(m.done).toBe(1);
    expect(m.completed_at).toBeTruthy();
  });

  it('markUndone clears done and completed_at', () => {
    db.focusMilestoneQueries.markDone(milestoneId, db.userId);
    db.focusMilestoneQueries.markUndone(milestoneId, db.userId);
    const m = db.focusMilestoneQueries.listForUser(db.userId)[0];
    expect(m.done).toBe(0);
    expect(m.completed_at).toBeNull();
  });

  it('markDone then markDone again is idempotent', () => {
    db.focusMilestoneQueries.markDone(milestoneId, db.userId);
    db.focusMilestoneQueries.markDone(milestoneId, db.userId);
    expect(db.focusMilestoneQueries.listForUser(db.userId)[0].done).toBe(1);
  });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe('focusMilestoneQueries — remove', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  beforeEach(async () => { db = await loadDb(); });

  it('removes a milestone by id', () => {
    const id = Number(db.focusMilestoneQueries.create(db.userId, db.priorityId, 'To delete').lastInsertRowid);
    db.focusMilestoneQueries.remove(id, db.userId);
    expect(db.focusMilestoneQueries.listForUser(db.userId)).toHaveLength(0);
  });

  it('does not remove a milestone belonging to another user', () => {
    const userId2 = Number(db.userQueries.create('other@example.com', 'Other', 'hash2').lastInsertRowid);
    const priorityId2 = Number(db.priorityQueries.create(userId2, 'P', db.weekOf, 1).lastInsertRowid);
    const id = Number(db.focusMilestoneQueries.create(db.userId, db.priorityId, 'Mine').lastInsertRowid);
    // Attempt to remove userId's milestone using userId2's auth
    db.focusMilestoneQueries.remove(id, userId2);
    expect(db.focusMilestoneQueries.listForUser(db.userId)).toHaveLength(1);
    void priorityId2; // suppress unused warning
  });
});

// ── user isolation ────────────────────────────────────────────────────────────

describe('focusMilestoneQueries — user isolation', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;
  let userId2: number;
  let priorityId2: number;

  beforeEach(async () => {
    db = await loadDb();
    userId2 = Number(db.userQueries.create('user2@example.com', 'User Two', 'hash2').lastInsertRowid);
    priorityId2 = Number(db.priorityQueries.create(userId2, 'User2 P1', db.weekOf, 1).lastInsertRowid);
  });

  it('listForUser does not return another user\'s milestones', () => {
    db.focusMilestoneQueries.create(db.userId, db.priorityId, 'User1 milestone');
    db.focusMilestoneQueries.create(userId2, priorityId2, 'User2 milestone');
    expect(db.focusMilestoneQueries.listForUser(db.userId)).toHaveLength(1);
    expect(db.focusMilestoneQueries.listForUser(userId2)).toHaveLength(1);
  });

  it('markDone does not affect another user\'s milestone', () => {
    const id = Number(db.focusMilestoneQueries.create(db.userId, db.priorityId, 'Mine').lastInsertRowid);
    db.focusMilestoneQueries.markDone(id, userId2); // wrong userId
    const m = db.focusMilestoneQueries.listForUser(db.userId)[0];
    expect(m.done).toBe(0); // unchanged
  });
});
