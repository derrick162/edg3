import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  markDoneArgs: [] as unknown[],
  markUndoneArgs: [] as unknown[],
  removeArgs: [] as unknown[],
  auditArgs: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 59, resetAt: Date.now() + 3_600_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  focusMilestoneQueries: {
    markDone: (...args: unknown[]) => { h.markDoneArgs.push(args); },
    markUndone: (...args: unknown[]) => { h.markUndoneArgs.push(args); },
    remove: (...args: unknown[]) => { h.removeArgs.push(args); },
  },
  auditLogQueries: { record: (e: unknown) => { h.auditArgs.push(e); } },
}));

import { PATCH, DELETE } from './route';

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patchReq(body: unknown, id = '10') {
  return [
    new NextRequest(`http://localhost/api/milestones/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    makeParams(id),
  ] as const;
}
function deleteReq(id = '10') {
  return [
    new NextRequest(`http://localhost/api/milestones/${id}`, { method: 'DELETE' }),
    makeParams(id),
  ] as const;
}

beforeEach(() => {
  h.session = { id: 6, email: 'a@b.com', name: 'A' };
  h.rateLimitAllowed = true;
  h.markDoneArgs = [];
  h.markUndoneArgs = [];
  h.removeArgs = [];
  h.auditArgs = [];
});

describe('PATCH /api/milestones/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await PATCH(...patchReq({ done: true }));
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    const res = await PATCH(...patchReq({ done: true }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await PATCH(...patchReq({ done: true }, 'abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for id = 0', async () => {
    const res = await PATCH(...patchReq({ done: true }, '0'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when done is missing', async () => {
    const res = await PATCH(...patchReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 when done is not a boolean', async () => {
    const res = await PATCH(...patchReq({ done: 'yes' }));
    expect(res.status).toBe(400);
  });

  it('marks milestone done and records milestoneComplete audit', async () => {
    const res = await PATCH(...patchReq({ done: true }));
    expect(res.status).toBe(200);
    expect(h.markDoneArgs).toHaveLength(1);
    expect(h.markUndoneArgs).toHaveLength(0);
    expect(h.auditArgs).toHaveLength(1);
    const audit = h.auditArgs[0] as Record<string, unknown>;
    expect(audit.action).toBe('milestoneComplete');
    expect(audit.ok).toBe(true);
    expect(audit.userId).toBe(6);
  });

  it('marks milestone undone and records milestoneUncomplete audit', async () => {
    const res = await PATCH(...patchReq({ done: false }));
    expect(res.status).toBe(200);
    expect(h.markUndoneArgs).toHaveLength(1);
    expect(h.markDoneArgs).toHaveLength(0);
    const audit = h.auditArgs[0] as Record<string, unknown>;
    expect(audit.action).toBe('milestoneUncomplete');
    expect(audit.ok).toBe(true);
  });
});

describe('DELETE /api/milestones/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await DELETE(...deleteReq());
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    const res = await DELETE(...deleteReq());
    expect(res.status).toBe(429);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await DELETE(...deleteReq('xyz'));
    expect(res.status).toBe(400);
  });

  it('returns 200, removes milestone, and records milestoneDelete audit', async () => {
    const res = await DELETE(...deleteReq());
    expect(res.status).toBe(200);
    expect(h.removeArgs).toHaveLength(1);
    expect(h.auditArgs).toHaveLength(1);
    const audit = h.auditArgs[0] as Record<string, unknown>;
    expect(audit.action).toBe('milestoneDelete');
    expect(audit.ok).toBe(true);
    expect(audit.userId).toBe(6);
  });

  it('passes correct milestoneId in audit argsJson', async () => {
    await DELETE(...deleteReq('99'));
    const audit = h.auditArgs[0] as Record<string, unknown>;
    const args = JSON.parse(audit.argsJson as string);
    expect(args.milestoneId).toBe(99);
  });
});
