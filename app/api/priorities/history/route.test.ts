import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rows: [] as { id: number; user_id: number; text: string; week_of: string; rank: number }[],
  lastWeeksArg: 0,
  throwOnQuery: false,
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/db', () => ({
  priorityQueries: {
    getRecentWeeks: (_userId: number, weeks: number) => {
      h.lastWeeksArg = weeks;
      if (h.throwOnQuery) throw new Error('db down');
      return h.rows;
    },
  },
}));

import { GET } from './route';

// Minimal NextRequest stub — the route only reads req.nextUrl.searchParams.
function req(range?: string) {
  const qs = range ? `?range=${range}` : '';
  return { nextUrl: { searchParams: new URLSearchParams(qs) } } as unknown as Parameters<typeof GET>[0];
}

function row(week_of: string, text: string, rank: number, id = Math.floor(rank)) {
  return { id, user_id: 1, text, week_of, rank };
}

beforeEach(() => {
  h.session = { id: 1, email: 'test@test.com', name: 'Test' };
  h.rows = [];
  h.lastWeeksArg = 0;
  h.throwOnQuery = false;
});

describe('GET /api/priorities/history', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await GET(req('3mo'));
    expect(res.status).toBe(401);
  });

  it('groups rows by week, newest first, preserving rank order', async () => {
    h.rows = [
      row('2026-06-15', 'Fundraising', 1),
      row('2026-06-15', 'Hiring', 2),
      row('2026-06-08', 'Fundraising', 1),
    ];
    const res = await GET(req('3mo'));
    const data = await res.json();
    expect(data.weeks).toHaveLength(2);
    expect(data.weeks[0]).toEqual({
      weekOf: '2026-06-15',
      priorities: [{ text: 'Fundraising', rank: 1 }, { text: 'Hiring', rank: 2 }],
    });
    expect(data.weeks[1].weekOf).toBe('2026-06-08');
  });

  it('maps range → weeks window (1mo=5, 3mo=13, 6mo=26, 12mo=52)', async () => {
    await GET(req('1mo'));  expect(h.lastWeeksArg).toBe(5);
    await GET(req('3mo'));  expect(h.lastWeeksArg).toBe(13);
    await GET(req('6mo'));  expect(h.lastWeeksArg).toBe(26);
    await GET(req('12mo')); expect(h.lastWeeksArg).toBe(52);
  });

  it('defaults to 3mo for missing or unknown range', async () => {
    await GET(req());          expect(h.lastWeeksArg).toBe(13);
    await GET(req('bogus'));   expect(h.lastWeeksArg).toBe(13);
  });

  it('echoes the requested range', async () => {
    const res = await GET(req('6mo'));
    const data = await res.json();
    expect(data.range).toBe('6mo');
  });

  it('degrades to empty weeks on a query error (never 500s)', async () => {
    h.throwOnQuery = true;
    const res = await GET(req('3mo'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.weeks).toEqual([]);
  });
});
