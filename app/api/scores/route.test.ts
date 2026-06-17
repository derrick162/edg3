/**
 * Tests for GET /api/scores — the Edge Score + score-stability fallback.
 *
 * Key paths:
 *  1. focusReliable=true  — alignment + events → persists, fires notif
 *  2. focusReliable=false (alignment null) → serves last stored score
 *  3. focusReliable=false (no events) → serves last stored score
 *  4. No history + no events → shows calibrating
 *  5. Auth gate / rate limit
 *  6. 7-day history returned
 *  7. Confirmed daily focus drives priorities
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mock values ────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  weekEvents: [] as { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[],
  alignment: null as Record<string, unknown> | null,
  recoveryHistory: [] as unknown[],
  todaySleep: null as unknown,
  latestScore: null as { edge_score: number; focus_score: number } | null,
  scoreHistory: [] as { date: string; edge_score: number }[],
  dailyFocus: null as { confirmed: boolean; focus_areas: string } | null,
  upsertCalled: false,
  notifCalled: false,
  priorities: [] as { id: number; text: string; rank: number }[],
  briefings: [] as { status: string; scheduled_for: string }[],
  facts: [] as unknown[],
  memories: [] as unknown[],
  calToken: { access_token: 'tok', scope: '' } as Record<string, unknown> | null,
  whoopToken: null as Record<string, unknown> | null,
}));

// ── module mocks ───────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getSession: async () => h.session,
}));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 4, resetAt: Date.now() + 60_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  priorityQueries: { getMostRecent: () => h.priorities },
  effectiveTimezone: () => 'UTC',
  calendarScoreQueries: {
    upsert: (...args: unknown[]) => { h.upsertCalled = true; void args; },
    getLatest: () => h.latestScore,
    getRange: () => h.scoreHistory,
  },
  dailyFocusQueries: { getToday: () => h.dailyFocus },
  calendarQueries: { get: () => h.calToken },
  whoopQueries: { get: () => h.whoopToken },
  factQueries: { getAll: () => h.facts },
  memoryQueries: { getRecent: () => h.memories },
  briefingQueries: { getRecent: () => h.briefings },
  getDb: () => ({ prepare: () => ({ get: () => ({ n: 0 }) }) }),
}));

vi.mock('@/lib/calendar', () => ({
  getWeekEvents: async () => h.weekEvents,
}));

vi.mock('@/lib/whoop', () => ({
  getRecoveryHistory: async () => h.recoveryHistory,
  getLastSleep: async () => h.todaySleep,
}));

vi.mock('@/lib/alignment', () => ({
  computeAlignment: async () => h.alignment,
}));

vi.mock('@/lib/calendarScore', () => ({
  computeCalendarFit: (_alignment: unknown, priorities: unknown[], _recovery: unknown[], _sleep: unknown) => ({
    edgeScore: 65,
    focusScore: { score: 70, drivers: ['P1 covered'], calibrating: false, topFix: null },
    energyScore: { score: 60, drivers: ['Recovery moderate'], calibrating: false, topFix: null },
    clarityScore: { score: 50, drivers: [] },
    momentumScore: { score: 55, drivers: [] },
    calibrating: false,
  }),
}));

vi.mock('@/lib/streak', () => ({
  computeCallStreak: () => 3,
}));

vi.mock('@/lib/notifications', () => ({
  maybeCreateScoreChangeNotif: (...args: unknown[]) => { h.notifCalled = true; void args; },
}));

vi.mock('date-fns', () => ({
  format: (_d: unknown, _fmt: string) => '2026-06-16',
  startOfWeek: (_d: unknown) => new Date('2026-06-16'),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

async function GET() {
  const { GET } = await import('./route');
  return GET();
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/scores — auth gate', () => {
  it('returns 401 when not authenticated', async () => {
    h.session = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe('GET /api/scores — rate limiting', () => {
  beforeEach(() => {
    h.session = { id: 1, email: 'test@test.com', name: 'Test' };
    h.rateLimitAllowed = false;
  });

  it('returns 429 when rate limit exceeded', async () => {
    const res = await GET();
    expect(res.status).toBe(429);
  });
});

describe('GET /api/scores — focusReliable path (alignment ok + events)', () => {
  beforeEach(() => {
    h.session = { id: 1, email: 'test@test.com', name: 'Test' };
    h.rateLimitAllowed = true;
    h.upsertCalled = false;
    h.notifCalled = false;
    h.alignment = { perPriority: [], unalignedHours: 0, topUnaligned: [] };
    h.weekEvents = [{ summary: 'Meeting', start: { dateTime: '2026-06-16T09:00:00Z' }, end: { dateTime: '2026-06-16T10:00:00Z' } }];
    h.latestScore = null;
    h.scoreHistory = [];
    h.dailyFocus = null;
    h.priorities = [{ id: 1, text: 'Fundraising', rank: 1 }];
  });

  it('returns computed score with edgeScore field', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.edgeScore).toBe('number');
    expect(json.edgeScore).toBeGreaterThan(0);
  });

  it('persists the score when alignment succeeds + events exist', async () => {
    await GET();
    expect(h.upsertCalled).toBe(true);
  });

  it('fires score-change notification when alignment succeeds', async () => {
    await GET();
    expect(h.notifCalled).toBe(true);
  });

  it('returns 7-day history array', async () => {
    h.scoreHistory = [
      { date: '2026-06-10', edge_score: 60 },
      { date: '2026-06-11', edge_score: 62 },
    ];
    const res = await GET();
    const json = await res.json();
    expect(Array.isArray(json.history)).toBe(true);
    expect(json.history).toHaveLength(2);
    expect(json.history[0]).toEqual({ date: '2026-06-10', score: 60 });
  });
});

describe('GET /api/scores — score-stability fallback (alignment fails)', () => {
  beforeEach(() => {
    h.session = { id: 1, email: 'test@test.com', name: 'Test' };
    h.rateLimitAllowed = true;
    h.upsertCalled = false;
    h.notifCalled = false;
    h.alignment = null; // alignment failed
    h.weekEvents = [{ summary: 'Meeting', start: { dateTime: '2026-06-16T09:00:00Z' }, end: { dateTime: '2026-06-16T10:00:00Z' } }];
    h.dailyFocus = null;
    h.priorities = [];
  });

  it('does NOT persist score when alignment is null (avoids corrupting trend)', async () => {
    h.latestScore = { edge_score: 70, focus_score: 68 };
    await GET();
    expect(h.upsertCalled).toBe(false);
  });

  it('does NOT fire notif when alignment is null', async () => {
    h.latestScore = { edge_score: 70, focus_score: 68 };
    await GET();
    expect(h.notifCalled).toBe(false);
  });

  it('serves last stored edge score when alignment fails + history exists', async () => {
    h.latestScore = { edge_score: 72, focus_score: 65 };
    const res = await GET();
    const json = await res.json();
    // The route replaces fit.edgeScore with lastGood.edge_score
    expect(json.edgeScore).toBe(72);
  });

  it('shows calibrating=true when alignment fails + NO history', async () => {
    h.latestScore = null;
    const res = await GET();
    const json = await res.json();
    expect(json.focusScore.calibrating).toBe(true);
  });

  it('sets a stable fallback driver message when history exists', async () => {
    h.latestScore = { edge_score: 72, focus_score: 65 };
    const res = await GET();
    const json = await res.json();
    expect(json.focusScore.drivers[0]).toContain('most recent Focus Score');
  });
});

describe('GET /api/scores — score-stability fallback (no events)', () => {
  beforeEach(() => {
    h.session = { id: 1, email: 'test@test.com', name: 'Test' };
    h.rateLimitAllowed = true;
    h.upsertCalled = false;
    h.alignment = { perPriority: [], unalignedHours: 0, topUnaligned: [] }; // alignment ok
    h.weekEvents = []; // but no events → focusReliable = false
    h.dailyFocus = null;
    h.priorities = [];
  });

  it('does NOT persist when events are empty even if alignment succeeded', async () => {
    h.latestScore = { edge_score: 70, focus_score: 65 };
    await GET();
    expect(h.upsertCalled).toBe(false);
  });

  it('serves last stored score when no events', async () => {
    h.latestScore = { edge_score: 68, focus_score: 63 };
    const res = await GET();
    const json = await res.json();
    expect(json.edgeScore).toBe(68);
  });
});

describe('GET /api/scores — confirmed daily focus drives priorities', () => {
  beforeEach(() => {
    h.session = { id: 1, email: 'test@test.com', name: 'Test' };
    h.rateLimitAllowed = true;
    h.upsertCalled = false;
    h.alignment = { perPriority: [], unalignedHours: 0, topUnaligned: [] };
    h.weekEvents = [{ summary: 'Work', start: { dateTime: '2026-06-16T09:00:00Z' }, end: { dateTime: '2026-06-16T10:00:00Z' } }];
    h.latestScore = null;
    h.scoreHistory = [];
    h.priorities = [{ id: 1, text: 'Old priority', rank: 1 }];
  });

  it('returns 200 with confirmed daily focus set', async () => {
    h.dailyFocus = { confirmed: true, focus_areas: JSON.stringify([{ title: 'Fundraising' }, { title: 'Product' }]) };
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('falls back to getMostRecent when focus_areas is malformed JSON', async () => {
    h.dailyFocus = { confirmed: true, focus_areas: 'INVALID JSON{' };
    const res = await GET();
    // Should still succeed (fallback to getMostRecent)
    expect(res.status).toBe(200);
  });

  it('uses getMostRecent when dailyFocus is null', async () => {
    h.dailyFocus = null;
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
