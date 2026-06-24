import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  user: { id: 1, name: 'Derrick', timezone: 'UTC' } as Record<string, unknown> | undefined,
  weekEvents: [] as unknown[],
  weekEventsThrows: false,
  alignment: null as unknown,
  upsert: vi.fn(),
}));

vi.mock('./db', () => ({
  userQueries: { findById: () => h.user },
  priorityQueries: { getMostRecent: () => [{ id: 1, user_id: 1, text: 'fundraising', week_of: 'x', rank: 1, created_at: 'x' }], getThisWeek: () => [] },
  dailyFocusQueries: { getToday: () => null },
  calendarQueries: { get: () => null },
  whoopQueries: { get: () => null },
  factQueries: { getAll: () => [] },
  memoryQueries: { getRecent: () => [] },
  briefingQueries: { getRecent: () => [] },
  calendarScoreQueries: { upsert: h.upsert },
  effectiveTimezone: () => 'UTC',
  getDb: () => ({ prepare: () => ({ get: () => ({ n: 0 }) }) }),
}));
vi.mock('./calendar', () => ({ getWeekEvents: async () => { if (h.weekEventsThrows) throw new Error('google down'); return h.weekEvents; } }));
vi.mock('./whoop', () => ({ getRecoveryHistory: async () => [], getLastSleep: async () => null }));
vi.mock('./alignment', () => ({ computeAlignment: async () => h.alignment }));
vi.mock('./calendarScore', () => ({
  computeCalendarFit: () => ({
    edgeScore: 72,
    focusScore: { score: 70, drivers: [] },
    energyScore: { score: 80, drivers: [] },
  }),
}));
vi.mock('./streak', () => ({ computeCallStreak: () => 0 }));
vi.mock('./notifications', () => ({ maybeCreateScoreChangeNotif: vi.fn() }));

import { computeAndSaveScore } from './scores';

beforeEach(() => {
  h.user = { id: 1, name: 'Derrick', timezone: 'UTC' };
  h.weekEvents = [];
  h.weekEventsThrows = false;
  h.alignment = null;
  h.upsert.mockClear();
});

describe('computeAndSaveScore (R25 T4)', () => {
  it('upserts a score when alignment is reliable and events exist', async () => {
    h.alignment = { perPriority: [{ priority: 'fundraising', hours: 3, blocked: true }], unalignedHours: 0, routineHours: 0, topUnaligned: [] };
    h.weekEvents = [{ summary: 'Team sync', start: { dateTime: '2026-06-24T10:00:00Z' }, end: { dateTime: '2026-06-24T11:00:00Z' } }];
    await computeAndSaveScore(1);
    expect(h.upsert).toHaveBeenCalledTimes(1);
    expect(h.upsert.mock.calls[0][2]).toMatchObject({ edgeScore: 72 });
  });

  it('degrades silently (no throw, no upsert) when Google fetch fails', async () => {
    h.weekEventsThrows = true; // getWeekEvents rejects → caught → []
    await expect(computeAndSaveScore(1)).resolves.toBeUndefined();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('does not upsert when there are no events (focus not reliable)', async () => {
    h.alignment = { perPriority: [], unalignedHours: 0, routineHours: 0, topUnaligned: [] };
    h.weekEvents = [];
    await computeAndSaveScore(1);
    expect(h.upsert).not.toHaveBeenCalled();
  });
});
