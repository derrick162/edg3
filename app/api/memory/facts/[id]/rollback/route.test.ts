import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  rolledBack: [] as { userId: number; historyId: number }[],
  audits: [] as { action: string }[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 9, resetAt: Date.now() + 60_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));
vi.mock('@/lib/db', () => ({
  factHistoryQueries: {
    rollbackFact: (userId: number, historyId: number) => { h.rolledBack.push({ userId, historyId }); },
  },
  auditLogQueries: {
    record: (a: { action: string }) => { h.audits.push(a); },
  },
}));

import { POST } from './route';

// The route reads req.json() and awaits params.
function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  h.session = { id: 7, email: 'd@e.com', name: 'Derrick' };
  h.rateLimitAllowed = true;
  h.rolledBack = [];
  h.audits = [];
});

describe('POST /api/memory/facts/[id]/rollback', () => {
  it('401 when unauthenticated', async () => {
    h.session = null;
    const res = await POST(req({ historyId: 3 }), params('5'));
    expect(res.status).toBe(401);
    expect(h.rolledBack).toHaveLength(0);
  });

  it('429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    const res = await POST(req({ historyId: 3 }), params('5'));
    expect(res.status).toBe(429);
    expect(h.rolledBack).toHaveLength(0);
  });

  it('400 on invalid fact id', async () => {
    const res = await POST(req({ historyId: 3 }), params('abc'));
    expect(res.status).toBe(400);
  });

  it('400 when historyId is missing', async () => {
    const res = await POST(req({}), params('5'));
    expect(res.status).toBe(400);
    expect(h.rolledBack).toHaveLength(0);
  });

  it('rolls back the fact (user-scoped) and writes an audit row on success', async () => {
    const res = await POST(req({ historyId: 42 }), params('5'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(h.rolledBack).toEqual([{ userId: 7, historyId: 42 }]);
    expect(h.audits[0]?.action).toBe('fact_rollback');
  });

  it('accepts a numeric-string historyId', async () => {
    const res = await POST(req({ historyId: '42' }), params('5'));
    expect(res.status).toBe(200);
    expect(h.rolledBack).toEqual([{ userId: 7, historyId: 42 }]);
  });
});
