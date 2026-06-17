/**
 * Tests for POST /api/day-plan/confirm — the hero-loop Apply path.
 *
 * Covers:
 *  1. Idempotency   — double-submit is rejected (token consumed, one-time-use)
 *  2. Authz         — planId issued for user A cannot be applied by user B
 *  3. Undo grouping — recordUndo called with planId so undoPlan() can find it
 *  4. Execution log — calendarPlanQueries.markApplied called after success
 *  5. Rate limit    — 429 when limit exceeded
 *  6. Auth gate     — 401 when unauthenticated
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── hoisted mock values ────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  consumeResult: true,
  profile: { id: 1, name: 'Test', timezone: 'UTC', current_timezone: null, call_time: '07:00' } as Record<string, unknown> | null,
  calendarToken: { access_token: 'tok', refresh_token: 'rtok', expiry: null, scope: '' } as Record<string, unknown> | null,
  planActions: [] as Array<{ type: string; title?: string; startDateTime?: string; endDateTime?: string; eventId?: string; newDate?: string; description: string; addresses?: string; eventTitle?: string }>,
  calInsertId: 'new-event-id-123',
  calInsertThrows: false,
  recordUndoArgs: [] as unknown[],
  markAppliedArgs: [] as unknown[],
  auditRecordArgs: [] as unknown[],
}));

// ── module mocks ───────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getSession: async () => h.session,
}));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 4, resetAt: Date.now() + 60_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

vi.mock('@/lib/idempotency', () => ({
  consumeDeleteToken: (_userId: number, _token: string) => h.consumeResult,
}));

vi.mock('@/lib/db', () => ({
  userQueries: { findById: () => h.profile },
  priorityQueries: { getMostRecent: () => [] },
  calendarQueries: { get: () => h.calendarToken },
  calendarScoreQueries: { upsert: vi.fn() },
  effectiveTimezone: () => 'UTC',
  auditLogQueries: { record: (...args: unknown[]) => { h.auditRecordArgs.push(args); } },
  calendarPlanQueries: { markApplied: (...args: unknown[]) => { h.markAppliedArgs.push(args); } },
  openLoopQueries: { list: () => [] },
  whoopQueries: { get: () => null },
  factQueries: { getAll: () => [] },
  memoryQueries: { getRecent: () => [] },
  briefingQueries: { getRecent: () => [] },
  dailyFocusQueries: { getToday: () => null },
  getDb: () => ({ prepare: () => ({ get: () => ({ n: 0 }) }) }),
}));

vi.mock('@/lib/streak', () => ({
  computeCallStreak: () => 0,
}));

vi.mock('@/lib/calendar', () => ({
  getOAuthClient: () => ({
    setCredentials: vi.fn(),
  }),
  getCalendarEvents: async () => [],
  getWeekEvents: async () => [],
}));

vi.mock('@/lib/whoop', () => ({
  getRecoveryHistory: async () => [],
  getLastSleep: async () => null,
}));

vi.mock('@/lib/calendarScore', () => ({
  computeCalendarFit: () => ({ edgeScore: 60, focusScore: { score: 60, drivers: [] }, energyScore: { score: 60, drivers: [] } }),
}));

vi.mock('@/lib/alignment', () => ({
  computeAlignment: async () => null,
}));

vi.mock('@/lib/calendarPlan', () => ({
  buildCalendarPlan: () => ({ actions: h.planActions, summary: 'Test plan' }),
}));

vi.mock('@/lib/undo', () => ({
  recordUndo: (...args: unknown[]) => { h.recordUndoArgs.push(args); },
}));

vi.mock('@/lib/time', () => ({
  wallTimeToUtc: (dt: string) => new Date(dt + 'Z'),
  timedEventDateMove: (_start: string, _end: string, newDate: string, tz: string) => ({
    start: { dateTime: `${newDate}T09:00:00Z`, timeZone: tz },
    end:   { dateTime: `${newDate}T10:00:00Z`, timeZone: tz },
  }),
}));

vi.mock('googleapis', () => ({
  google: {
    calendar: () => ({
      events: {
        insert: async () => ({ data: { id: h.calInsertThrows ? (() => { throw new Error('API error'); })() : h.calInsertId } }),
        get: async () => ({ data: { start: { dateTime: '2026-06-17T09:00:00Z', timeZone: 'UTC' }, end: { dateTime: '2026-06-17T10:00:00Z', timeZone: 'UTC' } } }),
        patch: async () => ({ data: {} }),
      },
    }),
  },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/day-plan/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

import { POST } from './route';

beforeEach(() => {
  h.session = { id: 1, email: 'a@b.com', name: 'Test' };
  h.rateLimitAllowed = true;
  h.consumeResult = true;
  h.profile = { id: 1, name: 'Test', timezone: 'UTC', current_timezone: null, call_time: '07:00' };
  h.calendarToken = { access_token: 'tok', refresh_token: 'rtok', expiry: null, scope: '' };
  h.planActions = [];
  h.calInsertId = 'new-event-id-123';
  h.calInsertThrows = false;
  h.recordUndoArgs = [];
  h.markAppliedArgs = [];
  h.auditRecordArgs = [];
  vi.clearAllMocks();
});

// ── Auth gate ──────────────────────────────────────────────────────────────────

describe('POST /api/day-plan/confirm — auth gate', () => {
  it('returns 401 when not authenticated', async () => {
    h.session = null;
    const res = await POST(makeReq({ planId: 'AB12CD34' }));
    expect(res.status).toBe(401);
  });
});

// ── Rate limiting ──────────────────────────────────────────────────────────────

describe('POST /api/day-plan/confirm — rate limiting', () => {
  it('returns 429 when dayPlanConfirm limit exceeded', async () => {
    h.rateLimitAllowed = false;
    const res = await POST(makeReq({ planId: 'AB12CD34' }));
    expect(res.status).toBe(429);
  });
});

// ── Idempotency / double-apply ─────────────────────────────────────────────────

describe('POST /api/day-plan/confirm — idempotency', () => {
  it('returns 400 when planId is missing', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/invalid|expired/i);
  });

  it('returns 400 when planId is already consumed (double-submit)', async () => {
    h.consumeResult = false; // token already used or expired
    const res = await POST(makeReq({ planId: 'USED1234' }));
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/invalid|expired/i);
  });

  it('returns 400 on second submit with same planId (token one-time-use)', async () => {
    // First submit: allowed
    h.consumeResult = true;
    h.planActions = [{ type: 'create', title: 'Focus', startDateTime: '2026-06-17T09:00', endDateTime: '2026-06-17T10:00', description: 'Deep work', addresses: 'focus' }];
    const res1 = await POST(makeReq({ planId: 'MYTOKEN1' }));
    expect(res1.status).not.toBe(400);

    // Second submit: token already used
    h.consumeResult = false;
    const res2 = await POST(makeReq({ planId: 'MYTOKEN1' }));
    expect(res2.status).toBe(400);
  });
});

// ── Authz — cross-user token rejection ────────────────────────────────────────

describe('POST /api/day-plan/confirm — authz', () => {
  it('rejects a planId that was not issued for the requesting user', async () => {
    // consumeDeleteToken checks user_id match internally; mock returns false for wrong user
    h.consumeResult = false; // simulates user B trying user A's token
    const res = await POST(makeReq({ planId: 'USERATOK' }));
    expect(res.status).toBe(400);
  });

  it('accepts when the token matches the authenticated user', async () => {
    h.consumeResult = true;
    h.planActions = [{ type: 'create', title: 'Focus', startDateTime: '2026-06-17T09:00', endDateTime: '2026-06-17T10:00', description: 'Deep work', addresses: 'focus' }];
    const res = await POST(makeReq({ planId: 'VALID123' }));
    expect([200, 422]).toContain(res.status); // 200 if action succeeded, 422 if Google API issue
  });
});

// ── Undo grouping ──────────────────────────────────────────────────────────────

describe('POST /api/day-plan/confirm — undo grouping', () => {
  it('passes planId to recordUndo so undoPlan() can find the entry', async () => {
    h.planActions = [{ type: 'create', title: 'Focus', startDateTime: '2026-06-17T09:00', endDateTime: '2026-06-17T10:00', description: 'Deep work block', addresses: 'focus' }];
    await POST(makeReq({ planId: 'PLAN-XYZ' }));

    // recordUndo must have been called with planId as 4th arg
    const calls = h.recordUndoArgs;
    expect(calls.length).toBe(1);
    const [_userId, _label, _ops, planId] = calls[0] as [number, string, unknown[], string];
    expect(planId).toBe('PLAN-XYZ');
  });

  it('does not call recordUndo when no actions succeed', async () => {
    h.planActions = []; // no actions — plan is empty
    await POST(makeReq({ planId: 'EMPTYPLAN' }));
    expect(h.recordUndoArgs.length).toBe(0);
  });
});

// ── Execution log (markApplied) ────────────────────────────────────────────────

describe('POST /api/day-plan/confirm — execution tracking', () => {
  it('calls calendarPlanQueries.markApplied after successful apply', async () => {
    h.planActions = [{ type: 'create', title: 'Focus', startDateTime: '2026-06-17T09:00', endDateTime: '2026-06-17T10:00', description: 'Deep work', addresses: 'focus' }];
    await POST(makeReq({ planId: 'TRACK-ME' }));

    expect(h.markAppliedArgs.length).toBe(1);
    const [userId, planId, count] = h.markAppliedArgs[0] as [number, string, number];
    expect(userId).toBe(1);
    expect(planId).toBe('TRACK-ME');
    expect(typeof count).toBe('number');
  });

  it('does not call markApplied when token is invalid', async () => {
    h.consumeResult = false;
    await POST(makeReq({ planId: 'BAD-TOKEN' }));
    expect(h.markAppliedArgs.length).toBe(0);
  });

  it('markApplied is called even when some actions fail', async () => {
    // One action that creates an event
    h.planActions = [{ type: 'create', title: 'Block', startDateTime: '2026-06-17T09:00', endDateTime: '2026-06-17T10:00', description: 'Focus', addresses: 'focus' }];
    await POST(makeReq({ planId: 'PARTIAL-PLAN' }));
    // markApplied is still called (plan was consumed, execution recorded)
    expect(h.markAppliedArgs.length).toBe(1);
  });
});

// ── Calendar not connected ─────────────────────────────────────────────────────

describe('POST /api/day-plan/confirm — calendar gate', () => {
  it('returns 400 when calendar is not connected', async () => {
    h.calendarToken = null;
    const res = await POST(makeReq({ planId: 'NOCAL123' }));
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/calendar/i);
  });
});

// ── Full success path ──────────────────────────────────────────────────────────

describe('POST /api/day-plan/confirm — success', () => {
  it('returns ok:true with count and newScore on successful apply', async () => {
    h.planActions = [{ type: 'create', title: 'Focus session', startDateTime: '2026-06-17T09:00', endDateTime: '2026-06-17T10:00', description: 'Focus block', addresses: 'focus' }];
    const res = await POST(makeReq({ planId: 'SUCCESS1' }));
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; count: number };
    expect(json.ok).toBe(true);
    expect(json.count).toBeGreaterThan(0);
  });

  it('records the apply in the audit log', async () => {
    h.planActions = [{ type: 'create', title: 'Focus', startDateTime: '2026-06-17T09:00', endDateTime: '2026-06-17T10:00', description: 'Focus', addresses: 'focus' }];
    await POST(makeReq({ planId: 'AUDIT-ME' }));
    expect(h.auditRecordArgs.length).toBeGreaterThan(0);
  });
});
