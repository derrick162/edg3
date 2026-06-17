import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  insertArgs: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 9, resetAt: Date.now() + 60_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  supportMessageQueries: {
    insert: (...args: unknown[]) => { h.insertArgs.push(args); },
  },
}));

import { POST } from './route';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/support', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.session = { id: 1, email: 'test@test.com', name: 'Test' };
  h.rateLimitAllowed = true;
  h.insertArgs = [];
});

describe('POST /api/support', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await POST(req({ type: 'feedback', message: 'hello' }));
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    const res = await POST(req({ type: 'feedback', message: 'hello' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid type', async () => {
    const res = await POST(req({ type: 'complaint', message: 'hello' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/type/);
  });

  it('returns 400 for missing type', async () => {
    const res = await POST(req({ message: 'hello' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty message', async () => {
    const res = await POST(req({ type: 'feedback', message: '   ' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/message/i);
  });

  it('returns 400 for message over 2000 chars', async () => {
    const res = await POST(req({ type: 'question', message: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too long/i);
  });

  it('accepts feedback type and stores trimmed message', async () => {
    const res = await POST(req({ type: 'feedback', message: '  great app  ' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(h.insertArgs).toEqual([[1, 'feedback', 'great app']]);
  });

  it('accepts question and issue types', async () => {
    await POST(req({ type: 'question', message: 'how do I connect whoop?' }));
    await POST(req({ type: 'issue', message: 'call did not start' }));
    expect((h.insertArgs[0] as unknown[])[1]).toBe('question');
    expect((h.insertArgs[1] as unknown[])[1]).toBe('issue');
  });
});
