import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  priorities: [] as { id: number; text: string; rank: number; week_of: string; user_id: number; energy_cost: null; created_at: string }[],
  milestones: [] as { id: number; user_id: number; priority_id: number; title: string; done: number; sort_order: number; completed_at: string | null }[],
  weekEvents: [] as { summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }[],
  pastEvents: [] as { summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 9, resetAt: Date.now() + 60_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));
vi.mock('@/lib/db', () => ({
  priorityQueries: { getMostRecent: () => h.priorities },
  focusMilestoneQueries: { listForUser: () => h.milestones },
  effectiveTimezone: () => 'America/Vancouver',
}));
vi.mock('@/lib/calendar', () => ({
  getWeekEvents: async () => h.weekEvents,
  getPastCalendarEvents: async () => h.pastEvents,
}));

vi.mock('@/lib/timeAllocation', () => ({
  computeWeeklyBreakdown: (events: unknown[], priorities: { text: string }[], numWeeks: number) => {
    return Array.from({ length: numWeeks }, (_, i) => ({
      weekLabel: `Week ${i + 1}`,
      weekStart: `2026-0${5 + i}-01`,
      perPriority: Object.fromEntries(priorities.map(p => [p.text, 0])),
      otherHours: 0,
    }));
  },
}));

import { GET } from './route';

beforeEach(() => {
  h.session = { id: 1, email: 'test@test.com', name: 'Test' };
  h.rateLimitAllowed = true;
  h.priorities = [];
  h.milestones = [];
  h.weekEvents = [];
  h.pastEvents = [];
});

describe('GET /api/scoreboard', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    const res = await GET();
    expect(res.status).toBe(429);
  });

  it('returns empty scoreboard when no priorities', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.perPriority).toEqual([]);
    expect(body.weeklyTrend).toEqual([]);
    expect(body.totalHoursThisWeek).toBe(0);
  });

  it('returns perPriority entries for each priority', async () => {
    h.priorities = [
      { id: 1, text: 'Improve runway', rank: 1, week_of: '2026-06-15', user_id: 1, energy_cost: null, created_at: '2026-06-15' },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.perPriority).toHaveLength(1);
    expect(body.perPriority[0].text).toBe('Improve runway');
    expect(typeof body.perPriority[0].hoursThisWeek).toBe('number');
    expect(typeof body.perPriority[0].weeklyAvgHours).toBe('number');
  });

  it('includes milestone counts', async () => {
    h.priorities = [
      { id: 1, text: 'Improve runway', rank: 1, week_of: '2026-06-15', user_id: 1, energy_cost: null, created_at: '2026-06-15' },
    ];
    h.milestones = [
      { id: 1, user_id: 1, priority_id: 1, title: 'Close round', done: 1, sort_order: 0, completed_at: '2026-06-10' },
      { id: 2, user_id: 1, priority_id: 1, title: 'Build deck', done: 0, sort_order: 1, completed_at: null },
    ];
    const res = await GET();
    const body = await res.json();
    expect(body.perPriority[0].milestoneDone).toBe(1);
    expect(body.perPriority[0].milestoneTotal).toBe(2);
    expect(body.perPriority[0].milestones).toHaveLength(2);
  });

  it('returns weeklyTrend with 4 buckets', async () => {
    h.priorities = [
      { id: 1, text: 'Improve runway', rank: 1, week_of: '2026-06-15', user_id: 1, energy_cost: null, created_at: '2026-06-15' },
    ];
    const res = await GET();
    const body = await res.json();
    expect(body.weeklyTrend).toHaveLength(4);
    expect(body.weeksBack).toBe(4);
  });

  it('includes timezone in response', async () => {
    h.priorities = [
      { id: 1, text: 'Improve runway', rank: 1, week_of: '2026-06-15', user_id: 1, energy_cost: null, created_at: '2026-06-15' },
    ];
    const res = await GET();
    const body = await res.json();
    expect(body.timezone).toBe('America/Vancouver');
  });
});
