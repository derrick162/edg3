import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  disconnectCalendarThrows: false,
  auditArgs: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 4, resetAt: Date.now() + 3_600_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
  getClientIP: () => '127.0.0.1',
}));

vi.mock('@/lib/db', () => ({
  auditLogQueries: { record: (e: unknown) => { h.auditArgs.push(e); } },
}));

vi.mock('@/lib/calendar', () => ({
  disconnectCalendar: async (userId: number) => {
    if (h.disconnectCalendarThrows) throw new Error('revoke failed');
  },
}));

import { POST } from './route';

function req() {
  return new NextRequest('http://localhost/api/calendar/disconnect', { method: 'POST' });
}

beforeEach(() => {
  h.session = { id: 7, email: 'a@b.com', name: 'A' };
  h.rateLimitAllowed = true;
  h.disconnectCalendarThrows = false;
  h.auditArgs = [];
});

describe('POST /api/calendar/disconnect', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    const res = await POST(req());
    expect(res.status).toBe(429);
  });

  it('returns 200 and records ok audit on success', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(h.auditArgs).toHaveLength(1);
    const audit = h.auditArgs[0] as Record<string, unknown>;
    expect(audit.action).toBe('calendarDisconnect');
    expect(audit.ok).toBe(true);
    expect(audit.userId).toBe(7);
  });

  it('returns 500 and records failure audit when disconnect throws', async () => {
    h.disconnectCalendarThrows = true;
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(h.auditArgs).toHaveLength(1);
    const audit = h.auditArgs[0] as Record<string, unknown>;
    expect(audit.action).toBe('calendarDisconnect');
    expect(audit.ok).toBe(false);
  });
});
