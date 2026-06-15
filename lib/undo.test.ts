/**
 * Mock-based unit tests for undoPlan (lib/undo.ts).
 * Tests the orchestration logic: reverse-order execution, per-op failure
 * resilience, and the DB state transitions (markPlanUndone + markReverted).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  getByPlanId:    vi.fn(),
  markPlanUndone: vi.fn(),
  markReverted:   vi.fn(),
  calEvents:     {
    delete: vi.fn(),
    patch:  vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  undoQueries: {
    getByPlanId:    h.getByPlanId,
    markPlanUndone: h.markPlanUndone,
    record:         vi.fn(),
    recordForPlan:  vi.fn(),
    getLatest:      vi.fn(),
    markDone:       vi.fn(),
  },
  calendarPlanQueries: {
    get:          vi.fn(),
    markApplied:  vi.fn(),
    markReverted: h.markReverted,
  },
}));

vi.mock('./gmail', () => ({ deleteDraft: vi.fn() }));

import { undoPlan, recordUndo } from './undo';
import { undoQueries, calendarPlanQueries } from '@/lib/db';

function makeCal() {
  return { events: h.calEvents } as any;
}

function entry(id: number, type: 'delete' | 'patch', label = `op-${id}`) {
  const ops =
    type === 'delete'
      ? [{ type: 'delete', calId: 'primary', eventId: `evt-${id}` }]
      : [{ type: 'patch', calId: 'primary', eventId: `evt-${id}`, requestBody: {} }];
  return { id, label, payload: JSON.stringify({ ops }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.calEvents.delete.mockResolvedValue({});
  h.calEvents.patch.mockResolvedValue({});
  h.calEvents.insert.mockResolvedValue({});
});

// ── undoPlan ──────────────────────────────────────────────────────────────────

describe('undoPlan', () => {
  it('returns { reverted: 0 } when no entries found', async () => {
    (h.getByPlanId as any).mockReturnValue([]);
    const result = await undoPlan(1, 'plan-xyz', makeCal());
    expect(result).toEqual({ reverted: 0 });
    expect(h.markPlanUndone).not.toHaveBeenCalled();
    expect(h.markReverted).not.toHaveBeenCalled();
  });

  it('executes ops for each entry and returns correct count', async () => {
    (h.getByPlanId as any).mockReturnValue([entry(3, 'delete'), entry(2, 'delete'), entry(1, 'patch')]);
    const result = await undoPlan(1, 'plan-xyz', makeCal());
    expect(result.reverted).toBe(3);
    expect(h.calEvents.delete).toHaveBeenCalledTimes(2);
    expect(h.calEvents.patch).toHaveBeenCalledTimes(1);
  });

  it('processes entries in the order returned by getByPlanId (DESC — most recent first)', async () => {
    const calls: string[] = [];
    h.calEvents.delete.mockImplementation(({ eventId }: { eventId: string }) => {
      calls.push(eventId);
      return Promise.resolve({});
    });
    (h.getByPlanId as any).mockReturnValue([entry(3, 'delete'), entry(2, 'delete'), entry(1, 'delete')]);
    await undoPlan(1, 'plan-xyz', makeCal());
    expect(calls).toEqual(['evt-3', 'evt-2', 'evt-1']);
  });

  it('calls markPlanUndone and markReverted after execution', async () => {
    (h.getByPlanId as any).mockReturnValue([entry(1, 'delete')]);
    await undoPlan(42, 'plan-xyz', makeCal());
    expect(h.markPlanUndone).toHaveBeenCalledWith(42, 'plan-xyz');
    expect(h.markReverted).toHaveBeenCalledWith(42, 'plan-xyz');
  });

  it('still marks plan undone even when individual ops fail', async () => {
    h.calEvents.delete.mockRejectedValue(new Error('Google 403'));
    (h.getByPlanId as any).mockReturnValue([entry(1, 'delete'), entry(2, 'delete')]);
    const result = await undoPlan(1, 'plan-xyz', makeCal());
    // executeUndo returns false on all-failures but plan-level accounting still runs
    expect(h.markPlanUndone).toHaveBeenCalled();
    expect(h.markReverted).toHaveBeenCalled();
    // reverted may be 0 when all ops throw
    expect(result.reverted).toBe(0);
  });

  it('counts partial success: second op failure does not cancel first', async () => {
    h.calEvents.delete
      .mockResolvedValueOnce({})      // entry 2 succeeds
      .mockRejectedValueOnce(new Error('fail')); // entry 1 fails
    (h.getByPlanId as any).mockReturnValue([entry(2, 'delete'), entry(1, 'delete')]);
    const result = await undoPlan(1, 'plan-xyz', makeCal());
    expect(result.reverted).toBe(1);
  });
});

// ── recordUndo with planId ────────────────────────────────────────────────────

describe('recordUndo', () => {
  it('calls undoQueries.record when no planId', () => {
    recordUndo(1, 'Delete A', [{ type: 'delete', calId: 'primary', eventId: 'e1' }]);
    expect(undoQueries.record).toHaveBeenCalledWith(1, 'Delete A', expect.any(Object));
    expect(undoQueries.recordForPlan).not.toHaveBeenCalled();
  });

  it('calls undoQueries.recordForPlan when planId provided', () => {
    recordUndo(1, 'Delete B', [{ type: 'delete', calId: 'primary', eventId: 'e1' }], 'plan-xyz');
    expect(undoQueries.recordForPlan).toHaveBeenCalledWith(1, 'Delete B', expect.any(Object), 'plan-xyz');
    expect(undoQueries.record).not.toHaveBeenCalled();
  });

  it('does nothing when ops is empty', () => {
    recordUndo(1, 'Empty', []);
    expect(undoQueries.record).not.toHaveBeenCalled();
    expect(undoQueries.recordForPlan).not.toHaveBeenCalled();
  });
});
