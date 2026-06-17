import { describe, it, expect } from 'vitest';
import {
  buildAccountabilitySnapshot,
  formatAccountabilityForBriefing,
  accountabilityBriefingInstruction,
  type CommitmentOutcome,
  type AccountabilitySnapshot,
} from './accountabilityMemory';
import type { OpenLoop, OpenLoopType, OpenLoopStatus, OpenLoopSource } from './db';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const TODAY = '2026-06-17';

function makeTask(overrides: {
  id?: number;
  text?: string;
  completed?: 0 | 1;
  completed_at?: string | null;
  source?: string;
  date?: string;
}) {
  return {
    id: overrides.id ?? 1,
    text: overrides.text ?? 'Do something',
    completed: overrides.completed ?? 0,
    completed_at: overrides.completed_at ?? null,
    source: overrides.source ?? 'edg3',
    date: overrides.date ?? '2026-06-15',
  };
}

function makeLoop(overrides: {
  id?: number;
  description?: string;
  type?: OpenLoopType;
  status?: OpenLoopStatus;
  source?: OpenLoopSource;
  createdAt?: string;
  dueDate?: string | null;
  resolvedAt?: string | null;
}): OpenLoop {
  return {
    id: overrides.id ?? 10,
    userId: 1,
    description: overrides.description ?? 'Follow up with Alice',
    type: overrides.type ?? 'commitment_made',
    source: overrides.source ?? 'call',
    status: overrides.status ?? 'open',
    createdAt: overrides.createdAt ?? '2026-06-15T10:00:00Z',
    dueDate: overrides.dueDate ?? null,
    resolvedAt: overrides.resolvedAt ?? null,
    snoozedUntil: null,
  };
}

// ── buildAccountabilitySnapshot ───────────────────────────────────────────────

describe('buildAccountabilitySnapshot', () => {
  it('returns empty snapshot when no tasks or loops', () => {
    const result = buildAccountabilitySnapshot([], [], TODAY);
    expect(result.done).toHaveLength(0);
    expect(result.stillOpen).toHaveLength(0);
    expect(result.completionRate).toBeNull();
  });

  it('ignores tasks where source !== edg3', () => {
    const task = makeTask({ source: 'user', completed: 0 });
    const result = buildAccountabilitySnapshot([task], [], TODAY);
    expect(result.done).toHaveLength(0);
    expect(result.stillOpen).toHaveLength(0);
  });

  it('ignores tasks outside lookback window', () => {
    const task = makeTask({ date: '2026-06-01', completed: 0 }); // >7 days ago
    const result = buildAccountabilitySnapshot([task], [], TODAY);
    expect(result.stillOpen).toHaveLength(0);
  });

  it('ignores open_loops with type !== commitment_made', () => {
    const loop = makeLoop({ type: 'awaiting_you', status: 'open' });
    const result = buildAccountabilitySnapshot([], [loop], TODAY);
    expect(result.stillOpen).toHaveLength(0);
  });

  it('counts completed edg3 task as done', () => {
    const task = makeTask({ completed: 1, completed_at: '2026-06-16T18:00:00Z' });
    const result = buildAccountabilitySnapshot([task], [], TODAY);
    expect(result.done).toHaveLength(1);
    expect(result.done[0].source).toBe('task');
    expect(result.done[0].outcome).toBe('done');
  });

  it('counts open edg3 task from yesterday as stillOpen', () => {
    const task = makeTask({ date: '2026-06-16', completed: 0 }); // yesterday
    const result = buildAccountabilitySnapshot([task], [], TODAY);
    expect(result.stillOpen).toHaveLength(1);
    expect(result.stillOpen[0].daysOpen).toBe(1);
  });

  it('excludes today\'s open tasks from stillOpen (too fresh)', () => {
    const task = makeTask({ date: TODAY, completed: 0 });
    const result = buildAccountabilitySnapshot([task], [], TODAY);
    expect(result.stillOpen).toHaveLength(0);
  });

  it('computes completion rate correctly', () => {
    const done = makeTask({ id: 1, completed: 1, completed_at: '2026-06-16T10:00:00Z', date: '2026-06-15' });
    const open = makeTask({ id: 2, completed: 0, date: '2026-06-15' });
    const result = buildAccountabilitySnapshot([done, open], [], TODAY);
    expect(result.completionRate).toBeCloseTo(0.5);
  });

  it('returns null completionRate when fewer than 2 commitments', () => {
    const task = makeTask({ completed: 1, completed_at: '2026-06-16T10:00:00Z' });
    const result = buildAccountabilitySnapshot([task], [], TODAY);
    expect(result.completionRate).toBeNull();
  });

  it('includes open_loop commitment_made with done status in done list', () => {
    const loop = makeLoop({ status: 'done', resolvedAt: '2026-06-16T08:00:00Z' });
    const result = buildAccountabilitySnapshot([], [loop], TODAY);
    expect(result.done).toHaveLength(1);
    expect(result.done[0].source).toBe('open_loop');
  });

  it('sorts stillOpen by daysOpen descending (oldest first)', () => {
    const older = makeTask({ id: 1, date: '2026-06-11', completed: 0 }); // 6 days ago
    const newer = makeTask({ id: 2, date: '2026-06-15', completed: 0 }); // 2 days ago
    const result = buildAccountabilitySnapshot([older, newer], [], TODAY);
    expect(result.stillOpen[0].daysOpen).toBeGreaterThan(result.stillOpen[1].daysOpen);
  });
});

