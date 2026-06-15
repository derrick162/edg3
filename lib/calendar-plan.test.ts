/**
 * Integration tests for calendarPlanQueries (idempotency) and the plan-level
 * extensions to undoQueries (recordForPlan, getByPlanId, markPlanUndone).
 * Uses in-memory SQLite so the full schema + migrations run end-to-end.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadDb() {
  vi.resetModules();
  process.env.DB_PATH = ':memory:';
  const mod = await import('./db');
  const userId = Number(mod.userQueries.create('plan-test@example.com', 'Planner', 'hash').lastInsertRowid);
  return { ...mod, userId };
}

// ── calendarPlanQueries ───────────────────────────────────────────────────────

describe('calendarPlanQueries — idempotency', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  beforeEach(async () => { db = await loadDb(); });

  it('returns undefined when plan has not been applied', () => {
    expect(db.calendarPlanQueries.get(db.userId, 'plan-abc')).toBeUndefined();
  });

  it('markApplied creates a record with status=applied', () => {
    db.calendarPlanQueries.markApplied(db.userId, 'plan-abc', 3);
    const row = db.calendarPlanQueries.get(db.userId, 'plan-abc');
    expect(row).toBeDefined();
    expect(row!.user_id).toBe(db.userId);
    expect(row!.plan_id).toBe('plan-abc');
    expect(row!.status).toBe('applied');
    expect(row!.mutation_count).toBe(3);
    expect(row!.applied_at).toBeTruthy();
    expect(row!.reverted_at).toBeNull();
  });

  it('markApplied is idempotent on duplicate plan_id (INSERT OR IGNORE)', () => {
    db.calendarPlanQueries.markApplied(db.userId, 'plan-abc', 3);
    db.calendarPlanQueries.markApplied(db.userId, 'plan-abc', 99); // duplicate — ignored
    const row = db.calendarPlanQueries.get(db.userId, 'plan-abc');
    expect(row!.mutation_count).toBe(3); // original value preserved
  });

  it('markReverted updates status and sets reverted_at', () => {
    db.calendarPlanQueries.markApplied(db.userId, 'plan-abc', 3);
    db.calendarPlanQueries.markReverted(db.userId, 'plan-abc');
    const row = db.calendarPlanQueries.get(db.userId, 'plan-abc');
    expect(row!.status).toBe('reverted');
    expect(row!.reverted_at).toBeTruthy();
  });

  it('does not leak plan records across users', () => {
    const userId2 = Number(db.userQueries.create('u2@example.com', 'U2', 'h2').lastInsertRowid);
    db.calendarPlanQueries.markApplied(db.userId, 'plan-abc', 2);
    expect(db.calendarPlanQueries.get(userId2, 'plan-abc')).toBeUndefined();
  });

  it('different plan_ids are independent per user', () => {
    db.calendarPlanQueries.markApplied(db.userId, 'plan-1', 1);
    db.calendarPlanQueries.markApplied(db.userId, 'plan-2', 4);
    expect(db.calendarPlanQueries.get(db.userId, 'plan-1')!.mutation_count).toBe(1);
    expect(db.calendarPlanQueries.get(db.userId, 'plan-2')!.mutation_count).toBe(4);
  });
});

// ── undoQueries plan extensions ───────────────────────────────────────────────

describe('undoQueries — plan-level extensions', () => {
  let db: Awaited<ReturnType<typeof loadDb>>;
  const PAYLOAD = { ops: [{ type: 'delete', calId: 'primary', eventId: 'evt_1' }] };

  beforeEach(async () => { db = await loadDb(); });

  it('recordForPlan inserts an undo entry with plan_id', () => {
    db.undoQueries.recordForPlan(db.userId, 'Created meeting', PAYLOAD, 'plan-xyz');
    const entries = db.undoQueries.getByPlanId(db.userId, 'plan-xyz');
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Created meeting');
    expect(JSON.parse(entries[0].payload)).toEqual(PAYLOAD);
  });

  it('getByPlanId returns entries in DESC id order (most recent first)', () => {
    db.undoQueries.recordForPlan(db.userId, 'Mutation A', PAYLOAD, 'plan-xyz');
    db.undoQueries.recordForPlan(db.userId, 'Mutation B', PAYLOAD, 'plan-xyz');
    db.undoQueries.recordForPlan(db.userId, 'Mutation C', PAYLOAD, 'plan-xyz');
    const entries = db.undoQueries.getByPlanId(db.userId, 'plan-xyz');
    expect(entries[0].label).toBe('Mutation C');
    expect(entries[2].label).toBe('Mutation A');
  });

  it('getByPlanId returns empty array for unknown planId', () => {
    expect(db.undoQueries.getByPlanId(db.userId, 'nonexistent')).toEqual([]);
  });

  it('getByPlanId filters by user_id', () => {
    const userId2 = Number(db.userQueries.create('u2@example.com', 'U2', 'h2').lastInsertRowid);
    db.undoQueries.recordForPlan(db.userId, 'Mine', PAYLOAD, 'plan-xyz');
    db.undoQueries.recordForPlan(userId2, 'Theirs', PAYLOAD, 'plan-xyz');
    expect(db.undoQueries.getByPlanId(db.userId, 'plan-xyz')).toHaveLength(1);
    expect(db.undoQueries.getByPlanId(userId2, 'plan-xyz')).toHaveLength(1);
  });

  it('markPlanUndone sets undone=1 on all plan entries', () => {
    db.undoQueries.recordForPlan(db.userId, 'A', PAYLOAD, 'plan-xyz');
    db.undoQueries.recordForPlan(db.userId, 'B', PAYLOAD, 'plan-xyz');
    db.undoQueries.markPlanUndone(db.userId, 'plan-xyz');
    // After marking, getByPlanId (which filters undone=0) returns empty
    expect(db.undoQueries.getByPlanId(db.userId, 'plan-xyz')).toHaveLength(0);
  });

  it('markPlanUndone does not affect entries from a different plan', () => {
    db.undoQueries.recordForPlan(db.userId, 'Plan A entry', PAYLOAD, 'plan-A');
    db.undoQueries.recordForPlan(db.userId, 'Plan B entry', PAYLOAD, 'plan-B');
    db.undoQueries.markPlanUndone(db.userId, 'plan-A');
    expect(db.undoQueries.getByPlanId(db.userId, 'plan-B')).toHaveLength(1);
  });

  it('standalone record() (without planId) still works independently', () => {
    db.undoQueries.record(db.userId, 'Standalone', PAYLOAD);
    const latest = db.undoQueries.getLatest(db.userId);
    expect(latest).toBeDefined();
    expect(latest!.label).toBe('Standalone');
  });
});
