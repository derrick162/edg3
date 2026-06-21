import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  existing: false,
  created: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 4, resetAt: Date.now() + 3_600_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));
vi.mock('@/lib/db', () => ({
  callFeedbackQueries: {
    existsForBriefing: () => h.existing,
    create: (...args: unknown[]) => { h.created.push(args); },
  },
}));

import { POST } from './route';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/briefing/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.session = { id: 7, email: 'a@b.com', name: 'A' };
  h.rateLimitAllowed = true;
  h.existing = false;
  h.created = [];
});

describe('POST /api/briefing/feedback (R17 T2)', () => {
  it('401 when unauthenticated', async () => {
    h.session = null;
    expect((await POST(req({ briefingId: 'b1', rating: 5 }))).status).toBe(401);
  });

  it('200 + records a valid rating', async () => {
    const res = await POST(req({ briefingId: 'b1', rating: 4 }));
    expect(res.status).toBe(200);
    expect(h.created).toEqual([[7, 'b1', 4, null]]);
  });

  it('400 on an out-of-range / non-integer rating', async () => {
    expect((await POST(req({ briefingId: 'b1', rating: 6 }))).status).toBe(400);
    expect((await POST(req({ briefingId: 'b1', rating: 0 }))).status).toBe(400);
    expect((await POST(req({ briefingId: 'b1', rating: 3.5 }))).status).toBe(400);
    expect(h.created).toHaveLength(0);
  });

  it('idempotent — duplicate submit for a briefing is a no-op 200', async () => {
    h.existing = true;
    const res = await POST(req({ briefingId: 'b1', rating: 5 }));
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
    expect(h.created).toHaveLength(0);
  });
});
