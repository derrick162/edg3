import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  revokeThrows: false,
  auditArgs: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 4, resetAt: Date.now() + 3_600_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  auditLogQueries: { record: (e: unknown) => { h.auditArgs.push(e); } },
}));

vi.mock('@/lib/whoop', () => ({
  revokeWhoopAccess: async (_userId: number) => {
    if (h.revokeThrows) throw new Error('revoke failed');
  },
}));

import { POST } from './route';

function req() {
  return new NextRequest('http://localhost/api/whoop/disconnect', { method: 'POST' });
}

beforeEach(() => {
  h.session = { id: 5, email: 'a@b.com', name: 'A' };
  h.rateLimitAllowed = true;
  h.revokeThrows = false;
  h.auditArgs = [];
});

describe('POST /api/whoop/disconnect', () => {
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
    expect(audit.action).toBe('whoopDisconnect');
    expect(audit.ok).toBe(true);
    expect(audit.userId).toBe(5);
  });

  it('returns 500 and records failure audit when revoke throws', async () => {
    h.revokeThrows = true;
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(h.auditArgs).toHaveLength(1);
    const audit = h.auditArgs[0] as Record<string, unknown>;
    expect(audit.action).toBe('whoopDisconnect');
    expect(audit.ok).toBe(false);
    expect(typeof audit.resultText).toBe('string');
  });
});
