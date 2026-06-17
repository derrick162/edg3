import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  milestones: [] as unknown[],
  createResult: { lastInsertRowid: 42 },
  auditArgs: [] as unknown[],
  createArgs: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 59, resetAt: Date.now() + 3_600_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  focusMilestoneQueries: {
    listForPriority: (_userId: number, _priorityId: number) => h.milestones,
    create: (...args: unknown[]) => { h.createArgs.push(args); return h.createResult; },
  },
  auditLogQueries: { record: (e: unknown) => { h.auditArgs.push(e); } },
}));

import { GET, POST } from './route';

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
function getReq(id = '1') {
  return [
    new NextRequest(`http://localhost/api/priorities/${id}/milestones`, { method: 'GET' }),
    makeParams(id),
  ] as const;
}
function postReq(body: unknown, id = '1') {
  return [
    new NextRequest(`http://localhost/api/priorities/${id}/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    makeParams(id),
  ] as const;
}

beforeEach(() => {
  h.session = { id: 4, email: 'a@b.com', name: 'A' };
  h.rateLimitAllowed = true;
  h.milestones = [];
  h.auditArgs = [];
  h.createArgs = [];
});

describe('GET /api/priorities/[id]/milestones', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await GET(...getReq());
    expect(res.status).toBe(401);
  });

  it('returns 200 with milestones list', async () => {
    h.milestones = [{ id: 1, title: 'Ship v1' }];
    const res = await GET(...getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.milestones).toHaveLength(1);
  });
});

describe('POST /api/priorities/[id]/milestones', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await POST(...postReq({ title: 'Launch beta' }));
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    const res = await POST(...postReq({ title: 'Launch beta' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for missing title', async () => {
    const res = await POST(...postReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty title', async () => {
    const res = await POST(...postReq({ title: '   ' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await POST(...postReq({ title: 'OK' }, 'abc'));
    expect(res.status).toBe(400);
  });

  it('returns 201 and records audit on success', async () => {
    const res = await POST(...postReq({ title: 'Launch beta' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.id).toBe(42);
    expect(h.auditArgs).toHaveLength(1);
    const audit = h.auditArgs[0] as Record<string, unknown>;
    expect(audit.action).toBe('milestoneCreate');
    expect(audit.ok).toBe(true);
    expect(audit.userId).toBe(4);
  });

  it('trims whitespace from title before saving', async () => {
    await POST(...postReq({ title: '  Trimmed  ' }));
    const call = h.createArgs[0] as unknown[];
    expect(call[2]).toBe('Trimmed');
  });
});