// ── formatAccountabilityForBriefing ───────────────────────────────────────────

describe('formatAccountabilityForBriefing', () => {
  it('returns empty string when nothing to surface', () => {
    const snap: AccountabilitySnapshot = { done: [], stillOpen: [], completionRate: null, lookbackDays: 7 };
    expect(formatAccountabilityForBriefing(snap)).toBe('');
  });

  it('includes open items when present', () => {
    const open: CommitmentOutcome = {
      id: 1, text: 'Send proposal to CIBC', source: 'task',
      madeAt: '2026-06-15', dueDate: null, outcome: 'open',
      resolvedAt: null, daysOpen: 2,
    };
    const snap: AccountabilitySnapshot = { done: [], stillOpen: [open], completionRate: null, lookbackDays: 7 };
    const result = formatAccountabilityForBriefing(snap);
    expect(result).toContain('Send proposal to CIBC');
    expect(result).toContain('Still open');
    expect(result).toContain('2 days');
  });

  it('includes completion rate when ≥2 commitments', () => {
    const done: CommitmentOutcome = {
      id: 1, text: 'Call back Mike', source: 'task',
      madeAt: '2026-06-15', dueDate: null, outcome: 'done',
      resolvedAt: '2026-06-16T09:00:00Z', daysOpen: 1,
    };
    const open: CommitmentOutcome = {
      id: 2, text: 'Review contract', source: 'open_loop',
      madeAt: '2026-06-15', dueDate: null, outcome: 'open',
      resolvedAt: null, daysOpen: 2,
    };
    const snap: AccountabilitySnapshot = {
      done: [done], stillOpen: [open], completionRate: 0.5, lookbackDays: 7,
    };
    const result = formatAccountabilityForBriefing(snap);
    expect(result).toContain('50%');
  });

  it('caps stillOpen display at 3 items with overflow note', () => {
    const open: CommitmentOutcome[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1, text: `Task ${i + 1}`, source: 'task' as const,
      madeAt: '2026-06-15', dueDate: null, outcome: 'open' as const,
      resolvedAt: null, daysOpen: i + 1,
    }));
    const snap: AccountabilitySnapshot = { done: [], stillOpen: open, completionRate: null, lookbackDays: 7 };
    const result = formatAccountabilityForBriefing(snap);
    expect(result).toContain('+ 2 more outstanding');
  });
});

// ── accountabilityBriefingInstruction ─────────────────────────────────────────

describe('accountabilityBriefingInstruction', () => {
  it('returns empty string when no commitments', () => {
    const snap: AccountabilitySnapshot = { done: [], stillOpen: [], completionRate: null, lookbackDays: 7 };
    expect(accountabilityBriefingInstruction(snap)).toBe('');
  });

  it('returns open-item instruction when stillOpen is non-empty', () => {
    const open: CommitmentOutcome = {
      id: 1, text: 'Review the pitch deck', source: 'task',
      madeAt: '2026-06-15', dueDate: null, outcome: 'open',
      resolvedAt: null, daysOpen: 2,
    };
    const snap: AccountabilitySnapshot = { done: [], stillOpen: [open], completionRate: null, lookbackDays: 7 };
    const result = accountabilityBriefingInstruction(snap);
    expect(result).toContain('section 4');
    expect(result).toContain('ACTION ITEMS');
  });

  it('returns encouraging instruction when everything done', () => {
    const done: CommitmentOutcome = {
      id: 1, text: 'Follow up with investor', source: 'task',
      madeAt: '2026-06-15', dueDate: null, outcome: 'done',
      resolvedAt: '2026-06-16T08:00:00Z', daysOpen: 1,
    };
    const snap: AccountabilitySnapshot = { done: [done], stillOpen: [], completionRate: 1, lookbackDays: 7 };
    const result = accountabilityBriefingInstruction(snap);
    expect(result).toContain('completion rate');
  });
});
